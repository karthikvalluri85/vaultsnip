/**
 * The seams between features: what happens when one side of a handoff fails or grows too large.
 */
import { describe, expect, it } from 'vitest';
import { createScanner } from '../../src/background/text-scanner';
import { classify } from '../../src/shared/classify';
import { ALLOW_WORDS } from '../../src/shared/allowlist';
import { CATEGORIES, type WasmModule } from '../../src/content/scanner-wasm';
import { MAX_BYTES, sizeBudget } from '../../src/content/recorder';

const TEXTS = ['Revenue', 'Kestrelmoor', 'jane.doe@kestrelmoor.com', '$1,204,330', 'INV-20931', '2025', 'Q3', 'Sales', ''];

describe('chart blur: OCR text to scanner', () => {
  it('falls back to the same rules in TypeScript when the Rust scanner does not load', async () => {
    const s = await createScanner(async () => { throw new Error('wasm blocked'); }, ALLOW_WORDS);
    expect(s.engine).toBe('typescript');
    const allow = new Set(ALLOW_WORDS);
    expect(s.scan(TEXTS)).toEqual(TEXTS.map((t) => classify(t, { allow })));
    // the fallback still masks: nothing goes through unchecked
    expect(s.scan(['Kestrelmoor', '$1,204,330'])).toEqual(['Text not on allowlist', 'Number or money']);
  });

  it('uses the Rust scanner when it loads', async () => {
    const mod: WasmModule = {
      Scanner: class {
        set_allowlist() {} set_session_allow() {} set_client_names() {}
        classify() { return 0; }
        scan(joined: string) { return Uint8Array.from(joined.split('\u001f').map((t) => (t.includes('@') ? CATEGORIES.indexOf('Email') : 0))); }
      } as unknown as WasmModule['Scanner'],
    };
    const s = await createScanner(async () => mod, ALLOW_WORDS);
    expect(s.engine).toBe('wasm');
    expect(s.scan(['a@b.c', 'Revenue'])).toEqual(['Email', null]);
  });
});

describe('session replay: recording to replay page', () => {
  it('stops before a recording is too large for an extension message (64 MiB)', () => {
    expect(MAX_BYTES).toBeLessThan(64 * 1024 * 1024 * 0.75);
    const b = sizeBudget(1000);
    expect(b.add({ type: 3, data: 'x'.repeat(400) })).toBe(false);
    expect(b.add({ type: 3, data: 'x'.repeat(400) })).toBe(false);
    expect(b.add({ type: 2, data: 'x'.repeat(400) })).toBe(true);
    expect(b.total).toBeGreaterThan(1000);
  });

  it('never throws on an event it cannot measure', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const b = sizeBudget(10);
    expect(() => b.add(cyclic)).not.toThrow();
    expect(b.total).toBe(0);
  });
});
