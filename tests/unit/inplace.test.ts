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

describe('context synthesizer (web/synth.js)', () => {
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
  it('describes each box by kind, shape and visible labels, and never sends the hidden text', () => {
    expect(toks.map((t: { kind: string }) => t.kind)).toEqual(['number', 'client', 'unread']);
    expect(toks[0].shape).toBe('$99.9M');
    expect(toks[0].context).toContain('Revenue');
    expect(toks[1].context).toContain('Customer:');
    const sent = JSON.stringify(Y.request(toks, { width: 400, height: 120 }));
    expect(sent).not.toContain('14.2');
    expect(sent).not.toContain('Kestrelmoor');
    const req = Y.request(toks, { width: 400, height: 120 });
    expect(req.tokens).toHaveLength(2);                                   // unread boxes are only cleared
    expect(req.tokens[1]).toEqual({ id: 't2', kind: 'client', chars: 11, bbox: [100, 80, 90, 20], context: toks[1].context });
    expect(Object.keys(req.tokens[0]).sort()).toEqual(['bbox', 'context', 'id', 'kind', 'shape']);
  });
  it('accepts an answer only when it keeps the shape and differs from the hidden text', () => {
    const t = toks[0];
    expect(Y.acceptable(t, '$18.7M')).toBe(true);
    expect(Y.acceptable(t, '$14.2M')).toBe(false);          // the real value
    expect(Y.acceptable(t, '€18.7M')).toBe(false);          // another currency
    expect(Y.acceptable(t, '18.7%')).toBe(false);
    expect(Y.acceptable({ ...toks[1], kind: 'email', original: 'a@b.co' }, 'x@gmail.com')).toBe(false);
  });
  it('builds the replacement map: AI answers where valid, device values otherwise, originals kept on the device', () => {
    const answer = Y.parse('```json\n{"replacements":[{"id":"t1","synthetic":"$18.7M","note":"Net revenue"},{"id":"t2","synthetic":"Kestrelmoor Ltd"}]}\n```');
    const fallback = Y.local(toks, { fakeValue: () => '$11.9M', axisFactors: () => new Map() }, 7);
    const map = Y.combine(toks, answer, fallback);
    expect(map[0]).toMatchObject({ original: '$14.2M', synthetic: '$18.7M', bbox: [100, 40, 80, 24], source: 'ai' });
    expect(map[1].source).toBe('device');                    // contained the real name
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
