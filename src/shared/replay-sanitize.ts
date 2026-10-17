/**
 * Makes rrweb recordings PII-free (Feature 4), deny by default. rrweb masks text and inputs, but records
 * attributes (links, alt, title, aria-label, data-*), CSS (url(), content strings) and the page URL as they are.
 * Here every string is either masked with the app's rules, reduced to a layout-only value, or dropped:
 *  - text: words masked unless allowlisted (maskText), style text: CSS with urls and content strings removed;
 *  - attributes: only layout/SVG geometry names are kept; links become "#"; input values become "*";
 *  - the page URL, fonts, canvas, console logs and custom/plugin events are dropped.
 * auditEvents() then checks the result independently; an export is refused unless it finds nothing.
 */
import { classify, maskText, maskWhole, maskWord, type ClassifyPolicy } from './classify';

// rrweb enums (@rrweb/types), inlined so this module has no runtime dependency.
const EV = { FullSnapshot: 2, Incremental: 3, Meta: 4, Custom: 5, Plugin: 6, Asset: 7 } as const;
const SRC = { Mutation: 0, Input: 5, StyleSheetRule: 8, Canvas: 9, Font: 10, Log: 11, StyleDeclaration: 13, AdoptedStyleSheet: 15 } as const;
const NODE = { Document: 0, DocumentType: 1, Element: 2, Text: 3, CDATA: 4, Comment: 5 } as const;

export interface RrEvent { type: number; data: any; timestamp: number; delay?: number }

/** Attribute names that carry layout or drawing, never content. Everything else is dropped. */
const KEEP = new Set([
  'class', 'id', 'style', 'type', 'role', 'dir', 'lang', 'hidden', 'disabled', 'checked', 'selected', 'open', 'multiple',
  'width', 'height', 'colspan', 'rowspan', 'span', 'cols', 'rows', 'size', 'tabindex', 'rel', 'media', 'charset',
  // SVG geometry and paint
  'xmlns', 'viewbox', 'preserveaspectratio', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'patternunits', 'clip-path', 'clippathunits', 'mask', 'text-anchor',
  'dominant-baseline', 'alignment-baseline', 'font-size', 'font-weight', 'font-family', 'letter-spacing', 'visibility', 'display',
  // rrweb's own: placeholder sizes for blocked elements, scroll and media state
  'rr_width', 'rr_height', 'rr_scrollleft', 'rr_scrolltop', 'rr_mediastate', 'rr_mediacurrenttime', 'rr_mediaplaybackrate',
  'rr_mediamuted', 'rr_medialoop', 'rr_mediavolume', 'rr_open_mode',
]);

const quoted = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const maskQuoted = (s: string) => s.replace(quoted, (q) => q[0] + q.slice(1, -1).replace(/[^\s"'\\]/g, 'x') + q[0]);

/** CSS with no way back to the page or its content: urls, imports, generated text and attribute selectors cleaned. */
export function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, 'none')
    .replace(/image-set\([^)]*\)/gi, 'none')
    .replace(/(content|quotes)\s*:\s*([^;}]*)/gi, (_m, prop: string, v: string) => `${prop}: ${maskQuoted(v)}`)
    .replace(/\[[^\]]*\]/g, (sel) => maskQuoted(sel));
}

/** class and id values: tokens that look like emails or carry 3+ digits are masked. */
const cleanToken = (v: string) => v.replace(/\S+/g, (t) => (/@/.test(t) ? maskWhole(t) : /\d{3,}/.test(t) ? maskWord(t) : t));

function cleanStyleValue(v: unknown): unknown {
  if (typeof v === 'string') return cleanCss(v);
  if (Array.isArray(v)) return v.map(cleanStyleValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanStyleValue(x)]));
  return v;
}

function cleanAttrs(tag: string | undefined, attrs: Record<string, unknown> | undefined, allowNull: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const name = k.toLowerCase();
    if (v === null && allowNull) { out[k] = null; continue; } // attribute removed in a mutation
    if (name === '_csstext') out[k] = cleanCss(String(v));
    else if (name === 'style') out[k] = cleanStyleValue(v);
    else if (name === 'href' && (tag === 'a' || tag === 'area')) out[k] = '#';
    else if (name === 'value') out[k] = '*'.repeat(Math.min(String(v ?? '').length, 24));
    else if (name === 'class' || name === 'id') out[k] = cleanToken(String(v));
    else if (name === 'rel') { if (/^(stylesheet|icon)$/i.test(String(v))) out[k] = v; }
    else if (KEEP.has(name)) out[k] = typeof v === 'string' && /[@:]|\/\//.test(v) && !/^(d|points|transform|style)$/.test(name) ? '' : v;
  }
  return out;
}

/** Tracks what earlier events said about node ids, so later mutations are cleaned the same way. */
class Ctx {
  styleText = new Set<number>();
  tags = new Map<number, string>();
  constructor(readonly policy: ClassifyPolicy) {}

  node(n: any, parentTag?: string): void {
    if (!n || typeof n !== 'object') return;
    if (n.type === NODE.Text) {
      const isStyle = n.isStyle || parentTag === 'style';
      if (isStyle) this.styleText.add(n.id);
      if (typeof n.textContent === 'string') n.textContent = isStyle ? cleanCss(n.textContent) : maskText(n.textContent, this.policy);
    } else if (n.type === NODE.CDATA || n.type === NODE.Comment) {
      n.textContent = '';
    } else if (n.type === NODE.DocumentType) {
      n.publicId = ''; n.systemId = '';
    } else if (n.type === NODE.Element) {
      const tag = String(n.tagName ?? '').toLowerCase();
      this.tags.set(n.id, tag);
      n.attributes = cleanAttrs(tag, n.attributes, false);
    }
    for (const c of n.childNodes ?? []) this.node(c, n.type === NODE.Element ? String(n.tagName).toLowerCase() : parentTag);
  }

