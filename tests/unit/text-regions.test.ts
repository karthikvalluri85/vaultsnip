import { describe, expect, it } from 'vitest';
import { dbRegions, detectorSize, unreadParts, type Box } from '../../src/shared/text-regions';

/** A probability map with filled rectangles of a given probability. */
function map(w: number, h: number, rects: [number, number, number, number, number][]): Float32Array {
  const m = new Float32Array(w * h);
  for (const [x0, y0, rw, rh, p] of rects) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) m[y * w + x] = p;
  return m;
}

describe('dbRegions', () => {
  it('finds each confident kernel and grows it back by the unclip rule', () => {
    const r = dbRegions(map(100, 40, [[10, 10, 40, 6, 0.9], [70, 20, 20, 6, 0.95]]), 100, 40);
    expect(r).toHaveLength(2);
    const big = r[0];
    // a 40 × 6 kernel grows by about 40·6·1.5 / (2·46) ≈ 3.9 px on every side
    expect(big.x).toBeCloseTo(10 - 3.9, 0);
    expect(big.w).toBeCloseTo(40 + 7.8, 0);
    expect(big.h).toBeCloseTo(6 + 7.8, 0);
    expect(big.angle).toBeCloseTo(0, 5);
  });

  it('drops weak regions, thin noise and empty maps', () => {
    expect(dbRegions(map(60, 20, [[5, 5, 30, 6, 0.4]]), 60, 20)).toHaveLength(0);   // above 0.3 but mean below 0.6
    expect(dbRegions(map(60, 20, [[5, 5, 30, 1, 0.9]]), 60, 20)).toHaveLength(0);   // one pixel thin
    expect(dbRegions(new Float32Array(400), 20, 20)).toHaveLength(0);
  });

  it('measures a rotated kernel along its own axis', () => {
    const w = 80, h = 80, m = new Float32Array(w * h);
    for (let t = 0; t < 50; t++) for (let s = -2; s <= 2; s++) {           // a 50 × 5 bar at 45°
      const x = Math.round(15 + t * 0.707 - s * 0.707), y = Math.round(15 + t * 0.707 + s * 0.707);
      m[y * w + x] = 0.9; m[y * w + x + 1] = 0.9;
    }
    const [r] = dbRegions(m, w, h);
    // grown by about its thickness, not by half its upright box
    expect(r.w).toBeLessThan(35 + 2 * 6);
    // and it knows its own direction and size, to be cut out straightened
    expect(r.angle).toBeCloseTo(45, -1);
    expect(r.len).toBeGreaterThan(50);
    expect(r.thick).toBeLessThan(20);
  });

  it('keeps at most maxRegions, largest first', () => {
    const r = dbRegions(map(100, 20, [[2, 5, 10, 5, 0.9], [20, 5, 30, 5, 0.9], [60, 5, 20, 5, 0.9]]), 100, 20, { maxRegions: 2 });
    expect(r).toHaveLength(2);
    expect(r[0].w).toBeGreaterThan(r[1].w);
  });
});

describe('detectorSize', () => {
  it('keeps the longest side within the limit, in multiples of 32, never upscaling', () => {
    expect(detectorSize(2560, 1002, 960)).toEqual({ width: 960, height: 384 });
    expect(detectorSize(500, 300, 960)).toEqual({ width: 512, height: 288 });
    expect(detectorSize(10, 10, 960)).toEqual({ width: 32, height: 32 });
  });
});

describe('unreadParts', () => {
  const line: Box = { x: 0, y: 0, w: 200, h: 20 };

  it('a line fully explained by masks and kept words needs nothing', () => {
    expect(unreadParts([line], [{ x: 0, y: 0, w: 90, h: 20 }, { x: 100, y: 0, w: 100, h: 20 }])).toEqual([]);
  });

  it('masks only the part of a line nothing accounts for', () => {
    const [p] = unreadParts([line], [{ x: 0, y: 0, w: 80, h: 20 }]);
    expect(p.x).toBeGreaterThan(80);
    expect(p.x).toBeLessThan(90);
    expect(p.x + p.w).toBe(200);
  });

  it('a word space is not unread text', () => {
    expect(unreadParts([line], [{ x: 0, y: 0, w: 95, h: 20 }, { x: 108, y: 0, w: 92, h: 20 }])).toEqual([]);
  });

  it('a mask over the line above does not account for this line', () => {
    expect(unreadParts([line], [{ x: 0, y: -18, w: 200, h: 20 }])).toHaveLength(1);
  });

  it('a short word read and kept accounts for its region, although the grown box is much larger', () => {
    // "Jan": a 30 × 10 core grown by the unclip rule into a 45 × 25 box, which is no longer twice as wide as tall
    const jan = { x: 0, y: 0, w: 45, h: 25, core: { x: 7, y: 7, w: 30, h: 10 } };
    expect(unreadParts([jan], [{ x: 6, y: 5, w: 32, h: 14 }])).toEqual([]);
    expect(unreadParts([jan], [])).toEqual([{ x: 0, y: 0, w: 45, h: 25 }]);
  });

  it('an unread end of a line is masked out to the grown box', () => {
    const r = { x: 0, y: 0, w: 230, h: 25, core: { x: 7, y: 7, w: 216, h: 10 } };
    const [p] = unreadParts([r], [{ x: 7, y: 5, w: 100, h: 14 }]);
    expect(p.x + p.w).toBe(230);
    expect(p.y).toBe(0);
    expect(p.h).toBe(25);
  });

  it('a region that is not a line is masked whole when too much is uncovered', () => {
    const sq: Box = { x: 0, y: 0, w: 40, h: 40 };
    expect(unreadParts([sq], [])).toEqual([sq]);
    expect(unreadParts([sq], [{ x: 0, y: 0, w: 40, h: 36 }])).toEqual([]);
  });
});
