// On-device layout builder, Phase 4(a): outlined cards, stacks of masked labels, KPI tiles at the top of a page, tall KPI
// cards, and mask grey never taken for a background. Images are drawn here with known geometry.
import { describe, expect, it } from 'vitest';
import { buildSpec } from '../../src/layout/index';
import { findOutlinedCards, findPanels, findRegions } from '../../src/layout/panels';
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

describe('maps', () => {
  it('irregular regions in shades of one colour, touching one another, read as a filled map', () => {
    const img = canvas(520, 360);
    // countries: the cells of 18 seed points (each pixel goes to its nearest seed) inside an oval continent, in shades of
    // one blue, with 1 px white borders where two cells meet
    const shades: RGB[] = [[198, 219, 239], [158, 202, 225], [107, 174, 214], [66, 146, 198], [33, 113, 181], [8, 81, 156]];
    const seeds: [number, number][] = [];
    for (let i = 0; i < 18; i++) seeds.push([90 + ((i * 97) % 340), 70 + ((i * 53) % 230)]);
    for (let y = 40; y < 330; y++) for (let x = 40; x < 480; x++) {
      if (((x - 260) / 215) ** 2 + ((y - 185) / 140) ** 2 > 1) continue;
      const d = seeds.map(([sx, sy], k) => [(x - sx) ** 2 + (y - sy) ** 2, k]).sort((a, b) => a[0] - b[0]);
      if (Math.sqrt(d[1][0]) - Math.sqrt(d[0][0]) < 1.2) continue;   // a border
      img.data.set(shades[d[0][1] % shades.length], (y * img.width + x) * 3);
    }
    const words = [word('Sales', 10, 8)];
    const r = buildSpec({ image: img, words, masks: [] });
    expect(r.spec.rows.flatMap((row) => row.visuals.map((v) => v.type))).toContain('map');
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

  it("a table's zebra stripes are rows, while equal bars are still a bar chart", async () => {
    const { readPanel } = await import('../../src/layout/charts');
    const STRIPE: RGB = [214, 230, 240];
    const table = canvas(420, 300);
    const words: Word[] = [];
    for (let r = 0; r < 9; r++) {
      const y = 20 + r * 28;
      if (r % 2 === 0) fill(table, [10, y, 410, y + 28], STRIPE);
      words.push(word('Name', 20, y + 8, 60), word('Manager', 160, y + 8, 70), word('4.5', 330, y + 8, 24));
    }
    expect(readPanel(table, [0, 0, 420, 300], words, 12, 'Top Employees').type).toBe('table');

    const chart = canvas(420, 300);
    const labels: Word[] = [];
    for (let r = 0; r < 8; r++) {
      const y = 30 + r * 30;
      fill(chart, [150, y, 400, y + 9], TEAL);   // every bar the same length, thinner than a row
      labels.push(word('Platelets', 20, y - 2, 60), word('volume', 84, y - 2, 50));
    }
    expect(readPanel(chart, [0, 0, 420, 300], labels, 12, 'Top Lab Tests').type).toBe('bar');
  });

  it('bars covering most of a panel are not its background', () => {
    const img = canvas(400, 300);
    for (let i = 0; i < 6; i++) fill(img, [40 + i * 58, 60, 92 + i * 58, 270], TEAL);   // 6 wide columns, ~55% of the panel
    expect(background(img, [0, 0, 400, 300])).toEqual(WHITE);
  });
});

describe('sub-figures of a KPI card', () => {
  const reading = (b: Box, type: string, marks = 0, nWords = 3) => ({ p: { b, words: Array.from({ length: nWords }, () => word('x', b[0], b[1])) }, r: { type }, features: { marks } });
  it('join the card they belong to; KPI tiles and charts stay apart', async () => {
    const { foldSubFigures } = await import('../../src/layout/index');
    const card = reading([200, 140, 420, 270], 'kpi');
    const sub = reading([215, 295, 380, 330], 'kpi');           // "Current workforce: 6,009" under the card
    const inside = reading([300, 240, 360, 262], 'kpi');        // a "vs LY" delta inside it
    const tile = reading([440, 140, 660, 270], 'kpi');          // the next KPI tile: its own visual
    const chart = reading([200, 400, 600, 760], 'bar', 12, 20);
    const rs = [card, sub, inside, tile, chart];
    foldSubFigures(rs, 1300, 830, 12, []);
    expect(rs).toEqual([card, tile, chart]);
    expect(card.p.b).toEqual([200, 140, 420, 330]);
  });
});

describe('an axis of months in order', () => {
  it('fills a covered or misread month from its neighbours, and leaves other axes alone', async () => {
    const { monthsInOrder } = await import('../../src/layout/charts');
    expect(monthsInOrder(['Jan', 'Feb', 'Max', 'Item 4', 'May', 'Jun'])).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
    expect(monthsInOrder(['Item 1', 'Aug', 'Sep', 'Oct', 'Item 5'])).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(monthsInOrder(['Nov', 'Dec', 'Jan', 'Feb'])).toEqual(['Nov', 'Dec', 'Jan', 'Feb']);
    // too few months to be sure, or not in order: unchanged
    expect(monthsInOrder(['Item 1', 'Feb', 'Item 3', 'Apr', 'Item 5', 'Item 6'])).toEqual(['Item 1', 'Feb', 'Item 3', 'Apr', 'Item 5', 'Item 6']);
    expect(monthsInOrder(['North', 'South', 'East', 'West'])).toEqual(['North', 'South', 'East', 'West']);
    expect(monthsInOrder(['May', 'Jan', 'Sep', 'Mar'])).toEqual(['May', 'Jan', 'Sep', 'Mar']);
  });
});

describe('cards on tinted, framed and shaded pages', () => {
  const BLUE: RGB = [52, 120, 200], ORANGE: RGB = [240, 140, 40];
  const big = (ps: { b: Box }[], img: Img) => ps.some((p) => (p.b[2] - p.b[0]) * (p.b[3] - p.b[1]) > img.width * img.height * 0.45);
  /** A small column chart with a title, inside box b. */
  function chart(img: Img, words: Word[], b: Box, title: string) {
    words.push(word(title, b[0] + 12, b[1] + 10));
    // (bars across the card with labels under them, as a chart fills its card)
    const n = 6, w = (b[2] - b[0] - 60) / n, labels = ['North', 'South', 'East', 'West', 'Central', 'Online'];
    [0.8, 0.5, 0.65, 0.3, 0.9, 0.45].forEach((h, i) => { const x = Math.round(b[0] + 30 + i * w); fill(img, [x, Math.round(b[3] - 40 - (b[3] - b[1] - 90) * h), Math.round(x + w * 0.7), b[3] - 40], BLUE); words.push(word(labels[i], x, b[3] - 32)); });
  }
  it('a framed header 6 px above a framed content box is cut from it (a gutter beside a box edge, on a large page)', () => {
    const img = canvas(1400, 900);
    outline(img, [10, 8, 1390, 95], NAVY, 0); fill(img, [40, 40, 380, 62], NAVY);
    outline(img, [10, 100, 1390, 880], NAVY, 0);
    [0.8, 0.5, 0.65, 0.3, 0.9, 0.45].forEach((h, k) => fill(img, [60 + k * 220, Math.round(860 - 700 * h), 200 + k * 220, 860], BLUE));
    const rs = findRegions(img);
    expect(rs.some((r) => r[1] < 95 && r[3] > 100)).toBe(false);
    expect(rs.some((r) => r[3] <= 96)).toBe(true);
  });
  it('white cards on a light blue page, inside a white frame', () => {
    const img = canvas(1200, 800), words: Word[] = [];
    fill(img, [10, 10, 1190, 790], [229, 241, 250]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const b: Box = [16 + c * 586, 16 + r * 386, 596 + c * 586, 396 + r * 386];
      fill(img, b, WHITE); outline(img, b, [160, 203, 232]);
      chart(img, words, b, ['Region', 'Product', 'Quarter', 'Segment'][r * 2 + c]);
    }
    const ps = findPanels(img, words, 12);
    expect(big(ps, img)).toBe(false);
    expect(ps.length).toBeGreaterThanOrEqual(4);
  });
  it('translucent cards over a gradient page, each shading from top to bottom', () => {
    const img = canvas(1200, 800), words: Word[] = [];
    for (let y = 0; y < 800; y++) fill(img, [0, y, 1200, y + 1], [Math.round(230 - y * 0.12), Math.round(170 - y * 0.12), Math.round(110 - y * 0.08)]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const b: Box = [12 + c * 392, 12 + r * 392, 398 + c * 392, 398 + r * 392];
      for (let y = b[1]; y < b[3]; y++) { const v = Math.round(234 - ((y - b[1]) / (b[3] - b[1])) * 26); fill(img, [b[0], y, b[2], y + 1], [v, v - 6, v - 16]); }
      chart(img, words, b, ['Sales', 'Orders', 'Units', 'Payment', 'Status', 'Country'][r * 3 + c]);
    }
    const ps = findPanels(img, words, 12);
    expect(big(ps, img)).toBe(false);
    expect(ps.length).toBeGreaterThanOrEqual(6);
  });
  it('a screenshot of one chart is not cut into its bars', () => {
    const img = canvas(700, 420), words: Word[] = [word('Revenue', 20, 10)];
    [0.9, 0.6, 0.75, 0.4, 0.85, 0.55].forEach((h, i) => { fill(img, [40 + i * 105, Math.round(400 - 360 * h), 85 + i * 105, 400], BLUE); fill(img, [87 + i * 105, Math.round(400 - 300 * h), 132 + i * 105, 400], ORANGE); });
    const ps = findPanels(img, words, 12);
    // (the rescue for merged cards never runs on it: no panel is a bar or two)
    expect(ps.length).toBeLessThanOrEqual(2);
    expect(ps.every((p) => p.b[2] - p.b[0] > 300)).toBe(true);
  });
});
