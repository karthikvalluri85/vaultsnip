// On-device layout builder (Phase 2): panels, marks, chart types, measured shapes, tables, assembly and privacy.
// Images are drawn here with known geometry, so every expected type and shape is exact.
import { describe, expect, it } from 'vitest';
import { buildSpec, sanitize, withMasks, titleOf } from '../../src/layout/index';
import { findMarks, splitColumns, inkTest } from '../../src/layout/marks';
import { readPanel, looksLikeTable, splitTitle, formatOf } from '../../src/layout/charts';
import { readTable, tableVisual } from '../../src/layout/tables';
import type { Box, Img, Word } from '../../src/layout/image';

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255], BLUE: RGB = [52, 120, 200], ORANGE: RGB = [240, 140, 40], GREEN: RGB = [60, 170, 90], GREY: RGB = [200, 200, 200], MASK: RGB = [0x78, 0x7c, 0x82];

function canvas(W: number, H: number, bg: RGB = WHITE): Img {
  const data = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) data.set(bg, i * 3);
  return { data, width: W, height: H, channels: 3 };
}
function fill(img: Img, b: Box, c: RGB) {
  for (let y = Math.max(0, b[1]); y < Math.min(img.height, b[3]); y++) for (let x = Math.max(0, b[0]); x < Math.min(img.width, b[2]); x++) img.data.set(c, (y * img.width + x) * 3);
}
function dot(img: Img, cx: number, cy: number, r: number, c: RGB) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < img.width && y < img.height) img.data.set(c, (y * img.width + x) * 3);
}
/** A polyline drawn with round 2px pen, blended at the edges like an antialiased chart line. */
function polyline(img: Img, pts: [number, number][], c: RGB) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= n; s++) { const x = x0 + ((x1 - x0) * s) / n, y = y0 + ((y1 - y0) * s) / n; dot(img, x, y, 1.2, c); }
  }
}
/** Pie slices (shares sum to 1), clockwise from 12 o'clock; optional donut hole. */
function pie(img: Img, cx: number, cy: number, r: number, shares: number[], colors: RGB[], hole = 0) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const d = Math.hypot(x - cx, y - cy); if (d > r || d < hole) continue;
    let a = Math.atan2(x - cx, cy - y) / (2 * Math.PI); if (a < 0) a += 1;
    let acc = 0, k = 0; while (k < shares.length - 1 && a > acc + shares[k]) { acc += shares[k]; k++; }
    img.data.set(colors[k], (y * img.width + x) * 3);
  }
}
const word = (text: string, x: number, y: number, w = text.length * 6, h = 10, kept = true): Word => ({ text, x, y, w, h, kept });
/** Draws words as a real screenshot shows them: dark glyph strokes for visible words, a grey box for masked ones. */
function ink(img: Img, ws: Word[]) {
  for (const w of ws) {
    if (!w.kept) { fill(img, [Math.round(w.x), Math.round(w.y), Math.round(w.x + w.w), Math.round(w.y + w.h)], MASK); continue; }
    for (let x = Math.round(w.x); x < w.x + w.w - 1; x += 3) fill(img, [x, Math.round(w.y + 1), x + 2, Math.round(w.y + w.h - 1)], [50, 50, 50]);
  }
}
const masked = (x: number, y: number, w: number, h: number): Word => ({ text: '', x, y, w, h, kept: false });
const near = (got: number[], want: number[], tol = 4) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= tol);

