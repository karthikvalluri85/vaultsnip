/**
 * Marks inside a panel: connected components of pixels that stand out from the panel's background, one colour each.
 * Bars, slices, areas, lines and dots are marks whatever their colour (grey and pastel series included). Text is not:
 * components inside OCR word boxes are dropped, mask boxes are never marks, and 1-2 px rules (gridlines, axes) are
 * left to the callers, which ask for solid or long thin shapes.
 */
import { colorKey, height, isMaskGrey, width, type Box, type Img, type Word } from './image';

export interface Mark {
  key: number;            // colour bucket shared by the series
  b: Box;                 // bounding box
  n: number;              // pixel count
  fill: number;           // n / bounding-box area
  cx: number; cy: number; // centroid
}

/** How far (per channel) a pixel must be from the panel background to count as ink: low enough for pale grey bars on an off-white card. */
export const INK = 14;

/** Ink test for one panel: differs from its background and is not a mask box. */
export function inkTest(img: Img, box: Box) {
  const [br, bg, bb] = background(img, box), { data, channels: C, width: iw, height: ih } = img;
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= iw || y >= ih) return false;
    const i = (y * iw + x) * C, r = data[i], g = data[i + 1], b = data[i + 2];
    return !isMaskGrey(r, g, b) && Math.max(Math.abs(r - br), Math.abs(g - bg), Math.abs(b - bb)) > INK;
  };
}

/**
 * The panel's background colour: the most common colour along its inner border and across it. Mask grey is never the
 * background: in a panel made mostly of masked text (a header with a masked client name) it would otherwise win, and
 * the real background around the masks would read as bars.
 */
export function background(img: Img, box: Box): [number, number, number] {
  const counts = new Map<number, { n: number; rgb: [number, number, number] }>();
  const { data, channels: C, width: iw } = img;
  const add = (x: number, y: number) => {
    const i = (y * iw + x) * C, r = data[i], g = data[i + 1], b = data[i + 2];
    if (isMaskGrey(r, g, b)) return;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), e = counts.get(k);
    if (e) e.n++; else counts.set(k, { n: 1, rgb: [r, g, b] });
  };
  const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(img.width, Math.ceil(box[2])), y1 = Math.min(img.height, Math.ceil(box[3]));
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) add(x, y);
  let best = { n: -1, rgb: [255, 255, 255] as [number, number, number] };
  for (const e of counts.values()) if (e.n > best.n) best = e;
  return best.rgb;
}

/**
 * All marks in a box, largest first. Neighbouring ink pixels (8-connected, so thin diagonal lines hold together) join
 * when their colours are close: a line's antialiased edge stays in the line, while touching segments of different
 * colours (a stacked bar, adjacent slices) stay apart.
 */
export function findMarks(img: Img, box: Box, words: Word[] = [], minPixels = 6): Mark[] {
  const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(img.width, Math.ceil(box[2])), y1 = Math.min(img.height, Math.ceil(box[3]));
  const W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0) return [];
  const { data, channels: C } = img, iw = img.width;
  const [br, bg, bb] = background(img, box);
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((y0 + y) * iw + x0 + x) * C, r = data[i], g = data[i + 1], b = data[i + 2];
    if (isMaskGrey(r, g, b)) continue;
    if (Math.max(Math.abs(r - br), Math.abs(g - bg), Math.abs(b - bb)) > INK) on[y * W + x] = 1;
  }
  // text is not a mark: blank out every word box (a pixel of padding covers antialiasing)
  for (const w of words) {
    for (let y = Math.max(0, Math.floor(w.y - y0) - 1); y < Math.min(H, Math.ceil(w.y + w.h - y0) + 1); y++)
      for (let x = Math.max(0, Math.floor(w.x - x0) - 1); x < Math.min(W, Math.ceil(w.x + w.w - x0) + 1); x++) on[y * W + x] = 0;
  }
  const close = (p: number, q: number) => {
    const i = ((y0 + ((p / W) | 0)) * iw + x0 + (p % W)) * C, j = ((y0 + ((q / W) | 0)) * iw + x0 + (q % W)) * C;
    return Math.abs(data[i] - data[j]) < 40 && Math.abs(data[i + 1] - data[j + 1]) < 40 && Math.abs(data[i + 2] - data[j + 2]) < 40;
  };
  const seen = new Uint8Array(W * H), out: Mark[] = [], stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!on[s] || seen[s]) continue;
    let n = 0, sx = 0, sy = 0, bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    const keys = new Map<number, number>();
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      n++; sx += x; sy += y;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      const i = ((y0 + y) * iw + x0 + x) * C, k = colorKey(data[i], data[i + 1], data[i + 2]);
      keys.set(k, (keys.get(k) || 0) + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (on[q] && !seen[q] && close(p, q)) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n < minPixels) continue;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    // a component as large as the panel is a card fill or a background gradient, not a mark
    if (bw > W * 0.92 && bh > H * 0.92) continue;
    let key = 0, best = -1;
    for (const [k, m] of keys) if (m > best) { best = m; key = k; }
    out.push({ key, b: [x0 + bx0, y0 + by0, x0 + bx1 + 1, y0 + by1 + 1], n, fill: n / (bw * bh), cx: x0 + sx / n, cy: y0 + sy / n });
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * Dense columns often touch: faint or 1 px separators let neighbouring bars join one mark. Splits a mark at columns of
 * pixels that dip in count or change in brightness, when that leaves at least three bars of similar width; otherwise
 * returns the mark unchanged (an area or a single bar has no regular separators).
 */
