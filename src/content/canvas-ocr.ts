/**
 * Canvas redaction on the live page (Feature 3). Charts in Power BI, Tableau, ECharts and Chart.js are
 * <canvas> elements, so their text is not in the DOM. This reads each canvas's pixels, has the extension
 * read and classify the text (OCR + the app's masking rules, in an offscreen document), and blurs what it flags.
 *
 * The blur is drawn on an overlay canvas above each chart, not into the chart's own context: chart
 * libraries redraw on every hover, animation or resize, which would wipe it; WebGL canvases have no 2D
 * context to draw into; and the page's context state (transforms, clips) is not ours to change.
 * The "blur" first shrinks each region to a few pixels, so the glyph shapes are gone, not just softened:
 * a plain blur over known fonts can be reversed by brute force.
 */
import type { CaptureReply, MaskBox, OcrImage, OcrReply, ToBackground } from '../background/canvas-protocol';

/* ---------------- pure geometry (unit-tested) ---------------- */

export interface Rect { x: number; y: number; w: number; h: number }

/** How image pixels map onto the canvas's CSS box: css = image * scale + offset. */
export interface ImageMap { scale: number; offX: number; offY: number }

export const toCss = (b: Rect, m: ImageMap): Rect => ({ x: b.x * m.scale + m.offX, y: b.y * m.scale + m.offY, w: b.w * m.scale, h: b.h * m.scale });

/**
 * The part of a canvas (CSS rect in the viewport) visible in a tab screenshot, in screenshot pixels,
 * and how those pixels map back onto the canvas. `ratio` = screenshot width / viewport width (zoom × DPR).
 */
export function cropForCanvas(rect: Rect, viewport: { w: number; h: number }, ratio: number): { crop: Rect; map: ImageMap } | null {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(viewport.w, rect.x + rect.w), y1 = Math.min(viewport.h, rect.y + rect.h);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const crop = { x: Math.floor(x0 * ratio), y: Math.floor(y0 * ratio), w: Math.ceil((x1 - x0) * ratio), h: Math.ceil((y1 - y0) * ratio) };
  return { crop, map: { scale: 1 / ratio, offX: crop.x / ratio - rect.x, offY: crop.y / ratio - rect.y } };
}

/** Boxes whose centre is not already inside a mask: what a re-check found that the first pass missed. */
export function uncovered(found: readonly Rect[], masks: readonly Rect[]): Rect[] {
  return found.filter((f) => {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    return !masks.some((m) => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
  });
}

/** Side of the square thumbnail compared to spot redraws. */
export const SIG = 64;

/**
 * Where two thumbnails (RGBA, size × size) differ, as a fraction of the canvas box with one cell of margin; null when
 * nothing changed. Any pixel that moved by more than `threshold` in a channel counts, so one new label in an empty part
 * of a chart is found (an average over the whole chart would hide it).
 */
export function changedBox(a: ArrayLike<number>, b: ArrayLike<number>, size = SIG, threshold = 24): Rect | null {
  if (a.length !== b.length || a.length !== size * size * 4) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > threshold || Math.abs(a[i + 1] - b[i + 1]) > threshold || Math.abs(a[i + 2] - b[i + 2]) > threshold || Math.abs(a[i + 3] - b[i + 3]) > threshold) {
      const px = (i / 4) % size, py = Math.floor(i / 4 / size);
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(size - 1, x1 + 1); y1 = Math.min(size - 1, y1 + 1);
  return { x: x0 / size, y: y0 / size, w: (x1 - x0 + 1) / size, h: (y1 - y0 + 1) / size };
}

/** Union of two boxes (either may be null). */
export const unionBox = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || !b) return a || b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Mean absolute difference of two equal-length pixel arrays, 0–255. */
export function pixelDelta(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 255;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return a.length ? d / a.length : 0;
}

/* ---------------- page side ---------------- */

const KEY = '__vaultsnipCanvas';
const MIN_W = 40, MIN_H = 20;
// How often charts are checked for redraws (a 32×32 thumbnail each): the longest new text can show before it is hidden.
const WATCH_MS = 300;

interface Target {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  /** Masks in CSS pixels relative to the canvas box, with the source pixels behind each. */
  masks: { box: Rect; img: HTMLImageElement; map: ImageMap }[];
  size: { w: number; h: number };
  signature: Uint8ClampedArray | null;
  busy: boolean;
  /** The part of the chart that changed (fraction of its box), hidden until it has been read again (fail closed). */
  cover: Rect | null;
  /** Failed reads since the chart was covered; after 3 it waits for the user to run the blur again. */
  tries: number;
}

