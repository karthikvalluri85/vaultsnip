import { describe, expect, it } from 'vitest';
import { EXPOSED, covered, overlap, wilson } from '../../tools/synth-bench/metrics.mjs';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('masking benchmark measures', () => {
  it('covered: none, all, half, and overlapping masks counted once', () => {
    const word = box(10, 10, 80, 12);
    expect(covered(word, [])).toBe(0);
    expect(covered(word, [box(0, 0, 200, 50)])).toBe(1);
    expect(covered(word, [box(0, 0, 50, 50)])).toBeCloseTo(0.5, 2);
    expect(covered(word, [box(0, 0, 50, 50), box(0, 0, 50, 50)])).toBeCloseTo(0.5, 2);
  });

  it('covered: a mask that misses the last letters leaves the word exposed', () => {
    const word = box(0, 0, 100, 10);
    expect(1 - covered(word, [box(0, 0, 80, 10)])).toBeGreaterThan(EXPOSED);
    expect(1 - covered(word, [box(0, 0, 90, 10)])).toBeLessThanOrEqual(EXPOSED);
  });

  it('overlap is relative to the smaller box', () => {
    expect(overlap(box(0, 0, 10, 10), box(100, 100, 10, 10))).toBe(0);
    expect(overlap(box(0, 0, 10, 10), box(0, 0, 200, 200))).toBe(1);
    expect(overlap(box(0, 0, 10, 10), box(5, 0, 10, 10))).toBeCloseTo(0.5);
  });

  it('wilson matches the textbook interval and never leaves 0-100', () => {
    const w = wilson(10, 100);
    expect(w.pct).toBe(10);
    expect(w.lo).toBeCloseTo(5.52, 1);
    expect(w.hi).toBeCloseTo(17.44, 1);
    expect(wilson(0, 50).lo).toBe(0);
    expect(wilson(50, 50).hi).toBe(100);
    expect(wilson(0, 0).pct).toBeNull();
  });
});
