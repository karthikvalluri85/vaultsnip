import { describe, expect, it } from 'vitest';
import { dbRegions, detectorSize, flatMarksOnly, unreadParts, type Box } from '../../src/shared/text-regions';

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
  it('keeps the pixels within a limit x limit budget, in multiples of 32, never upscaling', () => {
    expect(detectorSize(2560, 1002, 960)).toEqual({ width: 1536, height: 608 });
    // a tall full-page capture keeps its text at half size, not a third
    expect(detectorSize(1920, 4436, 1536)).toEqual({ width: 1024, height: 2336 });
    expect(detectorSize(1000, 20000, 1536)).toEqual({ width: 320, height: 6144 });
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

describe('flatMarksOnly', () => {
  const WHITE = [255, 255, 255], BLUE = [60, 110, 220], DARK = [30, 30, 30], GREY = [200, 200, 200];
  const patch = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h });
  const fill = (p: ReturnType<typeof patch>, x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) p.data.set([...c, 255], (y * p.width + x) * 4);
  };
  // a crude glyph: an "E" with 2-pixel strokes
  const letterE = (p: ReturnType<typeof patch>, x: number, y: number, c: number[]) => {
    fill(p, x, y, x + 2, y + 12, c); fill(p, x, y, x + 8, y + 2, c); fill(p, x, y + 5, x + 7, y + 7, c); fill(p, x, y + 10, x + 8, y + 12, c);
  };

  it('a bar beside a label, with a gridline through the patch, holds no text', () => {
    const p = patch(120, 20);
    fill(p, 0, 4, 90, 16, BLUE);
    fill(p, 100, 0, 101, 20, GREY);
    expect(flatMarksOnly(p, 12)).toBe(true);
    expect(flatMarksOnly(patch(60, 20), 12)).toBe(true);
  });

  it('letters are not flat marks', () => {
    const p = patch(120, 20);
    for (let i = 0; i < 4; i++) letterE(p, 4 + i * 11, 4, DARK);
    expect(flatMarksOnly(p, 12)).toBe(false);
    // one letter beside a bar is enough
    const q = patch(120, 20);
    fill(q, 0, 4, 80, 16, BLUE); letterE(q, 100, 4, DARK);
    expect(flatMarksOnly(q, 12)).toBe(false);
  });

  it('a value printed inside a bar keeps the patch masked', () => {
    const hole = patch(120, 24);
    fill(hole, 0, 2, 110, 22, BLUE); letterE(hole, 50, 6, WHITE);   // in the background's colour: holes in the bar
    expect(flatMarksOnly(hole, 12)).toBe(false);
    const dark = patch(120, 24);
    fill(dark, 0, 2, 110, 22, BLUE); letterE(dark, 50, 6, DARK);   // in another colour
    expect(flatMarksOnly(dark, 12)).toBe(false);
  });

  it('a block shorter than a line of text is not taken for a bar', () => {
    const p = patch(40, 20);
    fill(p, 10, 4, 18, 16, DARK);   // 8 x 12: a heavy glyph, not a bar
    expect(flatMarksOnly(p, 14)).toBe(false);
  });
});

describe('isBar', () => {
  const patch = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h });
  const fill = (p: ReturnType<typeof patch>, x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) p.data.set([...c, 255], (y * p.width + x) * 4);
  };
  const BLUE = [60, 110, 220], DARK = [30, 30, 30];
  it('a bar the reader took for a word, with an axis line and a tick under it', async () => {
    const { isBar } = await import('../../src/shared/text-regions');
    const p = patch(128, 47);
    fill(p, 0, 0, 128, 32, BLUE); fill(p, 0, 38, 128, 39, [200, 200, 200]); fill(p, 60, 39, 61, 46, DARK);
    expect(isBar(p, 30)).toBe(true);
  });
  it('words are not bars, on a chip or not', async () => {
    const { isBar } = await import('../../src/shared/text-regions');
    const chip = patch(80, 20); fill(chip, 0, 0, 80, 20, BLUE);
    for (let i = 0; i < 5; i++) { fill(chip, 8 + i * 14, 4, 10 + i * 14, 16, [255, 255, 255]); fill(chip, 8 + i * 14, 4, 16 + i * 14, 6, [255, 255, 255]); }
    expect(isBar(chip, 14)).toBe(false);
    const dark = patch(80, 20); fill(dark, 0, 0, 80, 20, BLUE); fill(dark, 30, 5, 32, 15, DARK);   // one dark stroke on it
    expect(isBar(dark, 14)).toBe(false);
    const plain = patch(60, 16);
    for (let i = 0; i < 5; i++) { fill(plain, 2 + i * 11, 2, 4 + i * 11, 14, DARK); fill(plain, 2 + i * 11, 2, 9 + i * 11, 4, DARK); }
    expect(isBar(plain, 14)).toBe(false);
    const one = patch(8, 16); fill(one, 2, 1, 6, 15, DARK);   // a bold "I": too short for a bar
    expect(isBar(one, 16)).toBe(false);
  });
});
