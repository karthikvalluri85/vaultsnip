/**
 * TypeScript port of classify() in web/app.js, used by the extension's chart blur (src/background/offscreen-ocr.ts).
 * Same order of checks, same results: tests/unit/classify.test.ts checks it against web/app.js on a fuzzed corpus.
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
  const clean = raw.replace(/^[^\p{L}\p{N}_€$£¥₹%#@]+|[^\p{L}\p{N}_€$£¥₹%]+$/gu, '');
  if (!clean) return null;
  const low = clean.toLowerCase();
  if ((p.clientNames ?? []).some((n) => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return 'Client name';
  if (/\w@\w/.test(raw) || (/@/.test(raw) && /\./.test(raw))) return 'Email';
  if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return null;
  // period and rank labels BI tools use: rolling windows (L12M, R12M, T12M, L30D, P3M), quarter and fiscal ranges
  // (Q1-Q3, FY25-26, 2025-26) and rank markers (#1). They name a time window or a position, never a value.
  if (/^[lrtpn]\d{1,3}[dwmqy]$/i.test(clean) || /^q[1-4][-–]q[1-4]$/i.test(clean) || /^fy\d{2}[-–/]\d{2}$/i.test(clean)
    || /^(19|20)\d{2}[-–/]((19|20)?\d{2})$/.test(clean) || /^#\d{1,2}$/.test(clean)) return null;
  if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return 'Identifier';
  if (/[\d€$£¥₹%]/.test(clean)) return 'Number or money';
  if (clean.length <= 1) return null;
  if (allow.has(low)) return null;
  // a compound or an elided word ("Sous-total", "d'affaires", "Nord/Süd") is safe when every part is
  const parts = low.replace(/’/g, "'").split(/[-/&']/).filter(Boolean);
  if (parts.length > 1 && parts.some((x) => x.length > 1) && parts.every((x) => x.length <= 1 || allow.has(x))) return null;
  return 'Text not on allowlist';
}