describe('privacy of the input', () => {
  it('drops the text of masked words, whatever the caller sends', () => {
    const out = sanitize([word('Revenue', 0, 0), { ...word('ACME-SECRET', 10, 10), kept: false }]);
    expect(out[0].text).toBe('Revenue');
    expect(out[1].text).toBe('');
    expect(out[1].kept).toBe(false);
  });
  it('drops malformed words', () => {
    expect(sanitize([{ text: 'x', x: NaN, y: 0, w: 5, h: 5, kept: true }, { text: 'y', x: 0, y: 0, w: 0, h: 5, kept: true }] as Word[])).toEqual([]);
  });
  it('never puts masked text into the spec, even when a caller leaks it', () => {
    const img = canvas(400, 300);
    fill(img, [40, 60, 60, 260], BLUE); fill(img, [80, 120, 100, 260], BLUE); fill(img, [120, 200, 140, 260], BLUE);
    const leaky: Word[] = [word('Sales', 40, 20), word('by', 76, 20), word('Region', 94, 20), { ...word('TOPSECRET', 40, 262), kept: false }, { ...word('CLIENTCO', 80, 262), kept: false }];
    const r = buildSpec({ image: img, words: leaky });
    expect(JSON.stringify(r)).not.toMatch(/TOPSECRET|CLIENTCO/);
  });
  it('sees a masked word as the grey box drawn over it, and adds masks that hold no word', () => {
    const ws = withMasks([masked(100, 50, 30, 10), word('Total', 10, 10)], [{ x: 96, y: 44, w: 40, h: 22 }, { x: 300, y: 300, w: 50, h: 20 }]);
    expect(ws[0]).toMatchObject({ x: 96, y: 44, w: 40, h: 22, kept: false, text: '' });
    expect(ws[1]).toMatchObject({ text: 'Total', kept: true });
    expect(ws[2]).toMatchObject({ x: 300, y: 300, kept: false, text: '' });
  });
});

describe('marks', () => {
  it('finds coloured and grey shapes but not text or mask boxes', () => {
    const img = canvas(200, 100);
    fill(img, [10, 10, 50, 90], BLUE); fill(img, [60, 10, 100, 90], GREY); fill(img, [110, 10, 150, 30], MASK); fill(img, [160, 40, 190, 52], [40, 40, 40]);
    const ms = findMarks(img, [0, 0, 200, 100], [word('Label', 160, 40, 30, 12)]);
    expect(ms.length).toBe(2);
    expect(ms.every((m) => m.fill > 0.95)).toBe(true);
  });
  it('keeps a thin antialiased diagonal line in one piece', () => {
    const img = canvas(300, 150);
    polyline(img, [[10, 140], [100, 20], [200, 100], [290, 10]], BLUE);
    const ms = findMarks(img, [0, 0, 300, 150]);
    expect(ms[0].b[2] - ms[0].b[0]).toBeGreaterThan(270);
  });
  it('splits touching dense columns at faint separators', () => {
    const img = canvas(200, 120, [231, 226, 232]);
    for (let i = 0; i < 8; i++) fill(img, [20 + i * 20, 30 + i * 5, 39 + i * 20, 110], [246, 246, 246]);
    for (let i = 0; i < 7; i++) fill(img, [39 + i * 20, 30, 40 + i * 20, 110], [254, 254, 254]);   // 1 px lighter separators
    const ink = inkTest(img, [0, 0, 200, 120]);
    const ms = findMarks(img, [0, 0, 200, 120]);
    const parts = ms.flatMap((m) => splitColumns(img, m, ink));
    expect(parts.length).toBeGreaterThanOrEqual(7);
  });
});

