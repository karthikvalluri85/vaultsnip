/**
 * Text regions (Phase 2): turning the text detector's probability map into boxes, and deciding which parts of those
 * boxes to mask. Pure functions, shared by the ML worker and the app page, tested in tests/unit/text-regions.test.ts.
 *
 * The detector (PP-OCRv5_mobile_det) finds where text is without reading it. The app's reader (OCR) may miss words,
 * especially small, rotated, coloured or low-contrast ones, and a missed word is never classified, so it is never
 * masked. With the detector, every region of text must be accounted for: covered by a mask, or by a word the reader
 * read confidently and judged safe. Whatever is left is masked as unread text.
 */

export interface Box { x: number; y: number; w: number; h: number }

/** A detected region: the grown box (what gets masked) and its core, the kernel the model found before growing. */
export interface Region extends Box {
  core?: Box;
  /** The text's direction in degrees (0 = left to right, ±90 = vertical; y grows downwards), and its grown length and
   *  thickness along that direction: enough to cut the text out straightened. */
  angle?: number; len?: number; thick?: number;
}

export interface DbOptions {
  /** Probability above which a pixel belongs to text (PaddleOCR's default 0.3). */
  thresh: number;
  /** Mean probability a region needs to be kept (PaddleOCR's default 0.6). */
  boxThresh: number;
  /** How far a region grows back from the shrunk kernel the model outputs (PaddleOCR's default 1.5). */
  unclip: number;
  /** Regions thinner than this, in map pixels, are noise. */
  minSide: number;
  /** At most this many regions, largest first. */
  maxRegions: number;
}

export const DB_DEFAULTS: DbOptions = { thresh: 0.3, boxThresh: 0.6, unclip: 1.5, minSide: 2, maxRegions: 1000 };

/**
 * DB post-processing (as in PaddleOCR's DBPostProcess): pixels above `thresh` are grouped into 8-connected regions;
 * a region is kept when its mean probability reaches `boxThresh`. Its length and thickness come from the spread of its
 * pixels (so a rotated label is measured along its own axis), and it is grown by area × unclip / perimeter, the
 * model's own rule for undoing the shrinking it was trained with. Returns upright boxes in map pixels, each with its
 * core: whether a word accounts for a region is judged on the core, which a read word's box covers; the grown box is
 * much larger than a short word's box.
 */
export function dbRegions(prob: ArrayLike<number>, width: number, height: number, opts: Partial<DbOptions> = {}): Region[] {
  const o = { ...DB_DEFAULTS, ...opts };
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const out: (Region & { area: number })[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || !(prob[start] > o.thresh)) continue;
    let top = 0, count = 0, sum = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const p = stack[--top], x = p % width, y = (p - x) / width;
      count++; sum += prob[p]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const q = yy * width + xx;
          if (!seen[q] && prob[q] > o.thresh) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }
    if (sum / count < o.boxThresh) continue;
    // a uniform rectangle of length L has variance L²/12 along it: its sides from the two principal variances
    const mx = sx / count, my = sy / count;
    const vxx = sxx / count - mx * mx + 1 / 12, vyy = syy / count - my * my + 1 / 12, vxy = sxy / count - mx * my;
    const mid = (vxx + vyy) / 2, r = Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
    const long = Math.sqrt(12 * (mid + r)), thin = Math.sqrt(12 * Math.max(mid - r, 1 / 12));
    if (thin < o.minSide) continue;
    const d = (long * thin * o.unclip) / (2 * (long + thin));
    const angle = (Math.atan2(2 * vxy, vxx - vyy) / 2) * (180 / Math.PI);
    const bx0 = Math.max(0, x0 - d), by0 = Math.max(0, y0 - d), bx1 = Math.min(width, x1 + 1 + d), by1 = Math.min(height, y1 + 1 + d);
    out.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, core: { x: x0, y: y0, w: x1 + 1 - x0, h: y1 + 1 - y0 },
      angle, len: long + 2 * d, thick: thin + 2 * d, area: count });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, o.maxRegions).map(({ area: _a, ...b }) => b);
}

/**
 * The input size for the detector: at most as many pixels as a `limit` x `limit` square (and no side over 4 x `limit`),
 * both sides multiples of 32, never upscaled. A budget of pixels, not a longest side: a tall full-page capture scaled
 * by its height left its text too small for the detector to find.
 */
