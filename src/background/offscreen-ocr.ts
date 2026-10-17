/**
 * Offscreen document for canvas redaction (Feature 3): runs Tesseract and the Rust scanner on canvas images.
 *
 * OCR runs here, not in the content script: in a content script, Tesseract's Worker and WASM fall under
 * the page's CSP, which strict sites (Power BI, Tableau) use to block them. An offscreen document runs
 * under the extension's own CSP. Tesseract and its language data are the app's own copies (app/lib, app/lang).
 */
import { extensionLoader } from '../content/scanner-wasm';
import { createScanner, type TextScanner } from './text-scanner';
import { ALLOW_WORDS } from '../shared/allowlist';
import type { OcrImage, OcrReply, OcrResult, ToOffscreen } from './canvas-protocol';
import { maskBoxes, mergePasses, parseTsv, type OcrWord } from './ocr-words';

interface TesseractWorker {
  recognize(img: HTMLCanvasElement, opts: object, out: object): Promise<{ data: { tsv?: string } }>;
  setParameters(p: Record<string, string>): Promise<unknown>;
}
declare const Tesseract: { createWorker(lang: string, oem: number, opts: object): Promise<TesseractWorker> };
declare const VAULTSNIP_CONFIG: { langPath?: string; langGzip?: boolean } | undefined;

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

let scannerP: Promise<TextScanner> | null = null;
const scanner = () => (scannerP ??= createScanner(extensionLoader, ALLOW_WORDS));

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

async function run(images: OcrImage[]): Promise<OcrResult[]> {
  const s = await scanner();
  const results: OcrResult[] = [];
  for (const { id, dataUrl } of images) {
    const words = await read(await load(dataUrl));
    results.push({ id, words: words.length, boxes: maskBoxes(words, s.scan(words.map((w) => w.text))) });
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
