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

/** The input size for the detector: the longest side at most `limit`, both sides multiples of 32, never upscaled. */
export function detectorSize(width: number, height: number, limit: number): { width: number; height: number } {
  const k = Math.min(1, limit / Math.max(width, height));
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