export function detectorSize(width: number, height: number, limit: number): { width: number; height: number } {
  const k = Math.min(1, limit / Math.sqrt(width * height), (4 * limit) / Math.max(width, height));
  return { width: Math.max(32, Math.round((width * k) / 32) * 32), height: Math.max(32, Math.round((height * k) / 32) * 32) };
}

export interface UnreadOptions {
  /** A gap narrower than this many region heights is the space between words, not unread text. */
  minGap: number;
  /** Covering boxes are widened by this many region heights on each side, so letter and word spacing closes. */
  pad: number;
  /** A region that is not clearly a line (a rotated label, a single short word) is masked whole above this uncovered share. */
  maxUncovered: number;
}

export const UNREAD_DEFAULTS: UnreadOptions = { minGap: 0.6, pad: 0.35, maxUncovered: 0.25 };

/**
 * The parts of each text region that nothing accounts for. `cover` holds the masks and the boxes of words the reader
 * read confidently and kept; anything else inside a region is text the reader missed or could not read.
 * Coverage is judged on each region's core (the text itself), and what is masked spans the grown box.
 * A line of text (a core at least twice as wide as tall) is checked along its length, so a kept title next to an
 * unread name masks only the name; any other region is masked whole when too much of its core is uncovered.
 */
export function unreadParts(regions: readonly Region[], cover: readonly Box[], opts: Partial<UnreadOptions> = {}): Box[] {
  const o = { ...UNREAD_DEFAULTS, ...opts };
  const out: Box[] = [];
  for (const r of regions) {
    const k = r.core ?? r;
    const near = cover.filter((c) => c.x < k.x + k.w && c.x + c.w > k.x && c.y < k.y + k.h && c.y + c.h > k.y);
    if (k.w >= 2 * k.h) {
      const pad = o.pad * k.h;
      // only boxes that span most of the line's height account for it (not a mask over the line above)
      const spans = near.filter((c) => Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y) >= 0.5 * Math.min(c.h, k.h))
        .map((c) => [Math.max(k.x, c.x - pad), Math.min(k.x + k.w, c.x + c.w + pad)] as const)
        .sort((a, b) => a[0] - b[0]);
      let at = k.x;
      const gaps: [number, number][] = [];
      for (const [a, b] of spans) { if (a > at) gaps.push([at, a]); at = Math.max(at, b); }
      if (at < k.x + k.w) gaps.push([at, k.x + k.w]);
      for (const [a, b] of gaps) {
        if (b - a < o.minGap * k.h) continue;
        // a gap at either end of the core reaches the grown box's edge there
        const x0 = a <= k.x ? r.x : a, x1 = b >= k.x + k.w ? r.x + r.w : b;
        out.push({ x: x0, y: r.y, w: x1 - x0, h: r.h });
      }
    } else if (uncovered(k, near) > o.maxUncovered) {
      out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  }
  return out;
}

/** Share of box b not covered by any of the boxes, from a grid of sample points. */
function uncovered(b: Box, boxes: readonly Box[]): number {
  if (!boxes.length) return 1;
  const nx = 12, ny = 12;
  let miss = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const px = b.x + ((i + 0.5) / nx) * b.w, py = b.y + ((j + 0.5) / ny) * b.h;
    if (!boxes.some((m) => px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h)) miss++;
  }
  return miss / (nx * ny);
}

/** RGBA pixels of a patch, as in ImageData. */
export interface Pixels { data: ArrayLike<number>; width: number; height: number }

/**
 * Whether an unread patch holds no text at all, only flat marks: a chart's bar beside its label, a legend chip, a
 * gridline or a tick. The detector often joins a label and the bar beside it into one line, and masking the bar's
 * part as unread text hides the chart. The patch passes only when every piece of ink in it is
 *  - a solid block of one colour, at least a text height long and 3 pixels thick, filling its box, with no hole in it
 *    (text drawn inside a bar is either a different colour or a hole in it, and fails),
 *  - a straight line at most 2 pixels thick (gridlines, ticks, axis lines), or
 *  - a speck of at most 4 pixels (JPEG noise, a full stop).
 * Glyphs are thin strokes that fill little of their box, so any letter or digit fails it and the patch is masked as
 * before. The background is the commonest colour on the patch's edge.
 */
export function flatMarksOnly(px: Pixels, textH: number): boolean {
  return solidBlocks(px, textH) >= 0;
}

