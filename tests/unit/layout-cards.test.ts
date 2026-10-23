// On-device layout builder, Phase 4(a): outlined cards, stacks of masked labels, KPI tiles at the top of a page, tall KPI
// cards, and mask grey never taken for a background. Images are drawn here with known geometry.
import { describe, expect, it } from 'vitest';
import { buildSpec } from '../../src/layout/index';
import { findOutlinedCards } from '../../src/layout/panels';
import { background } from '../../src/layout/marks';
import { labelStacks, type Box, type Img, type Word } from '../../src/layout/image';

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255], BORDER: RGB = [180, 180, 180], FRAME: RGB = [120, 120, 120], NAVY: RGB = [40, 56, 72], MASK: RGB = [0x78, 0x7c, 0x82], TEAL: RGB = [0, 180, 170];

function canvas(W: number, H: number, bg: RGB = WHITE): Img {
  const data = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) data.set(bg, i * 3);
  return { data, width: W, height: H, channels: 3 };
}
function fill(img: Img, b: Box, c: RGB) {
  for (let y = Math.max(0, b[1]); y < Math.min(img.height, b[3]); y++) for (let x = Math.max(0, b[0]); x < Math.min(img.width, b[2]); x++) img.data.set(c, (y * img.width + x) * 3);
}
/** A 1 px outline with corners cut off, as a rounded border looks. */
function outline(img: Img, b: Box, c: RGB, radius = 6) {
  fill(img, [b[0] + radius, b[1], b[2] - radius, b[1] + 1], c); fill(img, [b[0] + radius, b[3] - 1, b[2] - radius, b[3]], c);
  fill(img, [b[0], b[1] + radius, b[0] + 1, b[3] - radius], c); fill(img, [b[2] - 1, b[1] + radius, b[2], b[3] - radius], c);
}
const word = (text: string, x: number, y: number, w = text.length * 7, h = 12, kept = true): Word => ({ text, x, y, w, h, kept });
const masked = (x: number, y: number, w: number, h: number): Word => ({ text: '', x, y, w, h, kept: false });

/** A 3 × 2 grid of white KPI tiles outlined in grey on a white page, framed by a darker 1 px line round the image. */
function tileGrid() {
  const img = canvas(900, 420), words: Word[] = [], masks: { x: number; y: number; w: number; h: number }[] = [];
  outline(img, [0, 0, 900, 420], FRAME, 0);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const b: Box = [20 + c * 290, 20 + r * 200, 290 + c * 290, 200 + r * 200];
    outline(img, b, BORDER);
    // small labels outnumber big values on a real page, which sets the page's text height
    words.push(word('Revenue', b[0] + 16, b[1] + 16), word('vs', b[0] + 16, b[1] + 120), word('LY', b[0] + 40, b[1] + 120), word('Goal', b[0] + 150, b[1] + 100));
    fill(img, [b[0] + 16, b[1] + 60, b[0] + 116, b[1] + 100], MASK);
    words.push(masked(b[0] + 16, b[1] + 60, 100, 40)); masks.push({ x: b[0] + 16, y: b[1] + 60, w: 100, h: 40 });
    fill(img, [b[0] + 150, b[1] + 70, b[0] + 210 + c * 10, b[1] + 86], TEAL);   // a progress bar, as KPI tiles often carry
  }
  return { img, words, masks };
}

describe('outlined cards', () => {
  it('finds tiles that are the page colour, set apart only by a thin border, even inside a frame', () => {
    const { img } = tileGrid();
    const cards = findOutlinedCards(img);
    expect(cards).toHaveLength(6);
    expect(cards[0][0]).toBeLessThanOrEqual(21);
    expect(cards[0][2]).toBeGreaterThanOrEqual(288);
    expect(cards[0][2]).toBeLessThan(310);   // its own right edge, not the next tile's left one
  });

  it('a chart frame inside a card is not a card of its own', () => {
    const img = canvas(700, 300);
    outline(img, [20, 20, 330, 280], BORDER); outline(img, [360, 20, 680, 280], BORDER);
    outline(img, [60, 80, 300, 250], BORDER, 0);   // a plot frame
    expect(findOutlinedCards(img)).toHaveLength(2);
  });

  it('gridlines and bars are not cards', () => {
    const img = canvas(600, 300);
    for (let y = 40; y < 280; y += 40) fill(img, [30, y, 570, y + 1], BORDER);
    fill(img, [100, 100, 160, 280], TEAL);
    expect(findOutlinedCards(img)).toEqual([]);
  });

  it('a page of outlined KPI tiles becomes one KPI per tile', () => {
    const { img, words, masks } = tileGrid();
    const r = buildSpec({ image: img, words, masks });
    const types = r.spec.rows.flatMap((row) => row.visuals.map((v) => v.type));
    expect(types).toEqual(['kpi', 'kpi', 'kpi', 'kpi', 'kpi', 'kpi']);
  });
});

describe('masked labels and KPI values', () => {
  it('a tight vertical stack of masked boxes is labels, a sidebar of KPI values is not', () => {
    const axis = [0, 1, 2, 3].map((i) => masked(40, 100 + i * 26, 60, 22));
    const kpis = [0, 1, 2].map((i) => masked(40, 100 + i * 120, 90, 40));
    const s = labelStacks([...axis, ...kpis], 12);
    axis.forEach((w) => expect(s.has(w)).toBe(true));
    kpis.forEach((w) => expect(s.has(w)).toBe(false));
  });

  it('mask grey is never a panel background', () => {
    const img = canvas(200, 60, NAVY);
    fill(img, [10, 10, 190, 50], MASK);   // a header made mostly of a masked client name
    expect(background(img, [5, 5, 195, 55])).toEqual(NAVY);
  });
});
