/**
 * The text scanner the chart blur uses: the Rust scanner when it loads, otherwise the same rules in TypeScript
 * (src/shared/classify.ts, kept in step with the Rust scanner by tests). A WASM load failure therefore never stops
 * the chart blur, and never lets text through unchecked.
 */
import { classify } from '../shared/classify';
import { ScannerBridge, type Category, type WasmLoader } from '../content/scanner-wasm';

export interface TextScanner {
  scan(texts: readonly string[]): (Category | null)[];
  readonly engine: 'wasm' | 'typescript';
}

export async function createScanner(load: WasmLoader, allow: readonly string[]): Promise<TextScanner> {
  try {
    const bridge = await ScannerBridge.create(load, { allow });
    return { engine: 'wasm', scan: (texts) => bridge.scan(texts) };
  } catch (e) {
    console.warn('VaultSnip: the Rust scanner did not load; using the same rules in TypeScript.', e);
    const set = new Set(allow);
    return { engine: 'typescript', scan: (texts) => texts.map((t) => classify(t, { allow: set })) };
  }
}
