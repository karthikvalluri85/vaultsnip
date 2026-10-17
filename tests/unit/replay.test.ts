import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, maskText, maskWord } from '../../src/shared/classify';
import { auditEvents, cleanCss, sanitizeEvents, type RrEvent } from '../../src/shared/replay-sanitize';
import { ALLOW_WORDS } from '../../src/shared/allowlist';
import { ScannerBridge, type WasmModule } from '../../src/content/scanner-wasm';

const PII = ['Kestrelmoor', 'jane.doe@kestrelmoor.com', '1,204,330', 'Jane Doe', 'INV-20931', 'hunter2', '+44 20 7946 0958',
  'customers/88231', 'Globex', 'Umbrella', 'evil.example', 'avatar.png'];

/** A recording with PII in every channel rrweb records: text, attributes, CSS, inputs, mutations, URL. */
function leakyRecording(): RrEvent[] {
  let id = 1;
  const t = (textContent: string, extra = {}) => ({ type: 3, id: id++, textContent, ...extra });
  const el = (tagName: string, attributes: Record<string, unknown>, childNodes: unknown[] = []) => ({ type: 2, id: id++, tagName, attributes, childNodes });
  const style = el('style', {}, [t('.hero{background:url(https://evil.example/avatar.png)} .who::after{content:"Jane Doe"} a[title="Globex"]{color:red} @import url("https://evil.example/x.css");', { isStyle: true })]);
  const doc = {
    type: 0, id: id++, childNodes: [
      { type: 1, id: id++, name: 'html', publicId: 'Kestrelmoor', systemId: '' },
      el('html', { lang: 'en' }, [
        el('head', {}, [style, el('link', { rel: 'stylesheet', href: 'https://evil.example/s.css', _cssText: 'body{background:url(avatar.png)}' })]),
        el('body', { class: 'page user-jane.doe@kestrelmoor.com', 'data-user': 'Jane Doe' }, [
          el('h1', { title: 'Kestrelmoor Holdings', 'aria-label': 'Jane Doe' }, [t('Revenue by Region')]),
          el('p', { style: 'background-image:url("https://evil.example/avatar.png");color:#333' }, [t('Kestrelmoor Holdings owes $1,204,330 (INV-20931)')]),
          el('a', { href: 'mailto:jane.doe@kestrelmoor.com', target: '_blank' }, [t('jane.doe@kestrelmoor.com')]),
          el('a', { href: 'https://crm.example/customers/88231' }, [t('Open')]),
          el('img', { src: 'https://evil.example/avatar.png', alt: 'Jane Doe', rr_width: '40px', rr_height: '40px' }),
          el('input', { type: 'password', value: 'hunter2', placeholder: 'Jane Doe' }),
          el('span', { 'data-phone': '+44 20 7946 0958' }, [t('Call +44 20 7946 0958')]),
          { type: 5, id: id++, textContent: 'Globex internal' },
          el('svg', { viewBox: '0 0 100 50', xmlns: 'http://www.w3.org/2000/svg' }, [el('path', { d: 'M0 0 L100 50', stroke: '#0d6b5d' })]),
        ]),
      ]),
    ],
  };
  const bodyId = (doc.childNodes[1] as any).childNodes[1].id;
  const textId = (doc.childNodes[1] as any).childNodes[1].childNodes[1].childNodes[0].id;
  return [
    { type: 4, data: { href: 'https://crm.example/customers/88231?email=jane.doe@kestrelmoor.com', width: 1280, height: 800 }, timestamp: 1 },
    { type: 2, data: { node: doc, initialOffset: { top: 0, left: 0 } }, timestamp: 2 },
    { type: 3, data: { source: 0, adds: [{ parentId: bodyId, nextId: null, node: { type: 2, id: 900, tagName: 'div', attributes: { title: 'Umbrella', class: 'toast' }, childNodes: [{ type: 3, id: 901, textContent: 'Umbrella Corp signed' }] } }],
      texts: [{ id: textId, value: 'Globex Corporation owes $88' }], attributes: [{ id: bodyId, attributes: { 'data-user': 'Globex', style: { 'background-image': 'url(https://evil.example/avatar.png)' }, class: null } }], removes: [] }, timestamp: 3 },
    { type: 3, data: { source: 5, id: 42, text: 'hunter2', isChecked: false }, timestamp: 4 },
    { type: 3, data: { source: 8, id: 7, adds: [{ rule: '.x{background:url(https://evil.example/avatar.png)}', index: 0 }] }, timestamp: 5 },
    { type: 3, data: { source: 13, id: 7, index: [0], set: { property: 'background', value: 'url(https://evil.example/avatar.png)' } }, timestamp: 6 },
    { type: 3, data: { source: 11, level: 'log', payload: ['Jane Doe'], trace: [] }, timestamp: 7 },
    { type: 3, data: { source: 2, type: 2, id: 5, x: 10, y: 20 }, timestamp: 8 },
    { type: 5, data: { tag: 'note', payload: 'Jane Doe' }, timestamp: 9 },
  ];
}

