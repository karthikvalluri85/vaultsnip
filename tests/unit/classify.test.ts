/**
 * The extension's chart blur masks with src/shared/classify.ts; the app masks with classify() in web/app.js.
 * This test runs the app's own function (read from web/app.js, not a copy) against the TypeScript one, so the two
 * can never drift apart unnoticed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/shared/classify';

const app = readFileSync(resolve(__dirname, '../../web/app.js'), 'utf8');
const src = (app.match(/\n  function classify\(text\) \{[\s\S]*?\n  \}\n/) || [''])[0];

/** classify() from web/app.js, with its policy (allowlist, safe words, client names) passed in. */
function appClassify(allow: Set<string>, clients: string[]): (t: string) => string | null {
  // eslint-disable-next-line no-new-func
  // the extension reads English only: no dashboard language (langSafe), and no "Safe to keep" choices (sessionKey)
  return new Function('ALLOW', 'S', 'extraAllow', 'clientNames', 'langSafe', 'sessionKey', `${src}; return classify;`)(allow, { sessionAllow: new Set() }, () => new Set(), () => clients, () => false, (t: string) => t);
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('masking rules: extension chart blur vs the app', () => {
  it('reads classify() from web/app.js', () => {
    expect(src).toMatch(/return 'Text not on allowlist';/);
  });

  it('agrees with the app on a fuzzed corpus', () => {
    // 'acme widgets' is one allowlist entry with a space: it must not allow 'acme' on its own
    const allow = new Set(['revenue', 'sales', 'north', 'south', 'region', 'total', 'q', 'jan', 'feb', 'orders', 'acme widgets']);
    const clients = ['acme corp', 'globex'];
    const ref = appClassify(allow, clients);
    const alphabet = 'abcXYZ019 -_/&@.#$€%()é,\u0085﻿ ';
    const r = rng(42);
    const corpus = ['', ' ', 'Revenue', 'North-South', 'INV-20931', '4410-X', 'a@b', 'Q3', 'FY24', '2024', 'Acme Corp Q3', 'acme', 'Acme Widgets', 'Revenue Total', 'jane.doe@kestrelmoor.com', '$1,204,330'];
    for (let i = 0; i < 20000; i++) {
      let s = '';
      for (let n = 1 + Math.floor(r() * 12); n--;) s += alphabet[Math.floor(r() * alphabet.length)];
      corpus.push(s);
    }
    const bad = corpus.map((t) => ({ t, app: ref(t), ext: classify(t, { allow, clientNames: clients }) })).filter((x) => x.app !== x.ext);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('classifies a 5,000-word chart page fast enough for the page (under 50 ms)', () => {
    const r = rng(7);
    const words = ['Revenue', 'Initech', '$1,204', 'INV-20931', 'north', 'jane@corp.com', 'Q3', 'Total'];
    const texts = Array.from({ length: 5000 }, () => words[Math.floor(r() * words.length)] + ' ' + Math.floor(r() * 99));
    texts.forEach((t) => classify(t));
    const t0 = performance.now();
    texts.forEach((t) => classify(t));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