interface State { stop(): void }

/** One canvas image sent for OCR. `fromTab`: cropped from a tab screenshot (so it shows any overlay on top). */
interface Shot { c: HTMLCanvasElement; image: OcrImage; map: ImageMap; fromTab: boolean }

const send = <T>(msg: ToBackground): Promise<T> => chrome.runtime.sendMessage(msg);

function allCanvases(root: Document | ShadowRoot, out: HTMLCanvasElement[] = []): HTMLCanvasElement[] {
  root.querySelectorAll('canvas').forEach((c) => out.push(c));
  root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) allCanvases(el.shadowRoot, out); });
  return out;
}

function visibleRect(c: HTMLCanvasElement): Rect | null {
  const r = c.getBoundingClientRect();
  if (r.width < MIN_W || r.height < MIN_H) return null;
  const s = getComputedStyle(c);
  if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Visible and at least partly inside the viewport, so a tab screenshot can show it. */
function inView(c: HTMLCanvasElement): boolean {
  const r = visibleRect(c);
  return !!r && r.x + r.w > 0 && r.y + r.h > 0 && r.x < innerWidth && r.y < innerHeight;
}
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = dataUrl; });
}

/** Small grey-level thumbnail, for noticing a redraw. null when the canvas cannot be read (tainted). */
function signature(c: HTMLCanvasElement): Uint8ClampedArray | null {
  try {
    const t = document.createElement('canvas');
    t.width = SIG; t.height = SIG;
    const ctx = t.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0, SIG, SIG);
    return ctx.getImageData(0, 0, SIG, SIG).data;
  } catch {
    return null;
  }
}

/** The canvas's own pixels, or null when they cannot be read: tainted by cross-origin images, or WebGL that reads back blank. */
function ownPixels(c: HTMLCanvasElement): string | null {
  try {
    const sig = signature(c);
    if (!sig || !sig.some((v, i) => i % 4 === 3 && v > 0)) return null; // fully transparent: WebGL without preserveDrawingBuffer
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

function paint(t: Target): void {
  const r = t.canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const o = t.overlay;
  o.width = Math.max(1, Math.round(r.width * dpr));
  o.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = o.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const tiny = document.createElement('canvas');
  const tctx = tiny.getContext('2d')!;
  for (const { box, img, map } of t.masks) {
    // Source pixels behind the box, in image coordinates.
    const sx = (box.x - map.offX) / map.scale, sy = (box.y - map.offY) / map.scale;
    const sw = box.w / map.scale, sh = box.h / map.scale;
    // About one pixel per 12 CSS px: text becomes a few colour blocks, with nothing left to recover.
    tiny.width = Math.max(1, Math.round(box.w / 12));
    tiny.height = Math.max(1, Math.round(box.h / 12));
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    // Opaque base first, so the blur's soft edge never lets the text show through.
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, box.x, box.y, box.w, box.h);
    ctx.filter = `blur(${Math.max(2, Math.min(box.h, box.w) / 4)}px)`;
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, box.x - 4, box.y - 4, box.w + 8, box.h + 8);
    ctx.restore();
  }
  if (t.cover) {
    const c = { x: t.cover.x * r.width, y: t.cover.y * r.height, w: t.cover.w * r.width, h: t.cover.h * r.height };
    ctx.fillStyle = '#8a9099';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    if (c.w > 180 && c.h > 24) {
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Hidden until VaultSnip reads it again', c.x + c.w / 2, c.y + c.h / 2 + 4);
    }
  }
}

