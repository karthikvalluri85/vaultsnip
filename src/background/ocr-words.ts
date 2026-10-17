/** Pure helpers for canvas OCR (Feature 3): Tesseract TSV → words → mask boxes. */
import type { MaskBox } from './canvas-protocol';

export interface OcrWord {
  text: string;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Word rows (level 5) of Tesseract's TSV, in the coordinates of the image before it was scaled by `scale`.
 * Same confidence floors as ocr() in web/app.js: digits are the costliest leak, so unsure ones are kept.
 */
export function parseTsv(tsv: string, scale: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const line of tsv.split('\n')) {
    const c = line.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    const conf = parseFloat(c[10]);
    if (!text || conf < (/\d/.test(text) ? 12 : 30)) continue;
    out.push({ text, conf, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale });
  }
  return out;
}

/** Words the scanner flags, as padded boxes (padding as in buildMasks() in web/app.js). */
export function maskBoxes(words: readonly OcrWord[], types: readonly (string | null)[]): MaskBox[] {
  const boxes: MaskBox[] = [];
  words.forEach((w, i) => {
    const type = types[i];
    if (!type) return;
    const p = Math.max(3, w.h * 0.18);
    boxes.push({ x: w.x - p, y: w.y - p, w: w.w + 2 * p, h: w.h + 2 * p, type });
  });
  return boxes;
}

/** Words found by a later pass are kept only where no earlier pass already found one (as readAll() in web/app.js). */
export function mergePasses(passes: readonly OcrWord[][]): OcrWord[] {
  const all: OcrWord[] = [];
  for (const words of passes) {
    for (const w of words) if (!all.some((v) => overlap(v, w) > 0.3)) all.push(w);
  }
  return all;
}

/** Share of the smaller box covered by the other. */
export function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const small = Math.min(a.w * a.h, b.w * b.h);
  return small > 0 ? (ix * iy) / small : 0;
}