export function splitColumns(img: Img, m: Mark, ink: (x: number, y: number) => boolean): Mark[] {
  const [x0, y0, x1, y1] = m.b, w = x1 - x0;
  if (w < 12 || m.fill < 0.35) return [m];
  const { data, channels: C, width: iw } = img;
  const cnt: number[] = [], lum: number[] = [], top: number[] = [];
  for (let x = x0; x < x1; x++) {
    let n = 0, l = 0, t = -1;
    for (let y = y0; y < y1; y++) {
      if (!ink(x, y)) continue;
      const i = (y * iw + x) * C; n++; l += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; if (t < 0) t = y;
    }
    cnt.push(n); lum.push(n ? l / n : 0); top.push(t < 0 ? y1 : t);
  }
  const sorted = [...cnt].sort((a, b) => a - b), medC = sorted[Math.floor(sorted.length * 0.6)];
  const lums = lum.filter((_, i) => cnt[i] > medC * 0.5).sort((a, b) => a - b), medL = lums[Math.floor(lums.length / 2)] || 0;
  const sep = cnt.map((n, i) => n < medC * 0.35 || (n > 0 && Math.abs(lum[i] - medL) > 4 && (i === 0 || i === w - 1 || Math.abs(lum[i - 1] - medL) <= 4 || Math.abs(lum[i + 1] - medL) <= 4)));
  const segs: [number, number][] = [];
  for (let i = 0, s = -1; i <= w; i++) { const on = i < w && !sep[i]; if (on && s < 0) s = i; if (!on && s >= 0) { if (i - s >= 2) segs.push([s, i]); s = -1; } }
  if (segs.length < 3) return [m];
  const widths = segs.map(([a, b]) => b - a);
  if (Math.max(...widths) > Math.min(...widths) * 3) return [m];
  return segs.map(([a, b]) => {
    const t = Math.min(...top.slice(a, b)), n = cnt.slice(a, b).reduce((s, v) => s + v, 0), bw = b - a, bh = Math.max(1, y1 - t);
    return { key: m.key, b: [x0 + a, t, x0 + b, y1] as Box, n, fill: Math.min(1, n / (bw * bh)), cx: x0 + (a + b) / 2, cy: (t + y1) / 2 };
  });
}

/** Small neutral specks (grey or black, a few dozen pixels) are pieces of text, not marks. */
export const isTextSpeck = (m: Mark) => {
  const r = ((m.key >> 8) & 15) * 16, g = ((m.key >> 4) & 15) * 16, b = (m.key & 15) * 16;
  return m.n < 80 && Math.max(r, g, b) - Math.min(r, g, b) < 24 && Math.max(width(m.b), height(m.b)) < 24;
};

/** Two colour buckets that are the same series colour (one step apart in each channel at most). */
export function sameColor(a: number, b: number) {
  return Math.abs(((a >> 8) & 15) - ((b >> 8) & 15)) <= 1 && Math.abs(((a >> 4) & 15) - ((b >> 4) & 15)) <= 1 && Math.abs((a & 15) - (b & 15)) <= 1;
}

/** Marks grouped by series colour, biggest series first. */
export function bySeries(marks: Mark[]): { key: number; marks: Mark[]; n: number }[] {
  const groups: { key: number; marks: Mark[]; n: number }[] = [];
  for (const m of marks) {
    const g = groups.find((g) => sameColor(g.key, m.key));
    if (g) { g.marks.push(m); g.n += m.n; } else groups.push({ key: m.key, marks: [m], n: m.n });
  }
  return groups.sort((a, b) => b.n - a.n);
}
