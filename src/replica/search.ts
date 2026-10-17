/**
 * Search inside a replica (Feature 7), built as web/lib/vs-search.js (window.VSSearch).
 * Adds a "Search this dashboard" box to a rendered replica. The index is built with MiniSearch (MIT) from what the replica
 * shows at that moment (titles, labels, legend and category names, table cells, KPI values, filter chips) and rebuilt on
 * every render, so it follows filters, "Regenerate data" and privacy modes: a Generic replica can only find Generic labels.
 * Hidden attributes (such as the raw filter keys) are never indexed. Nothing is stored; no network calls.
 * Results scroll to the visual and highlight it; a match on a filter chip or a table row can filter the page in one click.
 */
import MiniSearch from 'minisearch';

export type Field = 'title' | 'subtitle' | 'kpi' | 'category' | 'series' | 'column' | 'cell' | 'comment' | 'text' | 'filter';

export interface Doc {
  id: number;
  /** Index of the card in the grid; -1 for the page header and filter bar. */
  card: number;
  /** The visual's title as shown, for the result line. */
  visual: string;
  field: Field;
  text: string;
  /** A filter the result can apply: [dimension key, raw member], from the chip or row that showed it. */
  filter?: [string, string];
}

export interface Result extends Doc { score: number; terms: string[] }

const FIELD_LABEL: Record<Field, string> = {
  title: 'Title', subtitle: 'Subtitle', kpi: 'KPI', category: 'Label', series: 'Series', column: 'Column', cell: 'Value', comment: 'Comment', text: 'Text', filter: 'Filter',
};
export const fieldLabel = (f: Field) => FIELD_LABEL[f] || f;

/* ---------- pure helpers (unit tested) ---------- */

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isLabel = (s: string) => !!s && !/^[-+]?[\d.,\s%]+$/.test(s); // bare numbers on an axis are not worth finding

type Opt = Record<string, unknown>;
const list = (x: unknown): Opt[] => (Array.isArray(x) ? x : x ? [x] : []) as Opt[];

/** The names a chart shows: axis categories, legend entries, series names, and named data points (pie, funnel, map, sankey). */
export function chartTerms(option: unknown): { category: string[]; series: string[] } {
  const o = (option || {}) as Opt;
  const category = new Set<string>(), series = new Set<string>();
  const val = (d: unknown) => clean(d && typeof d === 'object' ? (d as Opt).value ?? (d as Opt).name : d);
  ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis'].forEach((k) => list(o[k]).forEach((ax) => list(ax.data).forEach((d) => { const s = val(d); if (isLabel(s)) category.add(s); })));
  list(o.legend).forEach((lg) => list(lg.data).forEach((d) => { const s = val(d); if (isLabel(s)) series.add(s); }));
  list(o.series).forEach((s) => {
    const n = clean(s.name); if (isLabel(n) && !/^series\d+$/i.test(n)) series.add(n);
    [...list(s.data), ...list(s.nodes)].forEach((d) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return;
      const name = clean((d as Opt).label && typeof (d as Opt).label === 'string' ? (d as Opt).label : (d as Opt).name);
      if (isLabel(name)) category.add(name);
    });
  });
  return { category: [...category], series: [...series] };
}

const escH = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML for a result line: the text escaped, with the words that matched marked. */
export function highlight(text: string, terms: string[]): string {
  const words = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return escH(text);
  const re = new RegExp('(' + words.map(escRe).join('|') + ')', 'gi');
  return text.split(re).map((part, i) => (i % 2 ? '<mark>' + escH(part) + '</mark>' : escH(part))).join('');
}

/** A MiniSearch index over the documents, tuned for short labels: prefix and typo-tolerant matching, titles first. */
export function makeIndex(docs: Doc[]) {
  const ms = new MiniSearch<Doc>({
    fields: ['text', 'visual'],
    storeFields: ['card', 'visual', 'field', 'text', 'filter'],
    searchOptions: { prefix: true, fuzzy: (term) => (term.length > 3 ? 0.2 : false), boost: { text: 2, visual: 1 }, combineWith: 'AND' },
  });
  ms.addAll(docs);
  return ms;
}

