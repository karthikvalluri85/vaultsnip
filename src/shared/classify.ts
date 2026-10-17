/**
 * TypeScript port of classify() in web/app.js, for code that cannot load WASM (content scripts run under the
 * page's CSP). Same order of checks, same results; tests/unit/replay.test.ts checks it against the Rust
 * scanner, which is itself checked against web/app.js.
 */
import { ALLOW_WORDS } from './allowlist';

export type TextType = 'Client name' | 'Email' | 'Identifier' | 'Number or money' | 'Text not on allowlist';

export interface ClassifyPolicy {
  allow?: ReadonlySet<string>;
  clientNames?: readonly string[];
}

export const DEFAULT_ALLOW: ReadonlySet<string> = new Set(ALLOW_WORDS);

export function classify(text: string, p: ClassifyPolicy = {}): TextType | null {
  const allow = p.allow ?? DEFAULT_ALLOW;
  const raw = text.trim();
  const clean = raw.replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, '');
  if (!clean) return null;
  const low = clean.toLowerCase();
  if ((p.clientNames ?? []).some((n) => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return 'Client name';
  if (/\w@\w/.test(raw) || (/@/.test(raw) && /\./.test(raw))) return 'Email';
  if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return null;
  if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return 'Identifier';
  if (/[\d€$£¥₹%]/.test(clean)) return 'Number or money';
  if (clean.length <= 1) return null;
  if (allow.has(low)) return null;
  const parts = low.split(/[-/&]/).filter(Boolean);
  if (parts.length > 1 && parts.every((x) => allow.has(x))) return null;
  return 'Text not on allowlist';
}

/** Hides a word but keeps its shape, so layouts replay at the same width: letters → X/x, digits → 0. */
export const maskWord = (w: string) => w.replace(/[\p{L}\p{N}]/gu, (c) => (/\p{N}/u.test(c) ? '0' : /\p{Lu}/u.test(c) ? 'X' : 'x'));

/**
 * Masks every word classify() would mask; allowlisted words, years and periods stay readable.
 * Idempotent: masking masked text changes nothing.
 */
export function maskText(text: string, p: ClassifyPolicy = {}): string {
  return text.replace(/\S+/g, (tok) => {
    const type = classify(tok, p);
    return !type ? tok : type === 'Email' ? maskWhole(tok) : maskWord(tok);
  });
}

/** Emails lose their shape too ("xxxxxxxxxx"), so no "@" or domain structure is left. */
export const maskWhole = (w: string) => w.replace(/\S/g, 'x');