  event(e: RrEvent): RrEvent | null {
    if (e.type === EV.Meta) return { ...e, data: { ...e.data, href: 'about:blank' } };
    if (e.type === EV.Custom || e.type === EV.Plugin || e.type === EV.Asset) return null;
    if (e.type === EV.FullSnapshot) { this.node(e.data.node); return e; }
    if (e.type !== EV.Incremental) return e;
    const d = e.data;
    switch (d.source) {
      case SRC.Mutation:
        for (const a of d.adds ?? []) this.node(a.node, this.tags.get(a.parentId));
        for (const t of d.texts ?? []) if (typeof t.value === 'string') t.value = this.styleText.has(t.id) ? cleanCss(t.value) : maskText(t.value, this.policy);
        for (const a of d.attributes ?? []) a.attributes = cleanAttrs(this.tags.get(a.id), a.attributes, true);
        return e;
      case SRC.Input:
        if (typeof d.text === 'string') d.text = '*'.repeat(Math.min(d.text.length, 24));
        return e;
      case SRC.StyleSheetRule:
        for (const a of d.adds ?? []) if (typeof a.rule === 'string') a.rule = cleanCss(a.rule);
        if (typeof d.replace === 'string') d.replace = cleanCss(d.replace);
        if (typeof d.replaceSync === 'string') d.replaceSync = cleanCss(d.replaceSync);
        return e;
      case SRC.StyleDeclaration:
        if (d.set && typeof d.set.value === 'string') d.set.value = cleanCss(d.set.value);
        return e;
      case SRC.AdoptedStyleSheet:
        for (const s of d.styles ?? []) for (const r of s.rules ?? []) if (typeof r.rule === 'string') r.rule = cleanCss(r.rule);
        return e;
      case SRC.Canvas: case SRC.Font: case SRC.Log:
        return null;
      default:
        return e;
    }
  }
}

/** A cleaned deep copy of the recording. The input is not changed. */
export function sanitizeEvents(events: readonly RrEvent[], policy: ClassifyPolicy = {}): RrEvent[] {
  const ctx = new Ctx(policy);
  const out: RrEvent[] = [];
  for (const e of structuredClone(events) as RrEvent[]) {
    const clean = ctx.event(e);
    if (clean) out.push(clean);
  }
  return out;
}

export interface Finding { where: string; value: string }

/**
 * Independent check of a recording, written separately from the sanitizer: visible text may only hold
 * allowlisted words or masked words; no string anywhere may hold an email, a link or a URL.
 */
export function auditEvents(events: readonly RrEvent[], policy: ClassifyPolicy = {}): Finding[] {
  const found: Finding[] = [];
  const isMasked = (tok: string) => maskWord(tok) === tok;
  const textOk = (s: string) => s.split(/\s+/).filter(Boolean).every((tok) => !classify(tok, policy) || isMasked(tok));
  const styleIds = new Set<number>();
  // Every string anywhere: no emails, links or URLs.
  const strings = (v: unknown, where: string): void => {
    if (typeof v === 'string') {
      if (/[\w.+-]+@[\w-]+\.\w|mailto:|tel:|https?:\/\/|(^|[\s("'])\/\/\w/i.test(v) || /url\(\s*[^)\s]/i.test(v)) found.push({ where, value: v.slice(0, 80) });
    } else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${where}.${k}`);
  };
  // Visible text in serialised nodes: only allowlisted or masked words.
  const nodes = (n: any, where: string, parentTag?: string): void => {
    if (!n || typeof n !== 'object') return;
    if (n.type === NODE.Text && typeof n.textContent === 'string') {
      if (n.isStyle || parentTag === 'style') styleIds.add(n.id);
      else if (!textOk(n.textContent)) found.push({ where: `${where}.textContent`, value: n.textContent.slice(0, 80) });
    }
    const tag = n.type === NODE.Element ? String(n.tagName).toLowerCase() : parentTag;
    (n.childNodes ?? []).forEach((c: unknown, i: number) => nodes(c, `${where}.childNodes[${i}]`, tag));
  };
  events.forEach((e, i) => {
    const at = `[${i}]`;
    if (e.type === EV.Meta && e.data?.href !== 'about:blank') found.push({ where: `${at}.data.href`, value: String(e.data?.href) });
    if (e.type === EV.FullSnapshot) nodes(e.data.node, `${at}.data.node`);
    if (e.type === EV.Incremental && e.data?.source === SRC.Mutation) {
      (e.data.adds ?? []).forEach((a: any, j: number) => nodes(a.node, `${at}.data.adds[${j}].node`));
      (e.data.texts ?? []).forEach((t: any, j: number) => {
        if (typeof t.value === 'string' && !styleIds.has(t.id) && !textOk(t.value)) found.push({ where: `${at}.data.texts[${j}]`, value: t.value.slice(0, 80) });
      });
    }
    if (e.type === EV.Incremental && e.data?.source === SRC.Input && typeof e.data.text === 'string' && /[^*]/.test(e.data.text)) {
      found.push({ where: `${at}.data.text`, value: 'typed input' });
    }
    if (e.type === EV.Custom || e.type === EV.Plugin || e.type === EV.Asset) found.push({ where: at, value: `event type ${e.type}` });
    strings(e.data, `${at}.data`);
  });
  return found;
}
