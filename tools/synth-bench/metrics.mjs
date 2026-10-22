// The masking benchmark's measures (tools/synth-bench/run.mjs), kept apart so they can be unit tested. Boxes are
// { x, y, w, h } in one pixel space.

/** A sensitive word counts as exposed when more than this share of its ink box is not covered. */
export const EXPOSED = 0.15;

/** Share of box b covered by any of the boxes, from a 16 × 6 grid of sample points (overlapping boxes count once). */
export function covered(b, boxes) {
  const near = boxes.filter((m) => m.x < b.x + b.w && m.x + m.w > b.x && m.y < b.y + b.h && m.y + m.h > b.y);
  if (!near.length) return 0;
  const nx = 16, ny = 6;
  let hit = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const px = b.x + ((i + 0.5) / nx) * b.w, py = b.y + ((j + 0.5) / ny) * b.h;
    if (near.some((m) => px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h)) hit++;
  }
  return hit / (nx * ny);
}

/** Shared area of two boxes as a share of the smaller one: a small finding on a long word, or the reverse, both count. */
export function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
}

/** 95% Wilson score interval for k out of n, in percent with two decimals. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { pct: null, lo: null, hi: null, k, n };
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  const r = (v) => Math.round(v * 10000) / 100;
  return { pct: r(p), lo: r(Math.max(0, c - h)), hi: r(Math.min(1, c + h)), k, n };
}
