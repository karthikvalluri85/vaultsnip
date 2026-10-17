import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedBox, cropForCanvas, pixelDelta, SIG, toCss, uncovered, unionBox } from '../../src/content/canvas-ocr';
import { maskBoxes, mergePasses, overlap, parseTsv } from '../../src/background/ocr-words';
import { ALLOW_WORDS } from '../../src/shared/allowlist';

describe('canvas geometry', () => {
  it('maps a canvas’s own pixels onto its CSS box', () => {
    // 1280×440 backing store shown at 640×220 CSS px (DPR 2)
    const m = { scale: 640 / 1280, offX: 0, offY: 0 };
    expect(toCss({ x: 100, y: 40, w: 200, h: 30 }, m)).toEqual({ x: 50, y: 20, w: 100, h: 15 });
  });

  it('crops a tab screenshot to the visible part of a canvas and maps it back', () => {
    const rect = { x: 24, y: 700, w: 640, h: 220 };              // runs off the bottom of an 800 px viewport
    const cut = cropForCanvas(rect, { w: 1000, h: 800 }, 2)!;    // screenshot at DPR 2
    expect(cut.crop).toEqual({ x: 48, y: 1400, w: 1280, h: 200 });
    // A box at the crop's top-left lands at the canvas's top-left; 2 screenshot px = 1 CSS px.
    expect(toCss({ x: 0, y: 0, w: 20, h: 10 }, cut.map)).toEqual({ x: 0, y: 0, w: 10, h: 5 });
  });

  it('accounts for a canvas scrolled partly above the viewport', () => {
    const cut = cropForCanvas({ x: 10, y: -50, w: 300, h: 200 }, { w: 1000, h: 800 }, 1)!;
    expect(cut.crop).toEqual({ x: 10, y: 0, w: 300, h: 150 });
    expect(toCss({ x: 0, y: 0, w: 1, h: 1 }, cut.map)).toMatchObject({ x: 0, y: 50 }); // 50 px down the canvas
  });

  it('skips canvases that are off screen or nearly so', () => {
    expect(cropForCanvas({ x: 0, y: 900, w: 300, h: 200 }, { w: 1000, h: 800 }, 1)).toBeNull();
    expect(cropForCanvas({ x: 0, y: 795, w: 300, h: 200 }, { w: 1000, h: 800 }, 1)).toBeNull();
  });

  it('finds what a re-check read outside the existing masks', () => {
    const masks = [{ x: 0, y: 0, w: 100, h: 20 }];
    const found = [{ x: 10, y: 2, w: 30, h: 10 }, { x: 150, y: 2, w: 30, h: 10 }];
    expect(uncovered(found, masks)).toEqual([found[1]]);
  });

  it('measures how much a canvas changed', () => {
    expect(pixelDelta([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
    expect(pixelDelta([0, 0, 0, 0], [255, 255, 0, 0])).toBe(127.5);
    expect(pixelDelta([0], [0, 0])).toBe(255);
  });
});

describe('canvas OCR words', () => {
  const tsv = (rows: [string, number, number, number, number, number][]) =>
    ['level\tpage\tblock\tpar\tline\tword\tleft\ttop\twidth\theight\tconf\ttext',
      ...rows.map(([t, c, x, y, w, h]) => `5\t1\t1\t1\t1\t1\t${x}\t${y}\t${w}\t${h}\t${c}\t${t}`)].join('\n');

  it('reads word rows and undoes the OCR upscale', () => {
    expect(parseTsv(tsv([['Kestrelmoor', 91, 200, 80, 220, 40]]), 2)).toEqual([{ text: 'Kestrelmoor', conf: 91, x: 100, y: 40, w: 110, h: 20 }]);
  });

  it('keeps unsure digits but drops unsure words (as the app does)', () => {
    const words = parseTsv(tsv([['1,204', 15, 0, 0, 10, 10], ['Globex', 25, 0, 0, 10, 10], ['Initech', 35, 0, 0, 10, 10]]), 1);
    expect(words.map((w) => w.text)).toEqual(['1,204', 'Initech']);
  });

  it('pads flagged words and leaves the rest alone', () => {
    const words = [{ text: 'Revenue', conf: 90, x: 0, y: 0, w: 70, h: 20 }, { text: 'Globex', conf: 90, x: 80, y: 0, w: 60, h: 20 }];
    const boxes = maskBoxes(words, [null, 'Text not on allowlist']);
    const r = (v: number) => Math.round(v * 10) / 10;
    expect(boxes.map((b) => ({ ...b, x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) }))).toEqual([{ x: 76.4, y: -3.6, w: 67.2, h: 27.2, type: 'Text not on allowlist' }]);
  });

  it('merges OCR passes without double-counting a word', () => {
    const a = { text: 'Globex', conf: 90, x: 0, y: 0, w: 60, h: 20 };
    const sameSpot = { ...a, text: 'G1obex', x: 2 };
    const elsewhere = { ...a, x: 200 };
    expect(mergePasses([[a], [sameSpot, elsewhere]])).toEqual([a, elsewhere]);
    expect(overlap(a, elsewhere)).toBe(0);
  });
});

describe('shared allowlist', () => {
  it('matches ALLOW in web/app.js exactly', () => {
    const app = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
    const m = app.match(/const ALLOW = new Set\(\(`([\s\S]*?)`\)/);
    expect(m, 'ALLOW not found in web/app.js').toBeTruthy();
    expect([...new Set(ALLOW_WORDS)].sort()).toEqual([...new Set(m![1].split(/\s+/).filter(Boolean))].sort());
  });
});

describe('redraw detection', () => {
  const blank = () => new Uint8ClampedArray(SIG * SIG * 4).fill(255);
  const paintCells = (a: Uint8ClampedArray, x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * SIG + x) * 4; a[i] = a[i + 1] = a[i + 2] = 20; }
    return a;
  };

  it('finds one new label in an empty part of a chart, which an average over the chart misses', () => {
    const before = blank(), after = paintCells(blank(), 40, 30, 8, 2); // ~0.4% of the thumbnail
    expect(pixelDelta(after, before)).toBeLessThan(2);                  // the old test: no redraw seen
    const box = changedBox(after, before)!;
    expect(box).not.toBeNull();
    // the box covers the label, with one cell of margin
    expect(box.x).toBeCloseTo(39 / SIG); expect(box.y).toBeCloseTo(29 / SIG);
    expect(box.w).toBeCloseTo(10 / SIG); expect(box.h).toBeCloseTo(4 / SIG);
  });

  it('sees nothing when nothing changed, and treats a size change as a change everywhere', () => {
    expect(changedBox(blank(), blank())).toBeNull();
    expect(changedBox(blank(), new Uint8ClampedArray(16))).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('ignores tiny anti-aliasing differences', () => {
    const a = blank(), b = blank(); b[100] = 240;
    expect(changedBox(a, b)).toBeNull();
  });

  it('joins covered regions', () => {
    const u = unionBox({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 })!;
    [u.x, u.y, u.w, u.h].forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.1, 0.6, 0.6][i]));
    expect(unionBox(null, { x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