describe('masking words for replay', () => {
  it('keeps allowlisted labels and masks the rest, keeping shape', () => {
    expect(maskText('Revenue by Region for Kestrelmoor: $1,204,330 in Q3 2024')).toBe('Revenue by Region for Xxxxxxxxxxx: $0,000,000 in Q3 2024');
    expect(maskWord('Jane9')).toBe('Xxxx0');
    expect(maskText('email jane.doe@x9.com')).toBe('email xxxxxxxxxxxxxxx');
  });
  it('is idempotent', () => {
    const once = maskText('Kestrelmoor Holdings owes $1,204,330 (INV-20931) jane@corp.com');
    expect(maskText(once)).toBe(once);
  });
});

describe('sanitizeEvents', () => {
  const clean = sanitizeEvents(leakyRecording());
  const json = JSON.stringify(clean);

  it('leaves no PII anywhere in the recording', () => {
    for (const s of PII) expect(json, s).not.toContain(s);
    expect(json).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(json).not.toMatch(/url\(\s*[^)\s]/);
  });

  it('passes the independent audit', () => {
    expect(auditEvents(clean)).toEqual([]);
  });

  it('keeps what replay needs: layout, labels, SVG geometry, interactions', () => {
    expect(json).toContain('Revenue by Region');
    expect(json).toContain('"viewBox":"0 0 100 50"');
    expect(json).toContain('"d":"M0 0 L100 50"');
    expect(json).toContain('"rr_width":"40px"');
    expect(json).toContain('color:#333');
    expect(clean.some((e) => e.type === 3 && e.data.source === 2)).toBe(true);
    expect(clean.find((e) => e.type === 4)!.data).toMatchObject({ href: 'about:blank', width: 1280, height: 800 });
  });

  it('drops console logs and custom events, masks typed input', () => {
    expect(clean.some((e) => e.type === 3 && e.data.source === 11)).toBe(false);
    expect(clean.some((e) => e.type === 5)).toBe(false);
    expect(clean.find((e) => e.type === 3 && e.data.source === 5)!.data.text).toBe('*******');
  });

  it('does not change its input', () => {
    const raw = leakyRecording();
    const before = JSON.stringify(raw);
    sanitizeEvents(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('cleans CSS without breaking ordinary rules', () => {
    expect(cleanCss('a{color:red;background:url(x.png) no-repeat} b::before{content:"Jane"}')).toBe('a{color:red;background:none no-repeat} b::before{content: "xxxx"}');
  });
});

describe('auditEvents (fails closed)', () => {
  it('catches every channel when the sanitizer is skipped', () => {
    const where = auditEvents(leakyRecording()).map((f) => f.where).join('\n');
    expect(where).toMatch(/\[0\]\.data\.href/);            // page URL
    expect(where).toMatch(/textContent/);                  // visible text
    expect(where).toMatch(/texts\[0\]/);                   // text mutation
    expect(where).toMatch(/\[3\]\.data\.text/);            // typed input
    expect(where).toMatch(/attributes\.href/);             // mailto: link
    expect(where).toMatch(/\[8\]/);                        // custom event
  });
});

/* ---------- the TypeScript classify() against the Rust scanner (needs npm run build:wasm) ---------- */
const WASM_DIR = resolve(__dirname, '../../public/wasm');
describe.skipIf(!existsSync(resolve(WASM_DIR, 'vaultsnip_core_bg.wasm')))('classify() port', () => {
  it('matches the Rust scanner (and so web/app.js) on a fuzzed corpus', async () => {
    const glue = await import(/* @vite-ignore */ pathToFileURL(resolve(WASM_DIR, 'vaultsnip_core.js')).href);
    glue.initSync({ module: readFileSync(resolve(WASM_DIR, 'vaultsnip_core_bg.wasm')) });
    const b = await ScannerBridge.create(async () => glue as WasmModule, { allow: ALLOW_WORDS, clientNames: ['Acme Corp', 'Globex'] });
    let seed = 99;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const alphabet = 'abcXYZrevnu019 -_/&@.#$€%()é,';
    const corpus = ['Revenue', 'north-south', 'INV-20931', 'a@b', 'Q3', 'FY24', '2024', 'Acme Corp', 'globex', 'May', 'Delta'];
    for (let i = 0; i < 20000; i++) { let s = ''; for (let n = 1 + Math.floor(r() * 10); n--; ) s += alphabet[Math.floor(r() * alphabet.length)]; corpus.push(s); }
    const got = b.scan(corpus);
    const bad = corpus.map((t, i) => ({ t, ts: classify(t, { clientNames: ['acme corp', 'globex'] }), rust: got[i] })).filter((x) => x.ts !== x.rust);
    expect(bad.slice(0, 10)).toEqual([]);
  });
});
