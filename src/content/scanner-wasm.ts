/**
 * Bridge to the Rust scanner (src/core-rust). Port of classify() in web/app.js.
 *
 * One call per batch, not per node: the texts are joined with U+001F, cross the WASM boundary once,
 * and come back as one byte per text. Policy (allowlist, client names) is pushed in only when it changes.
 */

export const CATEGORIES = [
  null,
  'Client name',
  'Email',
  'Identifier',
  'Number or money',
  'Text not on allowlist',
] as const;
export type Category = Exclude<(typeof CATEGORIES)[number], null>;

/** Shape of the wasm-bindgen glue for the `Scanner` class. */
export interface WasmScanner {
  set_allowlist(words: string): void;
  set_session_allow(words: string): void;
  set_client_names(names: string): void;
  classify(text: string): number;
  scan(joined: string): Uint8Array;
  free?(): void;
}
export interface WasmModule {
  Scanner: new () => WasmScanner;
}
export type WasmLoader = () => Promise<WasmModule>;

const SEP = '\u001f';

export interface Policy {
  /** ALLOW plus the user's extra allowlist. */
  allow?: Iterable<string>;
  /** Words approved during this session. */
  sessionAllow?: Iterable<string>;
  clientNames?: Iterable<string>;
}

export class ScannerBridge {
  private constructor(private readonly wasm: WasmScanner) {}

  static async create(load: WasmLoader, policy: Policy = {}): Promise<ScannerBridge> {
    const mod = await load();
    const bridge = new ScannerBridge(new mod.Scanner());
    bridge.setPolicy(policy);
    return bridge;
  }

  setPolicy(p: Policy): void {
    if (p.allow) this.wasm.set_allowlist([...p.allow].join('\n'));
    if (p.sessionAllow) this.wasm.set_session_allow([...p.sessionAllow].join('\n'));
    if (p.clientNames) this.wasm.set_client_names([...p.clientNames].join(','));
  }

  classify(text: string): Category | null {
    return CATEGORIES[this.wasm.classify(text.replaceAll(SEP, ' '))] ?? null;
  }

  /** Classify many texts in one WASM call. Result order matches input order. */
  scan(texts: readonly string[]): (Category | null)[] {
    if (texts.length === 0) return [];
    // A text holding U+001F would shift every later result by one, so it is neutralised first.
    const codes = this.wasm.scan(texts.map((t) => t.replaceAll(SEP, ' ')).join(SEP));
    if (codes.length !== texts.length) {
      throw new Error(`scanner returned ${codes.length} results for ${texts.length} texts`);
    }
    return Array.from(codes, (c) => CATEGORIES[c] ?? null);
  }

  dispose(): void {
    this.wasm.free?.();
  }
}

/**
 * Default loader for the packed extension. The .wasm ships inside the extension
 * (public/wasm, listed in web_accessible_resources), so nothing is fetched from the network.
 * extension/manifest.json already allows `'wasm-unsafe-eval'` for extension pages (Tesseract needs it too).
 * Still to do when wiring it in: copy public/wasm into the packed extension and list it in web_accessible_resources
 * if a content script (rather than an extension page) loads it.
 */
export const extensionLoader: WasmLoader = async () => {
  const base = chrome.runtime.getURL('wasm/');
  const glue = (await import(/* @vite-ignore */ `${base}vaultsnip_core.js`)) as WasmModule & {
    default(input: string): Promise<unknown>;
  };
  await glue.default(`${base}vaultsnip_core_bg.wasm`);
  return glue;
};
