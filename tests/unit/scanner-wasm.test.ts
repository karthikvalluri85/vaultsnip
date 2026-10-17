import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScannerBridge, type WasmModule, type WasmScanner } from '../../src/content/scanner-wasm';

/* ---------- bridge behaviour, against a mock (runs without a Rust build) ---------- */

function mockModule(impl: Partial<WasmScanner> = {}): { mod: WasmModule; calls: string[] } {
  const calls: string[] = [];
  class Mock implements WasmScanner {
    set_allowlist(w: string) { calls.push(`allow:${w}`); }
    set_session_allow(w: string) { calls.push(`session:${w}`); }
    set_client_names(n: string) { calls.push(`clients:${n}`); }
    classify(t: string) { return t === 'a@b.c' ? 2 : 0; }
    scan(j: string) { calls.push(`scan:${JSON.stringify(j)}`); return Uint8Array.from(j.split('\u001f').map((t) => (t === 'a@b.c' ? 2 : 5))); }
    constructor() { Object.assign(this, impl); }
  }
  return { mod: { Scanner: Mock as unknown as WasmModule['Scanner'] }, calls };
}

describe('ScannerBridge', () => {
  it('pushes policy once and maps codes to labels, one WASM call per batch', async () => {
    const { mod, calls } = mockModule();
    const b = await ScannerBridge.create(async () => mod, { allow: ['revenue', 'sales'], clientNames: ['Acme', 'Globex'] });
    expect(b.scan(['a@b.c', 'zzz'])).toEqual(['Email', 'Text not on allowlist']);
    expect(calls.filter((c) => c.startsWith('scan:'))).toHaveLength(1);
    expect(calls).toContain('allow:revenue\nsales');
    expect(calls).toContain('clients:Acme,Globex');
  });

  it('neutralises the separator so one text cannot shift later results', async () => {
    const { mod, calls } = mockModule();
    const b = await ScannerBridge.create(async () => mod);
    const out = b.scan(['x\u001fy', 'a@b.c']);
    expect(out).toEqual(['Text not on allowlist', 'Email']);
    expect(calls.at(-1)).toBe(`scan:${JSON.stringify('x y\u001fa@b.c')}`);
  });

  it('fails loudly if the result count does not match', async () => {
    const { mod } = mockModule({ scan: () => Uint8Array.of(0) });
    const b = await ScannerBridge.create(async () => mod);
    expect(() => b.scan(['a', 'b'])).toThrow(/1 results for 2 texts/);
  });

  it('handles an empty batch without calling WASM', async () => {
    const { mod, calls } = mockModule();
    const b = await ScannerBridge.create(async () => mod);
    expect(b.scan([])).toEqual([]);
    expect(calls.some((c) => c.startsWith('scan:'))).toBe(false);
  });
});

/* ---------- parity + speed against the real module (needs `npm run build:wasm`) ---------- */

const WASM_DIR = resolve(__dirname, '../../public/wasm');
const built = existsSync(resolve(WASM_DIR, 'vaultsnip_core_bg.wasm'));

// Verbatim logic of classify() in web/app.js, with the policy sets passed in.
function refClassify(text: string, allow: Set<string>, session: Set<string>, clients: string[]): number {
  const raw = text.trim();
  const clean = raw.replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, '');
  if (!clean) return 0;
  const low = clean.toLowerCase();
  if (clients.some((n) => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return 1;
  if (/\w@\w/.test(raw) || (/@/.test(raw) && /\./.test(raw))) return 2;
  if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return 0;
  if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return 3;
  if (/[\d€$£¥₹%]/.test(clean)) return 4;
  if (clean.length <= 1) return 0;
  if (allow.has(low) || session.has(low)) return 0;
  const parts = low.split(/[-/&]/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => allow.has(p))) return 0;
  return 5;
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe.skipIf(!built)('Rust scanner (real WASM)', () => {
  const allow = new Set(['revenue', 'sales', 'north', 'south', 'region', 'total', 'q', 'jan', 'feb', 'orders']);
  const session = new Set(['widgets']);
  const clients = ['acme corp', 'globex'];

  async function load() {
    const glue = await import(/* @vite-ignore */ pathToFileURL(resolve(WASM_DIR, 'vaultsnip_core.js')).href);
    glue.initSync({ module: readFileSync(resolve(WASM_DIR, 'vaultsnip_core_bg.wasm')) });
    const b = await ScannerBridge.create(async () => glue as WasmModule, {
      allow, sessionAllow: session, clientNames: ['Acme Corp', 'Globex'],
    });
    return b;
  }

  it('matches the JavaScript classify() on a fuzzed corpus', async () => {
    const b = await load();
    const alphabet = 'abcXYZ019 -_/&@.#$€%()é,';
    const r = rng(42);
    const corpus: string[] = ['', ' ', 'Revenue', 'North-South', 'widgets-revenue', 'INV-20931', '4410-X', 'a@b', 'Q3', 'FY24', '2024', 'Acme Corp Q3'];
    for (let i = 0; i < 20000; i++) {
      let s = '';
      for (let n = 1 + Math.floor(r() * 12); n--; ) s += alphabet[Math.floor(r() * alphabet.length)];
      corpus.push(s);
    }
    const labels = ['none', 'Client name', 'Email', 'Identifier', 'Number or money', 'Text not on allowlist'];
    const got = b.scan(corpus);
    const bad = corpus
      .map((t, i) => ({ t, want: refClassify(t, allow, session, clients), got: got[i] }))
      .filter((x) => (x.got ?? 'none') !== labels[x.want]);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('scans a 5,000-node page in under 50 ms (main-thread budget)', async () => {
    const b = await load();
    const r = rng(7);
    const words = ['Revenue', 'Initech', '$1,204', 'INV-20931', 'north', 'jane@corp.com', 'Q3', 'Total'];
    const texts = Array.from({ length: 5000 }, () => words[Math.floor(r() * words.length)] + ' ' + Math.floor(r() * 99));
    b.scan(texts); // warm-up: JIT and first allocation
    const t0 = performance.now();
    b.scan(texts);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
  });
});
