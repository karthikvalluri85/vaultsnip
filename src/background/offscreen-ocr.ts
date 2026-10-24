/**
 * Offscreen document for canvas redaction (Feature 3): runs Tesseract on canvas images and the app's masking rules
 * (src/shared/classify.ts) on the words it reads.
 *
 * OCR runs here, not in the content script: in a content script, Tesseract's Worker and WASM fall under
 * the page's CSP, which strict sites (Power BI, Tableau) use to block them. An offscreen document runs
 * under the extension's own CSP. Tesseract and its language data are the app's own copies (app/lib, app/lang).
 */
import { classify } from '../shared/classify';
import { ALLOW_WORDS } from '../shared/allowlist';
import type { MaskBox, OcrImage, OcrReply, OcrResult, ToOffscreen } from './canvas-protocol';
import { maskBoxes, mergePasses, parseTsv, type OcrWord } from './ocr-words';
import { ContextClassifier, detectorSize, flatMarksOnly, isBar, isShapes, moduleWorker, unreadParts, UNREAD_TYPE } from '../content/context-classifier';

interface TesseractWorker {
  recognize(img: HTMLCanvasElement, opts: object, out: object): Promise<{ data: { tsv?: string } }>;
  setParameters(p: Record<string, string>): Promise<unknown>;
}
declare const Tesseract: { createWorker(lang: string, oem: number, opts: object): Promise<TesseractWorker> };
declare const VAULTSNIP_CONFIG: { langPath?: string; langGzip?: boolean; mlModels?: string; mlGzip?: boolean } | undefined;

let workerP: Promise<TesseractWorker> | null = null;
function ocrWorker(): Promise<TesseractWorker> {
  const cfg = typeof VAULTSNIP_CONFIG === 'undefined' ? {} : VAULTSNIP_CONFIG;
  // app/config.js gives a path relative to the app folder, or (store build) a URL to fetch the language data from.
  const lang = cfg.langPath ?? 'lang';
  return (workerP ??= Tesseract.createWorker('eng', 1, {
    workerPath: 'app/lib/worker.min.js', corePath: 'app/lib/core', langPath: /^https?:/.test(lang) ? lang : `app/${lang}`,
    workerBlobURL: false, gzip: cfg.langGzip !== false, cacheMethod: 'write',
  }).then(async (w) => {
    await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    return w;
  }).catch((e) => { workerP = null; throw e; }));
}

const ALLOW = new Set(ALLOW_WORDS);
const scan = (texts: readonly string[]) => texts.map((t) => classify(t, { allow: ALLOW }));

function load(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode canvas image'));
    img.src = dataUrl;
  });
}

/** Upscaled copy for OCR; `invert` reads light text on dark dashboards. */
function prep(img: HTMLImageElement, scale: number, invert: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height); // transparent canvas pixels read as white, not black
  if (invert) ctx.filter = 'invert(1)';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function read(img: HTMLImageElement): Promise<OcrWord[]> {
  const w = await ocrWorker();
  const passes: OcrWord[][] = [];
  for (const invert of [false, true]) {
    const { data } = await w.recognize(prep(img, 2, invert), {}, { tsv: true, text: false, blocks: false, hocr: false });
    passes.push(parseTsv(data.tsv ?? '', 2));
  }
  return mergePasses(passes);
}

/**
 * Text the reader missed (Phase 2): the app's text-region detector, in the same ML worker the app uses (app/ml), finds
 * every patch of text; any part no flagged word and no confidently read safe word accounts for is blurred too. A
 * region far taller than a line of text (labels and chart marks merged into one blob) is left alone: unlike the app,
 * this path has no second look to tell what is in it, and blurring it whole would hide the chart. If the detector
 * cannot run, the reader's boxes stand.
 */
