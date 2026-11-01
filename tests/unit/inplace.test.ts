import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// web/inpaint.js and web/synth.js are plain browser scripts that also export for Node
const require = createRequire(import.meta.url);
const P = require('../../web/inpaint.js');
const Y = require('../../web/synth.js');

type RGB = [number, number, number];
// a W×H RGBA image filled with bg, with rects of other colours painted on
function image(W: number, H: number, bg: RGB, rects: { x: number; y: number; w: number; h: number; c: RGB }[] = []) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([...bg, 255], i * 4);
  rects.forEach(r => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) d.set([...r.c, 255], (y * W + x) * 4); });
  return d;
}
const near = (a: number[], b: number[], tol = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('in-place inpainting (web/inpaint.js)', () => {
  it('samples the background around a box, outvoting a gridline that crosses the ring', () => {
    const d = image(100, 60, [246, 247, 249], [
      { x: 30, y: 20, w: 30, h: 14, c: [250, 250, 250] },      // the box itself (ignored)
      { x: 0, y: 40, w: 100, h: 1, c: [200, 200, 200] }          // gridline through the ring
    ]);
    const bg = P.sampleBackground(d, 100, 60, { x: 30, y: 20, w: 30, h: 14 });
    expect(near(bg.color, [246, 247, 249])).toBe(true);
    expect(bg.gradient).toBeNull();
  });
  it('keeps a vertical gradient when the top and bottom of the ring differ', () => {
    const W = 60, H = 60, d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set([y < 30 ? 40 : 120, 60, 160, 255], (y * W + x) * 4);
    const bg = P.sampleBackground(d, W, H, { x: 20, y: 24, w: 20, h: 12 });
    expect(bg.gradient && bg.gradient.dir).toBe('v');
  });
  it('reads the ink colour, weight, size and alignment from the original text', () => {
    // dark "text" on white, left part of a padded box
    const d = image(200, 50, [255, 255, 255], [{ x: 12, y: 15, w: 40, h: 18, c: [20, 30, 120] }]);
    const box = { x: 10, y: 10, w: 120, h: 28 };
    const st = P.styleFor(d, 200, 50, box);
    expect(near(st.ink, [20, 30, 120])).toBe(true);
    expect(st.align).toBe('left');
    expect(st.size).toBe(Math.round(18 / 0.72));
    expect(st.weight).toBe(700);   // a solid block is all ink
  });
  it('falls back to 75% of the box height and the inverse of the background when there is no ink', () => {
    const d = image(80, 40, [20, 20, 24]);
    const st = P.styleFor(d, 80, 40, { x: 10, y: 10, w: 40, h: 20 });
    expect(st.size).toBe(15);
    expect(P.sampleInk(d, 80, 40, { x: 10, y: 10, w: 40, h: 20 }, [20, 20, 24]).color[0]).toBeGreaterThan(200);
    expect(st.align).toBe('center');
  });
});

describe('synthetic text (web/synth.js)', () => {
  const masks = [
    { x: 100, y: 40, w: 80, h: 24, type: 'Number or money', text: '$14.2M', on: true },
    { x: 100, y: 80, w: 90, h: 20, type: 'Client name', text: 'Kestrelmoor', on: true },
    { x: 300, y: 80, w: 70, h: 20, type: 'Unread text', text: '', on: true }
  ];
  const words = [
    { text: 'Net', x: 100, y: 20, w: 24, h: 12 }, { text: 'Revenue', x: 128, y: 20, w: 50, h: 12 },
    { text: '$14.2M', x: 104, y: 44, w: 70, h: 16 },                     // under a mask: never context
    { text: 'Customer:', x: 20, y: 82, w: 70, h: 14 }
  ];
  const toks = Y.tokens(masks, words);
  it('describes each box by kind and the visible labels beside it', () => {
    expect(toks.map((t: { kind: string }) => t.kind)).toEqual(['number', 'client', 'unread']);
    expect(toks[0].context).toContain('Revenue');
    expect(toks[0].context).not.toContain('14.2');                     // a word under a mask is never context
    expect(toks[1].context).toContain('Customer:');
  });
  it('builds the replacement map on the device: originals stay with their boxes, unread boxes are only cleared', () => {
    const values = Y.local(toks, { fakeValue: () => '$11.9M', axisFactors: () => new Map() }, 7);
    const map = Y.combine(toks, values);
    expect(map[0]).toMatchObject({ original: '$14.2M', synthetic: '$11.9M', bbox: [100, 40, 80, 24] });
    expect(map[1].synthetic.toLowerCase()).not.toContain('kestrelmoor');
    expect(map[2]).toMatchObject({ synthetic: '', kind: 'unread' });
  });
  it('makes up words of the same length and capitalisation on the device', () => {
    const w = Y.word('Acme CORP', () => 0.3);
    expect(w).toMatch(/^[A-Z][a-z]{3} [A-Z]{4}$/);
    expect(w).not.toBe('Acme CORP');
  });
});

describe('surgical clear (inpaintRegion)', () => {
  it('removes text but keeps a bar edge that runs through the box', () => {
    // white above, blue bar from y=20 down; grey "text" from y=12 to 24 straddling the bar top
    const W = 40, H = 40, d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set([...(y >= 20 ? [74, 120, 170] : [255, 255, 255]), 255], (y * W + x) * 4);
    for (let y = 12; y < 24; y++) for (let x = 14; x < 26; x += 2) d.set([60, 60, 60, 255], (y * W + x) * 4);
    const out = d.slice();
    P.inpaintRegion(d, out, W, H, { x: 10, y: 8, w: 20, h: 20 });
    const at = (x: number, y: number) => Array.from(out.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(14, 14)).toEqual([255, 255, 255]);   // text above the bar → white
    expect(at(14, 22)).toEqual([74, 120, 170]);    // text on the bar → bar blue
    expect(at(20, 19)).toEqual([255, 255, 255]);   // the edge stays sharp
    expect(at(20, 20)).toEqual([74, 120, 170]);
  });
});

describe('shapes read as text, and slanted labels', () => {
  it('leaves a legend swatch read as "BM" alone, but not a word', () => {
    // a 12px filled square in a padded 18px box, and thin "text" strokes in a box of the same size
    const d = image(80, 40, [255, 255, 255], [{ x: 13, y: 13, w: 12, h: 12, c: [58, 110, 220] }, { x: 53, y: 14, w: 1, h: 10, c: [40, 40, 40] }, { x: 57, y: 14, w: 1, h: 10, c: [40, 40, 40] }]);
    expect(P.looksLikeShape(d, 80, 40, { x: 10, y: 10, w: 18, h: 18 }, 14, 57, 'BM')).toBe(true);
    expect(P.looksLikeShape(d, 80, 40, { x: 50, y: 10, w: 18, h: 18 }, 14, 57, 'BM')).toBe(false);
  });
  it('never leaves a confident reading as it is, even on a coloured bar', () => {
    const bar = image(60, 40, [58, 110, 220], [{ x: 20, y: 14, w: 2, h: 12, c: [255, 255, 255] }]);
    expect(P.looksLikeShape(bar, 60, 40, { x: 10, y: 8, w: 30, h: 24 }, 10, 92, '350')).toBe(false);
  });
  it('leaves a tall, unsure digit on a chart alone, but not a large KPI value on a plain tile', () => {
    const bars = image(120, 120, [255, 255, 255], [{ x: 20, y: 10, w: 30, h: 100, c: [58, 110, 220] }, { x: 60, y: 40, w: 30, h: 70, c: [58, 110, 220] }]);
    expect(P.looksLikeShape(bars, 120, 120, { x: 15, y: 30, w: 80, h: 60 }, 14, 40, '2')).toBe(true);
    const tile = image(120, 80, [246, 247, 249], [{ x: 30, y: 20, w: 6, h: 40, c: [30, 30, 30] }, { x: 50, y: 20, w: 20, h: 6, c: [30, 30, 30] }]);
    expect(P.looksLikeShape(tile, 120, 80, { x: 20, y: 12, w: 70, h: 56 }, 14, 95, '7')).toBe(false);
  });
  it('finds the slant of a diagonal label', () => {
    const W = 80, H = 80, d = image(W, H, [255, 255, 255]);
    for (let i = 10; i < 60; i++) for (let t = 0; t < 3; t++) d.set([30, 30, 30, 255], ((i + t) * W + i) * 4);   // a 45° stroke
    const ink = P.sampleInk(d, W, H, { x: 5, y: 5, w: 65, h: 65 }, [255, 255, 255]);
    expect(ink.slant).not.toBeNull();
    expect(Math.abs(ink.slant.angle - Math.PI / 4)).toBeLessThan(0.1);
  });
});

describe('on-device values that fit their box', () => {
  it('replaces a short fragment with a word of its length, not a full made-up name', () => {
    const toks = Y.tokens([{ x: 0, y: 0, w: 20, h: 12, type: 'Name in context', text: 'Ms.', on: true }], []);
    const v = Y.local(toks, {}, 3).get('t1').synthetic;
    expect(v.length).toBeLessThanOrEqual(6);
  });
  it('makes an email about as long as the one it replaces, at a reserved domain', () => {
    const toks = Y.tokens([{ x: 0, y: 0, w: 90, h: 12, type: 'Email', text: 'effertz@example', on: true }], []);
    const v = Y.local(toks, {}, 3).get('t1').synthetic;
    expect(v).toMatch(/^[a-z]+@example\.(com|org|net)$/);
    expect(Math.abs(v.length - 15)).toBeLessThanOrEqual(1);
  });
});

describe('natural replica text', () => {
  it('replaces unknown words with real words of the same length, never syllable strings', () => {
    const w = Y.word('Brennholt Klinikum', () => 0.42);
    expect(w).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    w.toLowerCase().split(' ').forEach((part: string) => expect(Y.POOL).toContain(part));
  });
  it('reads a column header above a cell and a label before it on the same line', () => {
    const vis = [{ text: 'Account', x: 400, y: 10, w: 60, h: 14 }, { text: 'Manager', x: 465, y: 10, w: 60, h: 14 },
      { text: 'Prepared', x: 10, y: 300, w: 60, h: 12 }, { text: 'by', x: 75, y: 300, w: 14, h: 12 }];
    expect(Y.labelFor({ x: 400, y: 80, w: 100, h: 16 }, vis)).toBe('Account Manager');
    expect(Y.roleOf('Account Manager')).toBe('person');
    expect(Y.labelFor({ x: 95, y: 300, w: 120, h: 12 }, vis)).toBe('Prepared by');
    expect(Y.roleOf('Prepared by')).toBe('person');
  });
  it('takes the dimension after "by" in a chart title: "Leads by Region" labels its bars with places', () => {
    expect(Y.roleOf('Leads By Region')).toBe('city');
    expect(Y.roleOf('Clicks by city')).toBe('city');
    expect(Y.roleOf('Revenue by Account Manager')).toBe('person');
  });
  it('sets boxes in one row or column in one size', () => {
    const st = (size: number) => ({ size, weight: 400 });
    const list = [{ x: 10, y: 10, w: 80, h: 16, synthetic: 'a', style: st(13) }, { x: 10, y: 30, w: 90, h: 16, synthetic: 'b', style: st(17) },
      { x: 10, y: 50, w: 70, h: 17, synthetic: 'c', style: st(14) }];
    P.harmonise(list);
    expect(new Set(list.map(p => p.style.size)).size).toBe(1);
  });
});

describe('dates in the replica (web/synth.js)', () => {
  const seed = 4127, back = Y.dateShift(seed);
  it('moves every date back by one shift for the page, in its own format', () => {
    expect(back).toBeGreaterThanOrEqual(1);
    expect(back).toBeLessThanOrEqual(5);
    const cases: [string, RegExp][] = [
      ['Nov 2025', /^[A-Z][a-z]{2} 2025$/], ['2026-05-01', /^20\d\d-\d\d-01$/], ['10-30-2026', /^\d{1,2}-30-2026$/], ['07-04-2026', /^\d\d-04-20\d\d$/],
      ['30/10/2026', /^30\/\d{1,2}\/2026$/], ['11-25', /^\d\d-25$/], ['11/2025', /^\d{1,2}\/2025$/], ['Oct 1, 2026', /^[A-Z][a-z]{2} 1, 2026$/],
      ['30-Sep-2026', /^30-[A-Z][a-z]{2}-2026$/], ['SEP 2026', /^[A-Z]{3} 2026$/], ['September 2026', /^[A-Z][a-z]+ 2026$/], ["Nov '25", /^[A-Z][a-z]{2} '25$/]
    ];
    for (const [t, shape] of cases) {
      const f = Y.fakeDate(t, seed, 'mdy');
      expect(f, t).toMatch(shape);
      expect(f, t).not.toBe(t);
    }
  });
  it('keeps an axis of dates in order with even steps', () => {
    const axis = ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22', '2026-05-29', '2026-06-05'];
    const t = axis.map(a => Date.parse(Y.fakeDate(a, seed)));
    const steps = t.slice(1).map((v, i) => v - t[i]);
    expect(steps.every(s => s === 7 * 864e5)).toBe(true);
    const months = ['Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026'].map(m => Y.fakeDate(m, seed));
    expect(new Set(months).size).toBe(4);
    const idx = (m: string) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m.slice(0, 3)) + 12 * +m.slice(4);
    expect(months.map(idx).slice(1).map((v, i) => v - months.map(idx)[i])).toEqual([1, 1, 1]);
  });
  it('gives only real dates, reads day and month order from the page, and leaves numbers alone', () => {
    expect(Y.fakeDate('Mar 31, 2026', 1003)).toMatch(/^Jan 31, 2026$/);
    expect(Y.fakeDate('May 31, 2026', 1003)).toBe('Mar 31, 2026');
    expect(Y.dateOrder(['30/10/2026', '05/10/2026'])).toBe('dmy');
    expect(Y.dateOrder(['10/30/2026'])).toBe('mdy');
    expect(Y.fakeDate('05/10/2026', 1003, 'dmy')).toBe('05/08/2026');
    for (const n of ['10.25', '2026', '12:45', '4.5 / 5', 'Q3 2026']) expect(Y.fakeDate(n, seed)).toBeNull();
  });
  it('replaces a day beside a readable month name with another valid day, in order', () => {
    const a = parseInt(Y.fakeDay('1–', seed)), b = parseInt(Y.fakeDay('31,', seed));
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(28);
    expect(a).toBeLessThan(b);
    expect(Y.fakeDay('31,', seed)).toMatch(/^\d\d,$/);
  });
  it('replaces a value and the date in the next column on their own, and a slanted label read as a date as a date', () => {
    const toks = Y.tokens([
      { x: 0, y: 0, w: 60, h: 12, type: 'Number or money', text: '2026-05-01', on: true },
      { x: 0, y: 40, w: 60, h: 40, type: 'Unread text', text: '(unread text)', read: 'Oct 3, 2026', on: true }
    ], []);
    expect(toks.map((t: { kind: string }) => t.kind)).toEqual(['date', 'date']);
    const v = Y.local(toks, {}, seed);
    expect(v.get('t1').synthetic).toBe(Y.fakeDate('2026-05-01', seed));
    expect(v.get('t2').synthetic).toBe(Y.fakeDate('Oct 3, 2026', seed));
  });
});

describe('made-up text that does not give the hidden text away', () => {
  it('replaces the letters inside a code or path, the same way wherever they appear', () => {
    const toks = Y.tokens([
      { x: 0, y: 0, w: 90, h: 12, type: 'Number or money', text: 'bf_koelpin_50', on: true },
      { x: 0, y: 30, w: 200, h: 12, type: 'Number or money', text: '/customers/koelpin/case-study?ref=7', on: true }
    ], []);
    const v = Y.local(toks, { fakeValue: (t: string) => t.replace(/\d/g, '3'), safeWord: (w: string) => /^(customers|case|study|ref)$/i.test(w) }, 5);
    const a = v.get('t1').synthetic, b = v.get('t2').synthetic;
    expect(a).not.toMatch(/koelpin/i);
    expect(b).not.toMatch(/koelpin/i);
    expect(b).toMatch(/^\/customers\/[a-z]+\/case-study\?ref=3$/);
    expect(a.split('_')[1]).toBe(b.split('/')[2]);
  });
  it('keeps a title a title and never repeats the word beside it', () => {
    const toks = Y.tokens([{ x: 0, y: 0, w: 22, h: 12, type: 'Name in context', text: 'Ms.', on: true }], []);
    expect(Y.local(toks, {}, 3).get('t1').synthetic).toMatch(/^(Mr|Mrs|Miss|Dr|Prof)\.$/);
    const words = [{ text: 'West', x: 0, y: 0, w: 30, h: 12, conf: 95 }];
    const near = Y.tokens([{ x: 34, y: 0, w: 90, h: 12, type: 'Text not on allowlist', text: 'Helenburg, OK', on: true }], words);
    for (let s = 1; s <= 20; s++) expect(Y.local(near, {}, s).get('t1').synthetic.toLowerCase()).not.toMatch(/\bwest\b/);
  });
});