function start(): State {
  const host = document.createElement('vaultsnip-redactions');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;right:12px;bottom:12px;font:12px/1.4 system-ui,sans-serif;background:#14181e;color:#fff;padding:6px 10px;border-radius:6px;opacity:.92;';
  shadow.appendChild(badge);
  const say = (s: string) => { badge.textContent = `VaultSnip: ${s}`; };

  const targets = new Map<HTMLCanvasElement, Target>();
  let stopped = false;

  /** Reads one batch of canvases: own pixels where possible, otherwise one tab screenshot cropped per canvas. */
  async function snapshot(cs: HTMLCanvasElement[]): Promise<Shot[]> {
    const shots: Shot[] = [];
    const needTab: HTMLCanvasElement[] = [];
    for (const c of cs) {
      const url = ownPixels(c);
      const r = c.getBoundingClientRect();
      if (url) shots.push({ c, image: { id: String(shots.length), dataUrl: url }, map: { scale: r.width / c.width, offX: 0, offY: 0 }, fromTab: false });
      else needTab.push(c);
    }
    if (needTab.length) shots.push(...(await fromTab(needTab, shots.length)));
    return shots;
  }

  async function fromTab(cs: HTMLCanvasElement[], idBase: number): Promise<Shot[]> {
    const out: Shot[] = [];
    // The badge could sit over chart text; hide it for the screenshot so that text is read too.
    // A chart hidden whole after a change is captured without its cover (for one frame), or its new text could not be read.
    const covers = cs.map((c) => targets.get(c)).filter((t): t is Target => !!t && !!t.cover).map((t) => t.overlay);
    badge.style.visibility = 'hidden';
    covers.forEach((o) => { o.style.visibility = 'hidden'; });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let cap: CaptureReply;
    try { cap = await send<CaptureReply>({ type: 'vs-canvas-capture' }); } finally { badge.style.visibility = ''; covers.forEach((o) => { o.style.visibility = ''; }); }
    if (!cap.ok) throw new Error(cap.error);
    const shot = await loadImage(cap.dataUrl);
    const ratio = shot.naturalWidth / innerWidth;
    for (const c of cs) {
      const r = visibleRect(c);
      const cut = r && cropForCanvas(r, { w: innerWidth, h: innerHeight }, ratio);
      if (!cut) continue;
      const t = document.createElement('canvas');
      t.width = cut.crop.w; t.height = cut.crop.h;
      t.getContext('2d')!.drawImage(shot, cut.crop.x, cut.crop.y, cut.crop.w, cut.crop.h, 0, 0, cut.crop.w, cut.crop.h);
      out.push({ c, image: { id: String(idBase + out.length), dataUrl: t.toDataURL('image/png') }, map: cut.map, fromTab: true });
    }
    return out;
  }

  async function ocr(images: OcrImage[]) {
    const r = await send<OcrReply>({ type: 'vs-canvas-ocr', images });
    if (!r.ok) throw new Error(r.error);
    r.results.forEach((x) => { if (x.unread) host.dataset.unread = x.unread; });   // the text-region check's last word, for diagnosis
    return new Map(r.results.map((x) => [x.id, x]));
  }

  function target(c: HTMLCanvasElement): Target {
    let t = targets.get(c);
    if (!t) {
      const overlay = document.createElement('canvas');
      overlay.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;';
      shadow.insertBefore(overlay, badge);
      const r = c.getBoundingClientRect();
      t = { canvas: c, overlay, masks: [], size: { w: r.width, h: r.height }, signature: null, busy: false, cover: null, tries: 0 };
      targets.set(c, t);
    }
    return t;
  }

  async function scan(cs: HTMLCanvasElement[]): Promise<number> {
    const todo = cs.filter((c) => !targets.get(c)?.busy);
    todo.forEach((c) => { target(c).busy = true; });
    try {
      const shots = await snapshot(todo);
      if (!shots.length) return 0;
      const results = await ocr(shots.map((s) => s.image));
      let n = 0;
      for (const s of shots) {
        const t = target(s.c);
        const img = await loadImage(s.image.dataUrl);
        const found = (results.get(s.image.id)?.boxes ?? []).map((b: MaskBox) => ({ box: toCss(b, s.map), img, map: s.map }));
        // A screenshot of a chart that is already masked shows our own blur, not the text under it, so its old
        // masks are kept and only new finds are added. A canvas's own pixels never include the overlay.
        t.masks = s.fromTab && t.masks.length && !t.cover
          ? [...t.masks, ...found.filter((f) => uncovered([f.box], t.masks.map((m) => m.box)).length)]
          : found;
        const r = s.c.getBoundingClientRect();
        t.size = { w: r.width, h: r.height };
        t.signature = signature(s.c);
        t.cover = null;
        t.tries = 0;
        paint(t);
        n += t.masks.length;
      }
      return n;
    } finally {
      todo.forEach((c) => { const t = targets.get(c); if (t) t.busy = false; });
    }
  }

  /**
   * Independent re-check, as the app's verification gate: screenshot the page WITH the overlays, read each
   * chart again, and mask anything flagged that is still readable outside the masks.
   */
  async function verify(): Promise<number> {
    const list = [...targets.values()].filter((t) => visibleRect(t.canvas));
    if (!list.length) return 0;
    const shots = await fromTab(list.map((t) => t.canvas), 0);
    const results = await ocr(shots.map((s) => s.image));
    let added = 0;
    for (const s of shots) {
      const t = targets.get(s.c)!;
      const found = (results.get(s.image.id)?.boxes ?? []).map((b) => toCss(b, s.map));
      const missed = uncovered(found, t.masks.map((m) => m.box));
      if (!missed.length) continue;
      const img = await loadImage(s.image.dataUrl);
      t.masks.push(...missed.map((box) => ({ box, img, map: s.map })));
      paint(t);
      added += missed.length;
    }
    return added;
  }

  // The part of a chart that changed may show new text: hide it at once, and show it again only after the chart has been
  // read. If the read fails, it stays hidden and the badge says so (fail closed). `boxes` default to the whole chart.
  function rescan(cs: HTMLCanvasElement[], boxes: Map<HTMLCanvasElement, Rect> = new Map()): void {
    const todo = cs.filter((c) => !targets.get(c)?.busy);
    if (!todo.length) return;
    todo.forEach((c) => { const t = target(c); t.cover = unionBox(t.cover, boxes.get(c) ?? { x: 0, y: 0, w: 1, h: 1 }); paint(t); });
    scan(todo).catch((e) => {
      todo.forEach((c) => { const t = targets.get(c); if (t) t.tries++; });
      const msg = e instanceof Error ? e.message : String(e);
      say(`a chart changed and could not be read again, so it stays hidden (${msg}). Run again to retry.`);
      host.dataset.state = 'error';
      host.dataset.error = msg;
    });
  }

  // Keep overlays on their charts through scrolling, layout changes and redraws.
  const follow = () => {
    if (stopped) return;
    const resized: HTMLCanvasElement[] = [];
    for (const t of targets.values()) {
      const r = t.canvas.getBoundingClientRect();
      const shown = r.width >= MIN_W && r.height >= MIN_H && t.canvas.isConnected;
      t.overlay.style.display = shown ? '' : 'none';
      t.overlay.style.transform = `translate(${r.left}px,${r.top}px)`;
      t.overlay.style.width = `${r.width}px`;
      t.overlay.style.height = `${r.height}px`;
      if (shown && (Math.abs(r.width - t.size.w) > 1 || Math.abs(r.height - t.size.h) > 1)) resized.push(t.canvas);
    }
    if (resized.length) rescan(resized);
    requestAnimationFrame(follow);
  };

  const watch = setInterval(() => {
    const boxes = new Map<HTMLCanvasElement, Rect>();
    for (const t of targets.values()) {
      if (t.busy || !t.signature) continue;
      // still hidden after a change (it was off screen, or a read failed): try again while it is visible
      if (t.cover) { if (t.tries < 3 && inView(t.canvas)) boxes.set(t.canvas, t.cover); continue; }
      const now = signature(t.canvas);
      const box = now && changedBox(now, t.signature);
      if (box) boxes.set(t.canvas, box);
    }
    if (boxes.size) rescan([...boxes.keys()], boxes);
  }, WATCH_MS);

  (async () => {
    const cs = allCanvases(document).filter((c) => visibleRect(c));
    if (!cs.length) return say('no charts drawn on canvas on this page.');
    say(`reading text in ${cs.length} chart${cs.length > 1 ? 's' : ''} on this device…`);
    requestAnimationFrame(follow);
    const n = await scan(cs);
    say('checking again…');
    const extra = await verify();
    say(`blurred ${n + extra} item${n + extra === 1 ? '' : 's'} in ${cs.length} chart${cs.length > 1 ? 's' : ''}. Run again to remove.`);
    host.dataset.state = 'done';
    host.dataset.masks = String(n + extra);
    host.dataset.verifyAdded = String(extra);
  })().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    say(`could not read the charts: ${msg}`);
    host.dataset.state = 'error';
    host.dataset.error = msg;
  });

  return {
    stop() {
      stopped = true;
      clearInterval(watch);
      host.remove();
    },
  };
}

/** Entry point: the background injects this file; running it again removes the redactions. */
export function toggle(): void {
  const w = window as unknown as Record<string, State | undefined>;
  const prev = w[KEY];
  if (prev) {
    prev.stop();
    w[KEY] = undefined;
  } else {
    w[KEY] = start();
  }
}