let ml: ContextClassifier | null = null;
function mlWorkerUrl(): URL {
  const cfg = typeof VAULTSNIP_CONFIG === 'undefined' ? {} : VAULTSNIP_CONFIG;
  // app/config.js gives the models folder relative to the app (or, in a store build without models, a URL)
  const models = new URL(cfg.mlModels ?? 'models/', new URL('app/', location.href)).href;
  return new URL('app/ml/ml-worker.js?' + new URLSearchParams({ models, gz: cfg.mlGzip === false ? '0' : '1' }), location.href);
}
const READ_CONF = 60;
/** The RGBA pixels of a box of the image, in whole pixels. */
function pixelsOf(img: HTMLImageElement, b: { x: number; y: number; w: number; h: number }): ImageData {
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
  const w = Math.max(1, Math.min(img.naturalWidth, Math.ceil(b.x + b.w)) - x0), h = Math.max(1, Math.min(img.naturalHeight, Math.ceil(b.y + b.h)) - y0);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}
const medianH = (words: readonly OcrWord[]) => { const hs = words.map((w) => w.h).sort((a, b) => a - b); return hs.length ? hs[hs.length >> 1] : 12; };
/** As in the app: a "word" that is a solid rectangle (a bar) or thick regions of one colour each (slices) is a chart shape the reader took for text; blurring it hides the chart. */
function notBars(img: HTMLImageElement, words: OcrWord[]): OcrWord[] {
  const textH = medianH(words);
  return words.filter((w) => { if (Math.max(w.w, w.h) < textH) return true; const px = pixelsOf(img, w); return !(isBar(px, textH) || isShapes(px, textH)); });
}
async function unreadBoxes(img: HTMLImageElement, words: readonly OcrWord[], flagged: readonly MaskBox[]): Promise<{ boxes: MaskBox[]; note: string }> {
  try {
    ml ??= new ContextClassifier(moduleWorker(mlWorkerUrl()), { timeoutMs: 60_000 });
    const size = detectorSize(img.naturalWidth, img.naturalHeight, 1536);
    const c = document.createElement('canvas'); c.width = size.width; c.height = size.height;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height);
    const regions = await ml.detect({ width: d.width, height: d.height, data: d.data });
    const kx = img.naturalWidth / size.width, ky = img.naturalHeight / size.height;
    const scale = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky });
    const textH = medianH(words);
    // a blob is judged by its thickness: a slanted line's upright box is tall, but the line itself is thin
    const slanted = (r: (typeof regions)[number]) => !!r.len && Math.abs(r.angle ?? 0) > 10 && Math.abs(r.angle ?? 0) < 170;
    const lines = regions.filter((r) => (slanted(r) ? (r.thick ?? 0) * ky : (r.core ?? r).h * ky) <= 3 * textH)
      .map((r) => ({ ...scale(r), core: scale(r.core ?? r) }));
    const inside = (w: OcrWord) => flagged.some((m) => w.x + w.w / 2 >= m.x && w.x + w.w / 2 <= m.x + m.w && w.y + w.h / 2 >= m.y && w.y + w.h / 2 <= m.y + m.h);
    const cover = [...flagged, ...words.filter((w) => w.conf >= READ_CONF && !inside(w))];
    // a part holding only flat marks (a bar beside its label, a gridline) is not text
    const boxes = unreadParts(lines, cover).filter((p) => !flatMarksOnly(pixelsOf(img, p), textH)).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, type: UNREAD_TYPE }));
    return { boxes, note: String(boxes.length) };
  } catch (e) {
    console.warn("VaultSnip: the text-region check could not run here; the reader's masks stand.", e);
    return { boxes: [], note: 'off: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

async function run(images: OcrImage[]): Promise<OcrResult[]> {
  const results: OcrResult[] = [];
  for (const { id, dataUrl } of images) {
    const img = await load(dataUrl);
    const words = notBars(img, await read(img));
    const boxes = maskBoxes(words, scan(words.map((w) => w.text)));
    const unread = await unreadBoxes(img, words, boxes);
    results.push({ id, words: words.length, boxes: boxes.concat(unread.boxes), unread: unread.note });
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg: ToOffscreen, _sender, send: (r: OcrReply) => void) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'vs-ocr') return;
  run(msg.images).then(
    (results) => send({ ok: true, results }),
    (e) => send({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});