/** The number of solid blocks in a patch that holds flat marks only (see flatMarksOnly), or -1 when it may hold text. */
function solidBlocks(px: Pixels, textH: number): number {
  const { data, width: w, height: h } = px;
  if (w < 1 || h < 1) return 0;
  let blocks = 0;
  const at = (i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // background: the commonest colour (to 4 bits a channel) along the edge
  const counts = new Map<number, number>();
  const key = (i: number) => ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const k = key(y * w + x); counts.set(k, (counts.get(k) || 0) + 1); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const k = key(y * w + x); counts.set(k, (counts.get(k) || 0) + 1); }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let bgPx = -1;
  for (let i = 0; i < w * h && bgPx < 0; i++) if (key(i) === bgKey) bgPx = i;
  const bg = at(bgPx);
  // ink: anything visibly different from the background (faint text included)
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = dist(at(i), bg) > 24 ? 1 : 0;
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!ink[s] || seen[s]) continue;
    const members: number[] = [];
    let top = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w;
      members.push(p);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && ink[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (members.length <= 4 || Math.min(bw, bh) <= 2) continue;   // a speck, or a gridline, tick or axis line
    if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3 || members.length < 0.85 * bw * bh) return -1;
    // one colour inside (away from the anti-aliased rim): text in another colour on a bar fails here
    const inner = members.filter((p) => { const x = p % w, y = (p - x) / w; return x > x0 + 1 && x < x1 - 1 && y > y0 + 1 && y < y1 - 1; });
    if (inner.length) {
      const ref = at(inner[0]);
      let off = 0;
      for (const p of inner) if (dist(at(p), ref) > 40) off++;
      if (off > 2) return -1;
    }
    // no holes: background pixels inside its box that cannot reach the box's edge (text in the background's colour)
    const inBox = new Uint8Array(bw * bh), reach = new Int32Array(bw * bh);
    for (const p of members) { const x = p % w, y = (p - x) / w; inBox[(y - y0) * bw + (x - x0)] = 1; }
    let rt = 0, holes = bw * bh - members.length;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
      const q = yy * bw + xx;
      if ((xx === 0 || yy === 0 || xx === bw - 1 || yy === bh - 1) && !inBox[q]) { inBox[q] = 2; reach[rt++] = q; }
    }
    while (rt) {
      const q = reach[--rt]; holes--;
      const xx = q % bw, yy = (q - xx) / bw;
      for (const r of [xx > 0 ? q - 1 : -1, xx < bw - 1 ? q + 1 : -1, yy > 0 ? q - bw : -1, yy < bh - 1 ? q + bw : -1]) {
        if (r >= 0 && !inBox[r]) { inBox[r] = 2; reach[rt++] = r; }
      }
    }
    if (holes > 2) return -1;
    blocks++;
  }
  return blocks;
}

/**
 * Whether a box the reader took for a word is a chart's bar: most of it (at least half) is one colour, and the pixels of
 * that colour make a solid rectangle at least a text height long and 3 pixels thick, with no hole in it. Letters never
 * fill their box as one solid rectangle, and a word printed on a coloured chip or inside a bar is a set of holes in it,
 * so neither passes. What is left around the rectangle (an axis line, a tick, background) does not matter.
 */
export function isBar(px: Pixels, textH: number): boolean {
  const { data, width: w, height: h } = px;
  if (w < 3 || h < 3) return false;
  const counts = new Map<number, number>();
  const key = (i: number) => ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
  for (let i = 0; i < w * h; i++) { const k = key(i); counts.set(k, (counts.get(k) || 0) + 1); }
  const [topKey, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topN < 0.5 * w * h) return false;
  let ref = 0;
  while (key(ref) !== topKey) ref++;
  const c = [data[ref * 4], data[ref * 4 + 1], data[ref * 4 + 2]];
  const near = (i: number) => Math.hypot(data[i * 4] - c[0], data[i * 4 + 1] - c[1], data[i * 4 + 2] - c[2]) <= 40;
  // the rectangle: the rows and columns where that colour fills most of the line
  const rows: number[] = [], cols: number[] = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (near(y * w + x)) n++; if (n >= 0.5 * w) rows.push(y); }
  if (!rows.length) return false;
  const y0 = rows[0], y1 = rows[rows.length - 1];
  for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (near(y * w + x)) n++; if (n >= 0.5 * (y1 - y0 + 1)) cols.push(x); }
  if (!cols.length) return false;
  const x0 = cols[0], x1 = cols[cols.length - 1], bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3) return false;
  // solid: every pixel inside it, away from its anti-aliased rim, is that colour
  let off = 0;
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (!near(y * w + x)) off++;
  return off <= 2;
}
