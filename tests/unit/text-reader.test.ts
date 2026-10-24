import { describe, expect, it } from 'vitest';
import { ctcDecode, parseDict, toLineTensor } from '../../src/background/text-reader';

describe('second-look text reader: model input and output', () => {
  it('reads the character list from inference.yml, quotes and all', () => {
    const yml = "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - '0'\n  - A\n  - ''''\n  - \"#\"\n  - b\nother: 1\n";
    expect(parseDict(yml)).toEqual(['0', 'A', "'", '#', 'b']);
  });

  it('decodes greedily: blanks dropped, repeats merged, a repeat after a blank kept', () => {
    const dict = ['a', 'b'];
    // steps: a a _ a b b  → "aab"
    const best = [1, 1, 0, 1, 2, 2], classes = 3;
    const probs = new Float32Array(best.length * classes);
    best.forEach((c, t) => { probs[t * classes + c] = 0.9; });
    const r = ctcDecode(probs, best.length, classes, dict);
    expect(r.text).toBe('aab');
    expect(r.conf).toBeCloseTo(0.9);
  });

  it('a last extra class is the space', () => {
    const dict = ['a', 'b'], classes = 4;   // blank, a, b, space
    const best = [1, 3, 2], probs = new Float32Array(best.length * classes);
    best.forEach((c, t) => { probs[t * classes + c] = 0.8; });
    expect(ctcDecode(probs, best.length, classes, dict).text).toBe('a b');
  });

  it('nothing read gives empty text and no confidence', () => {
    const probs = new Float32Array(5 * 3);
    for (let t = 0; t < 5; t++) probs[t * 3] = 1;
    expect(ctcDecode(probs, 5, 3, ['a', 'b'])).toEqual({ text: '', conf: 0 });
  });

  it('resizes a line to 48 px high, keeps its proportions in multiples of 8, BGR and centred', () => {
    const w = 100, h = 20, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([255, 0, 0, 255], i * 4);   // pure red
    const t = toLineTensor({ width: w, height: h, data });
    expect(t.width).toBe(240);
    const plane = 48 * t.width;
    expect(t.data[0]).toBe(-1);            // blue channel first: 0 → -1
    expect(t.data[2 * plane]).toBe(1);     // red last: 255 → 1
  });
});