describe('chart types and shapes', () => {
  const med = 10;
  it('column chart: baseline bars, shapes from heights, members from visible axis labels', () => {
    const img = canvas(420, 300), heights = [200, 160, 120, 80, 40], ws: Word[] = [word('Revenue', 10, 6), word('by', 60, 6), word('Region', 76, 6)];
    heights.forEach((h, i) => { fill(img, [40 + i * 70, 260 - h, 80 + i * 70, 260], BLUE); ws.push(word(['North', 'South', 'East', 'West', 'Other'][i], 42 + i * 70, 266, 30)); });
    const r = readPanel(img, [0, 0, 420, 300], ws, med, 'Revenue by Region');
    expect(r.type).toBe('column');
    const f = r.fields as { dimension: { name: string; members: string[] }; series: { shape: number[] }[]; measure: { name: string; format: string } };
    expect(f.dimension).toEqual({ name: 'Region', members: ['North', 'South', 'East', 'West', 'Other'] });
    expect(near(f.series[0].shape, [100, 80, 60, 40, 20], 2)).toBe(true);
    expect(f.measure).toMatchObject({ name: 'Revenue', format: 'currency' });
  });
  it('masked axis labels become Item N, never the hidden text', () => {
    const img = canvas(420, 300), ws: Word[] = [];
    [150, 100, 50].forEach((h, i) => { fill(img, [40 + i * 90, 260 - h, 90 + i * 90, 260], ORANGE); ws.push({ ...masked(42 + i * 90, 266, 40, 10) }); });
    const r = readPanel(img, [0, 0, 420, 300], ws, med, 'Orders by Customer');
    expect((r.fields as { dimension: { members: string[] } }).dimension.members).toEqual(['Item 1', 'Item 2', 'Item 3']);
  });
  it('horizontal bar chart', () => {
    const img = canvas(400, 260), ws: Word[] = [];
    [300, 210, 120].forEach((w, i) => { fill(img, [80, 40 + i * 60, 80 + w, 70 + i * 60], GREEN); ws.push(word(['Alpha', 'Beta', 'Gamma'][i], 20, 50 + i * 60, 40)); });
    const r = readPanel(img, [0, 0, 400, 260], ws, med, 'Units by Team');
    expect(r.type).toBe('bar');
    const f = r.fields as { horizontal: boolean; dimension: { members: string[] }; series: { shape: number[] }[] };
    expect(f.horizontal).toBe(true);
    expect(f.dimension.members).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(near(f.series[0].shape, [100, 70, 40], 2)).toBe(true);
  });
  it('stacked columns: two series, stacked', () => {
    const img = canvas(400, 300);
    [[100, 60], [80, 40], [60, 80]].forEach(([a, b], i) => { fill(img, [40 + i * 100, 260 - a, 90 + i * 100, 260], BLUE); fill(img, [40 + i * 100, 260 - a - b, 90 + i * 100, 260 - a], ORANGE); });
    const r = readPanel(img, [0, 0, 400, 300], [], med, 'Revenue by Quarter');
    expect(r.type).toBe('column');
    const f = r.fields as { stacked: boolean; series: { shape: number[] }[] };
    expect(f.stacked).toBe(true);
    expect(f.series.length).toBe(2);
  });
  it('line chart: heights follow the line under each axis label', () => {
    const img = canvas(500, 300), ys = [250, 200, 220, 120, 60], xs = [50, 150, 250, 350, 450];
    polyline(img, xs.map((x, i) => [x, ys[i]] as [number, number]), BLUE);
    const ws = ['Jan', 'Feb', 'Mar', 'Apr', 'May'].map((m, i) => word(m, xs[i] - 9, 270, 18));
    const r = readPanel(img, [0, 0, 500, 300], ws, med, 'Sessions by Month');
    expect(r.type).toBe('line');
    const f = r.fields as { dimension: { members: string[] }; series: { shape: number[] }[] };
    expect(f.dimension.members).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May']);
    const s = f.series[0].shape;
    expect(s[4]).toBe(100);
    expect(s[3]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(s[2]).toBeGreaterThan(s[0]);
  });
  it('pie chart: slice shares around the circle', () => {
    const img = canvas(300, 300);
    pie(img, 150, 150, 100, [0.5, 0.3, 0.2], [BLUE, ORANGE, GREEN]);
    const r = readPanel(img, [0, 0, 300, 300], [], med, 'Share by Channel');
    expect(r.type).toBe('pie');
    expect(near((r.fields as { series: { shape: number[] }[] }).series[0].shape, [100, 60, 40], 3)).toBe(true);
  });
  it('dense monthly columns of nearly one height, joined by lighter 1 px separators', () => {
    const img = canvas(320, 160);
    const LIGHT: RGB = [125, 200, 235], SKY: RGB = [100, 190, 230];
    for (let i = 0; i < 36; i++) {
      const x = 20 + i * 7, top = 60 - (i % 5);
      fill(img, [x, top, x + 6, 140], SKY);
      fill(img, [x + 6, top, x + 7, 140], LIGHT);   // the separator, a lighter shade of the same colour
    }
    expect(readPanel(img, [0, 0, 320, 160], [], med, 'Revenue by Month').type).toBe('column');
  });
  it('a donut with its legend swatches beside it, and a pie the screenshot cuts in half', () => {
    const donut = canvas(400, 300);
    pie(donut, 140, 170, 90, [0.43, 0.42, 0.15], [BLUE, ORANGE, GREEN], 55);
    [BLUE, ORANGE, GREEN].forEach((c, i) => fill(donut, [260, 40 + i * 20, 274, 54 + i * 20], c));   // swatches, labels masked
    fill(donut, [10, 20, 390, 22], GREY);   // a divider under the card's title
    expect(readPanel(donut, [0, 0, 400, 300], [], med, 'Patient Status').type).toBe('donut');
    const half = canvas(500, 400);
    pie(half, 250, 200, 180, [0.4, 0.35, 0.25], [BLUE, ORANGE, GREEN]);   // the panel (top half) ends at the centre
    expect(readPanel(half, [0, 0, 500, 200], [], med, 'Orders by Category').type).toBe('pie');
  });
  it('a small multi-line chart with one tall mask is a line chart, not a KPI', () => {
    const img = canvas(330, 130);
    polyline(img, [[30, 60], [90, 50], [150, 70], [210, 40], [270, 55], [310, 45]], BLUE);
    polyline(img, [[30, 95], [90, 90], [150, 100], [210, 85], [270, 92], [310, 80]], ORANGE);
    fill(img, [20, 108, 120, 126], MASK);   // slanted month labels masked as unread text, taller than a word
    const r = readPanel(img, [0, 0, 330, 130], [masked(20, 108, 100, 18), word('Invoice', 10, 4, 42), word('by', 56, 4, 12), word('Month', 72, 4, 34)], med, 'Invoice by Month');
    expect(r.type).toBe('line');
  });
  it('pie chart with an edge hidden under a mask', () => {
    const img = canvas(300, 300);
    pie(img, 150, 150, 100, [0.5, 0.3, 0.2], [BLUE, ORANGE, GREEN]);
    fill(img, [40, 70, 80, 230], MASK);   // a masked slice label hiding the left of the pie
    expect(readPanel(img, [0, 0, 300, 300], [masked(40, 70, 40, 160)], med, 'Share by Channel').type).toBe('pie');
  });
  it('donut chart', () => {
    const img = canvas(300, 300);
    pie(img, 150, 150, 100, [0.6, 0.4], [BLUE, ORANGE], 55);
    expect(readPanel(img, [0, 0, 300, 300], [], med, 'Mix').type).toBe('donut');
  });
  it('scatter plot: positions scaled to 5-95', () => {
    const img = canvas(400, 300);
    for (let i = 0; i < 14; i++) dot(img, 40 + i * 24, 260 - ((i * 37) % 200), 4, BLUE);
    const r = readPanel(img, [0, 0, 400, 300], [], med, 'Margin vs Sales');
    expect(r.type).toBe('scatter');
    const pts = (r.fields as { points: number[][] }).points;
    expect(pts.length).toBe(14);
    expect(pts.every((p) => p[0] >= 5 && p[0] <= 95 && p[1] >= 5 && p[1] <= 95)).toBe(true);
    expect((r.fields as { xMeasure: { name: string } }).xMeasure.name).toBe('Margin');
  });
  it('treemap: tiles filling a rectangle', () => {
    const img = canvas(400, 300);
    fill(img, [20, 20, 220, 280], BLUE); fill(img, [222, 20, 380, 150], ORANGE); fill(img, [222, 152, 300, 280], GREEN); fill(img, [302, 152, 380, 280], [150, 90, 180]);
    expect(readPanel(img, [0, 0, 400, 300], [], med, 'Cost by Department').type).toBe('treemap');
  });
  it('KPI: one big masked value and a short visible label', () => {
    const img = canvas(220, 110);
    const r = readPanel(img, [0, 0, 220, 110], [word('Net', 20, 15), word('Revenue', 44, 15), masked(20, 40, 90, 34)], med, 'Net Revenue');
    expect(r.type).toBe('kpi');
    expect((r.fields as { measure: { name: string; format: string } }).measure).toMatchObject({ name: 'Net Revenue', format: 'currency' });
  });
  it('a big chart with masked data labels is not a KPI', () => {
    const img = canvas(500, 320), ws: Word[] = [];
    [200, 150, 100, 60].forEach((h, i) => { fill(img, [40 + i * 110, 280 - h, 110 + i * 110, 280], BLUE); ws.push(masked(50 + i * 110, 280 - h - 20, 40, 17)); });
    expect(readPanel(img, [0, 0, 500, 320], ws, med, 'Sales by Store').type).toBe('column');
  });
  it('an empty panel is a placeholder, not a guess', () => {
    expect(readPanel(canvas(200, 100), [0, 0, 200, 100], [], med, '').type).toBe('placeholder');
  });
});

describe('titles and names', () => {
  it('splits "Measure by Dimension"', () => {
    expect(splitTitle('Net Revenue by Country')).toEqual({ measure: 'Net Revenue', dimension: 'Country' });
    expect(splitTitle('Headcount')).toEqual({ measure: 'Headcount', dimension: '' });
  });
  it('guesses formats from visible label words only', () => {
    expect(formatOf('Conversion rate').format).toBe('percent');
    expect(formatOf('Revenue (€)')).toEqual({ format: 'currency', currency: '€' });
    expect(formatOf('Orders').format).toBe('integer');
    expect(formatOf('Score').format).toBe('number');
  });
  it('covered title words become one [Client]', () => {
    const t = titleOf([masked(0, 0, 40, 10), masked(44, 0, 30, 10), word('Sales', 80, 0), word('Overview', 116, 0)], [0, 0, 300, 100], 10);
    expect(t.text).toBe('[Client] Sales Overview');
    expect(titleOf([masked(0, 0, 40, 10)], [0, 0, 300, 100], 10).text).toBe('');
  });
});

describe('tables and reports', () => {
  // a grouped report: Region shown once per group, a Total row per group and a grand total
  function grouped(): Word[] {
    const ws: Word[] = [word('Region', 10, 10, 40), word('Product', 120, 10, 44), word('Quantity', 250, 10, 50), word('Sales', 340, 10, 34)];
    let y = 30;
    for (const region of ['North', 'South']) {
      ['Bikes', 'Helmets', 'Gloves'].forEach((p, i) => {
        if (i === 0) ws.push(word(region, 10, y, 34));
        ws.push(word(p, 120, y, 40), masked(280, y, 20, 10), masked(330, y, 44, 10));
        y += 16;
      });
      ws.push(word('Total', 120, y, 30), masked(280, y, 20, 10), masked(330, y, 44, 10)); y += 16;
    }
    ws.push(word('Total', 10, y, 30), masked(280, y, 20, 10), masked(330, y, 44, 10));
    return ws;
  }
  it('recognises a grid of words', () => {
    expect(looksLikeTable(grouped(), 10)).toBe(true);
    expect(looksLikeTable([word('Just', 0, 0), word('a', 30, 0), word('sentence', 40, 0)], 10)).toBe(false);
  });
  it('reads columns, number columns, groups and totals', () => {
    const t = readTable(grouped(), [0, 0, 400, 200])!;
    expect(t.columns.map((c) => c.name)).toEqual(['Region', 'Product', 'Quantity', 'Sales']);
    expect(t.columns.map((c) => c.numeric)).toEqual([false, false, true, true]);
    expect(t.rowGroups).toEqual([0]);
    expect(t.totalRows).toBe(3);
    expect(t.grandTotal).toBe(true);
    expect(t.pivot).toBe(false);
    const v = tableVisual(t, 'Sales by Region') as { type: string; groupBy: string[]; subtotals: boolean; grandTotal: boolean; columns: { name: string; kind: string }[] };
    expect(v).toMatchObject({ type: 'table', groupBy: ['Region'], subtotals: true, grandTotal: true });
    expect(v.columns.find((c) => c.name === 'Sales')!.kind).toBe('currency');
    expect(v.columns.find((c) => c.name === 'Quantity')!.kind).toBe('number');
  });
  it('reads a pivot: column groups over repeated measures', () => {
    const ws: Word[] = [word('2025', 120, 5, 26), word('2026', 260, 5, 26), word('Total', 400, 5, 30),
      word('Territory', 10, 22, 50), word('Sales', 100, 22, 30), word('Qty', 170, 22, 20), word('Sales', 240, 22, 30), word('Qty', 310, 22, 20), word('Sales', 380, 22, 30), word('Qty', 450, 22, 20)];
    ['Central', 'North', 'South', 'Total'].forEach((t, i) => { ws.push(word(t, 10, 40 + i * 16, 40)); [100, 170, 240, 310, 380, 450].forEach((x) => ws.push(masked(x, 40 + i * 16, 30, 10))); });
    const t = readTable(ws, [0, 0, 500, 120])!;
    expect(t.pivot).toBe(true);
    const v = tableVisual(t, '') as { type: string; measures: { name: string }[]; colDims: { members: string[] }[]; rowDims: { name: string; members: string[] }[]; grandTotal: boolean };
    expect(v.type).toBe('pivot');
    expect(v.measures.map((m) => m.name)).toEqual(['Sales', 'Qty']);
    expect(v.colDims[0].members).toEqual(['2025', '2026']);
    expect(v.rowDims[0]).toEqual({ name: 'Territory', members: ['Central', 'North', 'South'] });
    expect(v.grandTotal).toBe(true);
  });
  it('reads parameter prompts above a report', () => {
    const ws = [word('Store', 10, 5, 30), word('identifier?', 44, 5, 60), word('View', 300, 5, 26), word('Report', 330, 5, 36), ...grouped().map((w) => ({ ...w, y: w.y + 60 }))];
    const t = readTable(ws, [0, 0, 400, 300])!;
    expect(t.parameters).toEqual([{ label: 'Store identifier', value: '' }]);
  });
  it('a whole page that is one grid becomes a report spec with parameters and one table', () => {
    const img = canvas(420, 260);
    const r = buildSpec({ image: img, words: grouped() });
    expect(r.spec.rows.length).toBe(1);
    expect(r.spec.rows[0].visuals[0]).toMatchObject({ type: 'table', groupBy: ['Region'] });
  });
});

describe('assembling a dashboard', () => {
  function dashboard(): { image: Img; words: Word[] } {
    const img = canvas(1200, 800, [243, 242, 241]), words: Word[] = [word('Sales', 20, 16, 50, 16), word('Overview', 76, 16, 80, 16)];
    // four KPI cards
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 295; fill(img, [x, 60, x + 280, 170], WHITE);
      words.push(word(['Revenue', 'Orders', 'Margin', 'Customers'][i], x + 16, 76, 60), masked(x + 16, 100, 110, 36));
    }
    // a column chart and a line chart side by side
    fill(img, [20, 190, 700, 500], WHITE); words.push(word('Revenue', 36, 200, 54), word('by', 94, 200, 14), word('Region', 112, 200, 44));
    [220, 180, 140, 100, 60].forEach((h, i) => fill(img, [60 + i * 120, 470 - h, 130 + i * 120, 470], BLUE));
    fill(img, [720, 190, 1180, 500], WHITE); words.push(word('Orders', 736, 200, 44), word('by', 784, 200, 14), word('Month', 802, 200, 40));
    polyline(img, [[750, 460], [850, 380], [950, 420], [1050, 300], [1150, 260]], ORANGE);
    // a table
    fill(img, [20, 520, 1180, 780], WHITE);
    words.push(word('Account', 40, 530, 50), word('Owner', 400, 530, 40), word('Amount', 1060, 530, 50));
    for (let r = 0; r < 8; r++) words.push(masked(40, 552 + r * 26, 120, 12), masked(400, 552 + r * 26, 90, 12), masked(1050, 552 + r * 26, 60, 12));
    ink(img, words);
    return { image: img, words };
  }
  it('builds rows of the right visuals with spans that fill the grid', () => {
    const r = buildSpec(dashboard());
    const types = r.spec.rows.map((row) => row.visuals.map((v) => v.type));
    expect(types).toEqual([['kpi', 'kpi', 'kpi', 'kpi'], ['column', 'line'], ['table']]);
    r.spec.rows.forEach((row) => expect(row.visuals.reduce((s, v) => s + (v.span as number), 0)).toBe(12));
    expect(r.spec.rows[0].height).toBe('s');
    expect(r.spec.title).toBe('Sales Overview');
    expect(r.spec.rows[0].visuals.map((v) => (v.measure as { name: string }).name)).toEqual(['Revenue', 'Orders', 'Margin', 'Customers']);
    expect(r.coverage).toBeGreaterThan(0.9);
    const ids = r.spec.rows.flatMap((row) => row.visuals.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('is deterministic', () => {
    const a = buildSpec(dashboard()), b = buildSpec(dashboard());
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
  });
  it('the replica engine accepts the spec shape (every visual has id, type and span)', () => {
    const r = buildSpec(dashboard());
    r.spec.rows.forEach((row) => { expect(['s', 'm', 'l']).toContain(row.height); row.visuals.forEach((v) => { expect(typeof v.id).toBe('string'); expect(typeof v.type).toBe('string'); expect(v.span).toBeGreaterThanOrEqual(1); }); });
  });
});

describe('robustness', () => {
  it('handles an empty, a tiny and a blank image without throwing', () => {
    expect(() => buildSpec({ image: canvas(1, 1), words: [] })).not.toThrow();
    expect(() => buildSpec({ image: canvas(5, 5), words: [word('x', 0, 0, 3, 3)] })).not.toThrow();
    const r = buildSpec({ image: canvas(800, 600), words: [] });
    expect(Array.isArray(r.spec.rows)).toBe(true);
  });
  it('handles RGBA input with transparent margins', () => {
    const W = 300, H = 200, data = new Uint8ClampedArray(W * H * 4);
    for (let y = 40; y < 160; y++) for (let x = 40 + Math.floor((y - 40) / 30) * 50; x < 70 + Math.floor((y - 40) / 30) * 50; x++) data.set([52, 120, 200, 255], (y * W + x) * 4);
    expect(() => buildSpec({ image: { data, width: W, height: H, channels: 4 }, words: [] })).not.toThrow();
  });
  it('handles noise in reasonable time', () => {
    const img = canvas(900, 600);
    let s = 7; for (let i = 0; i < img.data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; img.data[i] = s & 255; }
    const t0 = Date.now();
    expect(() => buildSpec({ image: img, words: [] })).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});

describe('confidence (Phase 3)', () => {
  const base = { type: 'column', certainty: 0.9, area: 0.12, titled: true, features: { marks: 8 } };
  it('each signal moves the score the right way', async () => {
    const { panelConfidence } = await import('../../src/layout/confidence');
    const c = panelConfidence(base);
    expect(c).toBeGreaterThan(0.6);
    expect(panelConfidence({ ...base, titled: false })).toBeLessThan(c);
    expect(panelConfidence({ ...base, area: 0.002 })).toBeLessThan(c * 0.7);
    expect(panelConfidence({ ...base, features: { marks: 0 } })).toBeLessThan(c * 0.4);
    expect(panelConfidence({ ...base, certainty: 0.2 })).toBeLessThan(c);
    expect(panelConfidence({ ...base, area: 0.6 })).toBeLessThan(c * 0.5);
    expect(panelConfidence({ ...base, type: 'kpi', area: 0.2 })).toBeLessThan(panelConfidence({ ...base, type: 'kpi', area: 0.02 }));
    expect(panelConfidence({ ...base, type: 'placeholder' })).toBeLessThan(0.1);
    // a large map or wide chart is often real; only a panel over most of the page is penalised hard
    expect(panelConfidence({ ...base, area: 0.4 })).toBeGreaterThan(panelConfidence({ ...base, area: 0.6 }) * 2);
    expect(panelConfidence({ ...base, type: 'map' })).toBeGreaterThan(0.7);
    for (const p of [base, { ...base, type: 'unknown' }, { ...base, certainty: NaN }]) { const v = panelConfidence(p); expect(v).toBeGreaterThanOrEqual(0.02); expect(v).toBeLessThanOrEqual(0.98); }
  });
  it('the page score counts missed content and swallowed visuals against the replica', async () => {
    const { pageConfidence, swallowedVisuals } = await import('../../src/layout/confidence');
    expect(pageConfidence([0.8, 0.8], 1)).toBeCloseTo(0.8, 5);
    expect(pageConfidence([0.8, 0.8], 0.5)).toBeLessThan(0.8);
    expect(pageConfidence([0.8], 1, 3)).toBeCloseTo(0.2, 5);
    expect(pageConfidence([], 1)).toBe(0);
    expect(swallowedVisuals([0.6, 0.1], ['line', 'kpi'])).toBe(4);
    expect(swallowedVisuals([0.6], ['table'])).toBe(0);
  });
  it('the builder reports a confidence per visual and for the page', () => {
    const img = canvas(400, 300);
    [200, 140, 80].forEach((h, i) => fill(img, [40 + i * 100, 260 - h, 100 + i * 100, 260], BLUE));
    const r = buildSpec({ image: img, words: [word('Revenue', 40, 10, 50), word('by', 94, 10, 14), word('Region', 112, 10, 44)] });
    expect(r.confidence).toBeGreaterThan(0); expect(r.confidence).toBeLessThanOrEqual(1);
    const vids = r.spec.rows.flatMap((row) => row.visuals.map((v) => v.id));
    expect(r.panels.filter((p) => p.vid).map((p) => p.vid).sort()).toEqual([...vids].sort());
    r.panels.forEach((p) => { expect(p.confidence).toBeGreaterThan(0); expect(p.confidence).toBeLessThan(1); });
  });
});
