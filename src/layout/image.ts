/**
 * Shared types and pixel helpers for the on-device layout builder (Phase 2).
 *
 * The builder sees exactly what the AI path would see: the masked image (grey boxes over masked text) and the words
 * that stayed visible. Masked words arrive with their position only; their text is removed before the builder runs,
 * so nothing that was masked can reach the spec.
 */

export type Box = [number, number, number, number];   // x0, y0, x1, y1 (pixels; x1/y1 exclusive)

/** RGB or RGBA pixels, row-major. */
export interface Img { data: Uint8ClampedArray | Uint8Array; width: number; height: number; channels: 3 | 4 }

/** An OCR word. `kept` words are readable in the masked image; masked words have `text: ''`. */
export interface Word { text: string; x: number; y: number; w: number; h: number; kept: boolean; conf?: number }

/** The colour of the mask boxes VaultSnip draws over masked text (app.js maskedCanvas). */
export const MASK_RGB: [number, number, number] = [0x78, 0x7c, 0x82];

export const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
export const width = (b: Box) => b[2] - b[0];
export const height = (b: Box) => b[3] - b[1];
export const center = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
export const inside = (p: [number, number], b: Box) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export const wordBox = (w: Word): Box => [w.x, w.y, w.x + w.w, w.y + w.h];
export const wordCenter = (w: Word): [number, number] => [w.x + w.w / 2, w.y + w.h / 2];
export const wordsIn = (words: Word[], b: Box) => words.filter((w) => inside(wordCenter(w), b));
export const median = (xs: number[], fallback = 0) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
/** Typical word height: the scale for every "is this text big" judgement. */
export const medianHeight = (words: Word[]) => median(words.map((w) => w.h), 12);

/** RGB image with transparency laid on white (transparent margins must not count as content). */
export function toRgb(img: Img): Img {
  if (img.channels === 3) return img;
  const { data, width: W, height: H } = img, out = new Uint8ClampedArray(W * H * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3] / 255;
    out[j] = data[i] * a + 255 * (1 - a); out[j + 1] = data[i + 1] * a + 255 * (1 - a); out[j + 2] = data[i + 2] * a + 255 * (1 - a);
  }
  return { data: out, width: W, height: H, channels: 3 };
}

export const rgbAt = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

/** Within a few levels of the mask grey: mask boxes are never chart marks. */
export const isMaskGrey = (r: number, g: number, b: number) =>
  Math.abs(r - MASK_RGB[0]) < 6 && Math.abs(g - MASK_RGB[1]) < 6 && Math.abs(b - MASK_RGB[2]) < 6;

/**
 * A pixel that is part of a coloured mark (bar, slice, line, dot): saturated, or a dark tinted fill such as Power BI's
 * charcoal series colour. Neutral greys (text, gridlines, axes) and the mask grey are not marks; small dark specks such
 * as tinted text are removed later by size.
 */
export function isMark(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (isMaskGrey(r, g, b)) return false;
  return (mx - mn > 38 && mx > 60) || (mx < 120 && mx - mn >= 9);
}

/** A masked big number: a box much taller than text and wider than tall (tall thin strips are masked axis labels). */
export const isBigBox = (w: { w: number; h: number }, med: number) => w.h > med * 1.55 && w.h < med * 14 && w.w >= w.h * 0.8;

/**
 * Masked words that sit in a tight vertical stack of three or more (the masked category labels along a bar chart's
 * axis, or the rows of a masked column): aligned on the left, the right or the centre, of similar height, each at
 * most 1.2 of its height below the last. Such a box is a label, never a KPI's big value, however tall its mask; KPI
 * tiles stacked in a sidebar are further apart, with their titles in between.
 */
export function labelStacks(words: Word[], med: number): Set<Word> {
  const masked = words.filter((w) => !w.kept).sort((a, b) => a.y - b.y);
  const tol = (a: Word, b: Word) => Math.max(med, Math.min(a.h, b.h) * 0.5);
  const aligned = (a: Word, b: Word) => Math.abs(a.x - b.x) <= tol(a, b) || Math.abs(a.x + a.w - (b.x + b.w)) <= tol(a, b)
    || Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= tol(a, b);
  const similar = (a: Word, b: Word) => Math.max(a.h, b.h) <= Math.min(a.h, b.h) * 1.6;
  const out = new Set<Word>(), used = new Set<Word>();
  for (const start of masked) {
    if (used.has(start)) continue;
    const run = [start];
    for (let last = start, next: Word | undefined; (next = masked.find((w) => !used.has(w) && !run.includes(w) && w.y > last.y
      && w.y - (last.y + last.h) <= last.h * 1.2 && aligned(last, w) && similar(last, w))); last = next) run.push(next);
    if (run.length >= 3) run.forEach((w) => { out.add(w); used.add(w); });
  }
  return out;
}

/** Colour bucket (4 bits per channel): pixels of one series share a bucket even with antialiasing at the edges. */
export const colorKey = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
export const keyHex = (k: number) => '#' + [(k >> 8) & 15, (k >> 4) & 15, k & 15].map((v) => (v * 16 + 8).toString(16).padStart(2, '0')).join('');

/** Most common colour bucket in a region and its share of the region. */
export function dominant(img: Img, b: Box, step = 3) {
  const counts = new Map<number, number>();
  let total = 0;
  for (let y = Math.max(0, b[1]); y < Math.min(img.height, b[3]); y += step) for (let x = Math.max(0, b[0]); x < Math.min(img.width, b[2]); x += step) {
    const [r, g, bl] = rgbAt(img, x, y); const k = colorKey(r, g, bl);
    counts.set(k, (counts.get(k) || 0) + 1); total++;
  }
  let best = 0, bk = 0xfff;
  for (const [k, n] of counts) if (n > best) { best = n; bk = k; }
  return { key: bk, share: best / Math.max(1, total) };
}