/** Best results first, one per visual and value, at most `limit`. */
export function search(ms: MiniSearch<Doc>, query: string, limit = 8): Result[] {
  const q = clean(query);
  if (!q) return [];
  const seen = new Set<string>();
  const out: Result[] = [];
  for (const r of ms.search(q) as unknown as Result[]) {
    const k = r.card + '|' + r.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------- reading the replica ---------- */

export interface EChartsLike { getInstanceByDom(el: HTMLElement): { getOption(): unknown } | undefined }

/** Documents for everything the replica shows. Text only, never hidden attributes; filter keys come from the clickable chips and rows. */
export function buildDocs(root: HTMLElement, echarts?: EChartsLike): Doc[] {
  const docs: Doc[] = [];
  const seen = new Set<string>();
  const add = (card: number, visual: string, field: Field, text: string, filter?: [string, string]) => {
    const t = clean(text);
    const k = card + '|' + field + '|' + t.toLowerCase();
    if (!t || seen.has(k)) return;
    seen.add(k);
    docs.push({ id: docs.length, card, visual, field, text: t, filter });
  };
  const txt = (el: Element | null) => clean(el && el.textContent);
  const keyOf = (el: Element): [string, string] | undefined => {
    const d = el.getAttribute('data-dim'), r = el.getAttribute('data-raw');
    return d && r != null ? [d, r] : undefined;
  };

  const page = txt(root.querySelector('.rp-head h2'));
  add(-1, page, 'title', page);
  add(-1, page, 'subtitle', txt(root.querySelector('.rp-head h2 + span')));
  root.querySelectorAll('.rp-filters .lbl').forEach((l) => add(-1, 'Filters', 'filter', txt(l)));
  root.querySelectorAll('.rp-filters .rp-chip[data-dim]').forEach((chip) => add(-1, 'Filters', 'filter', txt(chip).replace(/\s*✕$/, ''), keyOf(chip)));

  root.querySelectorAll('.rp-grid > .rp-card').forEach((card, ci) => {
    const kpi = card.classList.contains('rp-kpi');
    const title = kpi ? txt(card.querySelector('.k')) : txt(card.querySelector('h3'));
    const visual = title || 'Visual ' + (ci + 1);
    if (kpi) { add(ci, visual, 'kpi', title); add(ci, visual, 'cell', txt(card.querySelector('.v'))); return; }
    add(ci, visual, 'title', title);
    card.querySelectorAll('.rp-table th').forEach((th) => add(ci, visual, 'column', txt(th)));
    card.querySelectorAll('.rp-table tbody tr').forEach((tr) => {
      const key = tr.classList.contains('rp-row') ? keyOf(tr) : undefined;
      Array.from(tr.children).forEach((td, i) => add(ci, visual, td.classList.contains('q') ? 'comment' : 'cell', txt(td), i === 0 ? key : undefined));
    });
    card.querySelectorAll('.rp-fi').forEach((fi) => {
      fi.querySelectorAll('.m b, .m span:first-child').forEach((m) => add(ci, visual, 'cell', txt(m)));
      fi.querySelectorAll('p').forEach((p) => add(ci, visual, 'comment', txt(p)));
    });
    card.querySelectorAll('.rp-text').forEach((p) => add(ci, visual, 'text', txt(p)));
    card.querySelectorAll<HTMLElement>('.rp-chart').forEach((el) => {
      const inst = echarts && echarts.getInstanceByDom(el);
      if (!inst) return;
      const t = chartTerms(inst.getOption());
      t.category.forEach((s) => add(ci, visual, 'category', s));
      t.series.forEach((s) => add(ci, visual, 'series', s));
    });
  });
  return docs;
}

/* ---------- the search box ---------- */

const CSS = `
.rp-search{position:relative;z-index:25;flex:0 1 280px;min-width:160px;margin-left:auto}
.rp-search input{width:100%;font:inherit;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#fff}
.rp-search input::placeholder{color:#cfd7e2}
.rp-search input:focus{outline:2px solid #8fc1ff;outline-offset:1px;background:rgba(255,255,255,.18)}
.rp-sr{position:absolute;right:0;top:calc(100% + 6px);width:min(420px,calc(100vw - 48px));max-height:360px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--rp-surface);color:var(--rp-ink);border:1px solid var(--rp-line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.rp-sr li{display:flex;align-items:center;gap:6px;border-radius:6px}
.rp-sr li[aria-selected="true"],.rp-sr li:hover{background:var(--rp-bg)}
.rp-sr .go{flex:1;min-width:0;display:block;text-align:left;font:inherit;font-size:12.5px;color:inherit;background:none;border:0;padding:7px 8px;cursor:pointer}
.rp-sr .go b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-sr .go span{display:block;color:var(--rp-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-sr .go small{color:var(--rp-muted);text-transform:uppercase;letter-spacing:.04em;font-size:10.5px;margin-right:6px}
.rp-sr mark{background:#ffe58a;color:#14181e;border-radius:2px;padding:0 1px}
.rp-sr .flt{font:inherit;font-size:11.5px;padding:3px 8px;margin-right:6px;border-radius:99px;border:1px solid #2a78d6;background:none;color:#2a78d6;cursor:pointer;white-space:nowrap}
.rp-sr .none{padding:8px;font-size:12.5px;color:var(--rp-muted)}
.rp-card.rp-hit{outline:3px solid #2a78d6;outline-offset:2px;transition:outline-color .3s}
@media (max-width:760px){.rp-search{flex-basis:100%;margin-left:0}}
`;

let uid = 0;

/** Adds the search box to a rendered replica and indexes it. Call again after every render; the previous query is kept. */
export function attach(root: HTMLElement & { _searchQuery?: string; _toggle?: (pairs: [string, string][]) => void }, opts: { echarts?: EChartsLike } = {}) {
  const doc = root.ownerDocument;
  if (!doc.getElementById('rp-search-style')) { const st = doc.createElement('style'); st.id = 'rp-search-style'; st.textContent = CSS; doc.head.appendChild(st); }
  const head = root.querySelector('.rp-head');
  if (!head) return null;
  const docs = buildDocs(root, opts.echarts);
  const ms = makeIndex(docs);
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.rp-grid > .rp-card'));

  const id = 'rp-sr-' + ++uid;
  const box = doc.createElement('div');
  box.className = 'rp-search';
  box.setAttribute('role', 'search');
  box.innerHTML = `<input type="search" placeholder="Search this dashboard" aria-label="Search this dashboard" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}" autocomplete="off" spellcheck="false"><ul class="rp-sr" id="${id}" role="listbox" aria-label="Search results" hidden></ul>`;
  head.appendChild(box);
  const input = box.querySelector('input') as HTMLInputElement;
  const ul = box.querySelector('ul') as HTMLUListElement;
  let results: Result[] = [], sel = -1;

  const close = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); sel = -1; };
  const mark = (i: number) => {
    sel = i;
    ul.querySelectorAll('li').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', id + '-' + i); else input.removeAttribute('aria-activedescendant');
  };
  const go = (r: Result) => {
    close();
    const target = r.card >= 0 ? cards[r.card] : (root.querySelector('.rp-filters') as HTMLElement | null) || (head as HTMLElement);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (r.card >= 0) { target.classList.add('rp-hit'); setTimeout(() => target.classList.remove('rp-hit'), 1800); }
  };
  const show = () => {
    root._searchQuery = input.value;
    results = search(ms, input.value);
    if (!input.value.trim()) { close(); return; }
    ul.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" id="${id}-${i}" aria-selected="false"><button type="button" class="go" tabindex="-1"><b>${escH(r.visual)}</b><span><small>${escH(fieldLabel(r.field))}</small>${highlight(r.text, [...r.terms, ...input.value.split(/\s+/)])}</span></button>${r.filter && root._toggle ? `<button type="button" class="flt" tabindex="-1" title="Filter the page to ${escH(r.text)}">Filter</button>` : ''}</li>`).join('')
      : '<li class="none" role="presentation">No matches on this dashboard</li>';
    ul.querySelectorAll('li[role="option"]').forEach((li, i) => {
      (li.querySelector('.go') as HTMLElement).addEventListener('click', () => go(results[i]));
      const f = li.querySelector('.flt');
      if (f) f.addEventListener('click', () => { const r = results[i]; close(); if (r.filter && root._toggle) root._toggle([r.filter]); });
    });
    ul.hidden = false; input.setAttribute('aria-expanded', 'true'); mark(results.length ? 0 : -1);
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', () => { if (input.value.trim()) show(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); if (ul.hidden) show(); mark((sel + 1) % results.length); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); mark((sel - 1 + results.length) % results.length); }
    else if (e.key === 'Enter' && sel >= 0 && !ul.hidden) { e.preventDefault(); go(results[sel]); }
    else if (e.key === 'Escape') { if (!ul.hidden) { e.preventDefault(); close(); } else if (input.value) { input.value = ''; root._searchQuery = ''; } }
  });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget as Node)) setTimeout(() => { if (!box.contains(doc.activeElement)) close(); }, 0); });
  if (root._searchQuery) input.value = root._searchQuery;
  return { docs, search: (q: string) => search(ms, q), input };
}
