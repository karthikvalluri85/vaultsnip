// Table and pivot structure from OCR words (developer prototype; nothing here ships yet). For transactional reports
// (SSRS, Crystal Reports, BusinessObjects): columns, header levels, pivot column groups, row groups, total rows and
// filter/parameter bars, worked out from where the words sit. No model: deterministic, and it cannot invent text.
// Output text follows VaultSnip's masking rules: a word the rules mask comes out as [masked].
//
//   node tools/eval-vision/tables.mjs <bench dir with run/*.ocr.json>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NUM = /^[(\-+]?[$€£¥₹]?\d[\d,.]*%?\)?$/;
const DATE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$/i;
const TOTAL = /^(grand\s+)?(sub)?totals?:?$/i;
const shown = (w) => (w.kept ? w.text : '[masked]');
// two words that belong to one date ("January 5," "2009", "Jan" "5", "12:00:00" "AM") are never split into columns
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
const datePart = (a, b) => (MONTH.test(a) && /^\d{1,2},?$/.test(b)) || (/^\d{1,2},$/.test(a) && /^\d{4}$/.test(b)) || (/^\d{1,2}:\d{2}/.test(a) && /^(am|pm)$/i.test(b));

/** Words grouped into text lines, then into cells (words close together on a line belong to one cell). */
export function linesAndCells(words) {
  const med = words.length ? [...words].sort((a, b) => a.h - b.h)[Math.floor(words.length / 2)].h : 12;
  const lines = [];
  for (const w of [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const yc = w.y + w.h / 2, l = lines.find((l) => Math.abs(l.yc - yc) < med * 0.55);
    if (l) { l.ws.push(w); l.yc = (l.yc * (l.ws.length - 1) + yc) / l.ws.length; } else lines.push({ yc, ws: [w] });
  }
  for (const l of lines) {
    l.ws.sort((a, b) => a.x - b.x); l.cells = [];
    for (const w of l.ws) {
      const c = l.cells[l.cells.length - 1];
      if (c && w.x - c.x1 < med * 0.75) { c.words.push(w); c.x1 = w.x + w.w; } else l.cells.push({ x0: w.x, x1: w.x + w.w, words: [w] });
    }
    for (const c of l.cells) { c.text = c.words.map((w) => w.text).join(' '); c.shown = c.words.map(shown).join(' '); c.num = c.words.every((w) => NUM.test(w.text.replace(/[^\d$€£¥₹%,.()+-]/g, '') ? w.text : 'x')); c.date = c.words.some((w) => DATE.test(w.text)); }
    l.numeric = l.cells.filter((c) => c.num).length;
  }
  return { lines, med };
}

export function extractTable(words, size) {
  const { lines, med } = linesAndCells(words);
  if (!lines.length) return null;
  const top = size[1] * 0.3;
  // filter / parameter bar: a prompt ending in "?" or ":" or a run button near the top
  const filters = [];
  const BUTTON = /(view report|apply|run report|refresh)/i;
  const lineText = (l) => l.ws.map((w) => w.text).join(' ');
  const isFilter = (l) => l.yc < top && (l.cells.some((c) => /[?:]$/.test(c.text) && c.text.length > 2) || BUTTON.test(lineText(l)));
  for (const l of lines.filter(isFilter)) {
    const label = l.cells.find((c) => /[?:]$/.test(c.text));
    filters.push({ label: label ? label.shown.replace(/[?:]$/, '') : '', button: BUTTON.test(lineText(l)) });
  }
  const body = lines.filter((l) => !isFilter(l));
  // title: a short line of large text above everything else
  const titleLine = body.find((l) => l.ws.every((w) => w.h > med * 1.3) && l.cells.length <= 2 && !l.numeric);
  const rows = body.filter((l) => l !== titleLine);
  const firstData = rows.findIndex((l) => l.numeric >= Math.max(1, l.cells.length * 0.4));
  if (firstData < 0) return { title: titleLine ? titleLine.cells.map((c) => c.shown).join(' ') : '', filters, columns: [] };
  const headers = rows.slice(0, firstData).filter((l) => l.cells.length >= 2 || l.yc > rows[firstData].yc - med * 6);
  const data = rows.slice(firstData);
  // a footer line of only a date or time (when the report ran) is not data
  const STAMP = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}(:\d{2})?|am|pm|page|of|\d+)$/i;
  while (data.length > 1 && data[data.length - 1].ws.every((w) => STAMP.test(w.text))) data.pop();
  // column separators from the data rows: x ranges covered by cells in many rows
  const W = size[0], cover = new Uint16Array(W + 1);
  for (const l of data) for (const w of l.ws) for (let x = Math.max(0, Math.floor(w.x)); x <= Math.min(W, Math.ceil(w.x + w.w)); x++) cover[x]++;
  const need = Math.max(1, data.length * 0.15), cols = [];
  for (let x = 0, s = -1; x <= W; x++) { const on = cover[x] >= need; if (on && s < 0) s = x; if ((!on || x === W) && s >= 0) { cols.push([s, x]); s = -1; } }
  // merge column ranges closer than half a character (one column's cells vary in width)
  let merged = []; for (const c of cols) { const last = merged[merged.length - 1]; if (last && c[0] - last[1] < med * 0.6) last[1] = c[1]; else merged.push([...c]); }
  // columns that touch (a right-aligned date beside left-aligned text) are told apart by alignment: many rows have a
  // small gap at the same x, words ending just before it and starting just after it
  merged = merged.flatMap(([a, b]) => {
    const votes = new Map(); let rowsHere = 0;
    for (const l of data) {
      const ws = l.ws.filter((w) => w.x + w.w > a && w.x < b).sort((p, q) => p.x - q.x);
      if (ws.length < 2) continue; rowsHere++;
      for (let i = 1; i < ws.length; i++) { const g0 = ws[i - 1].x + ws[i - 1].w, g1 = ws[i].x; if (g1 - g0 >= 1.5 && !datePart(ws[i - 1].text, ws[i].text)) { const bin = Math.round((g0 + g1) / 2 / 4); votes.set(bin, (votes.get(bin) || 0) + 1); } }
    }
    const splits = [...votes.entries()].filter(([, n]) => rowsHere >= 4 && n >= rowsHere * 0.45).map(([bin]) => bin * 4).sort((p, q) => p - q)
      .filter((x, i, arr) => i === 0 || x - arr[i - 1] > med);   // one split per gap
    if (!splits.length) return [[a, b]];
    const edges = [a, ...splits, b]; return edges.slice(1).map((e, i) => [edges[i], e]);
  });
  // the header row is the best guide to the columns: each header label is one column, as a reader sees it
  const nameRow = headers[headers.length - 1];
  const anchored = true;   // every word is placed in its column on its own; header words name the columns they sit over
  const colOf = (cell) => { const xc = (cell.x0 + cell.x1) / 2; let best = 0, d = Infinity; merged.forEach((c, i) => { const dd = xc < c[0] ? c[0] - xc : xc > c[1] ? xc - c[1] : 0; if (dd < d) { d = dd; best = i; } }); return best; };
  // with header anchors every word joins its nearest column on its own, so words of neighbouring columns never merge
  const pieces = (l) => (anchored ? l.ws.map((w) => ({ x0: w.x, x1: w.x + w.w, words: [w], text: w.text, shown: shown(w), num: NUM.test(w.text), date: DATE.test(w.text) })) : l.cells);
  const grid = data.map((l) => { const r = Array(merged.length).fill(null); pieces(l).forEach((c) => { const i = colOf(c); r[i] = r[i] ? { ...r[i], text: r[i].text + ' ' + c.text, shown: r[i].shown + ' ' + c.shown, num: r[i].num && c.num, date: r[i].date || c.date } : c; }); return r; });
  const kinds = merged.map((_, i) => { const cs = grid.map((r) => r[i]).filter(Boolean); const n = cs.filter((c) => c.num).length, d = cs.filter((c) => c.date).length; return n > cs.length * 0.6 ? 'number' : d > cs.length * 0.4 ? 'date' : 'text'; });
  // header rows: the last header line names the columns; lines above it with cells spanning several columns are pivot groups
  const nameLine = nameRow;
  const names = merged.map((c, i) => (nameLine ? nameLine.ws.filter((w) => colOf({ x0: w.x, x1: w.x + w.w }) === i).map(shown).join(' ') : ''));
  const spans = headers.slice(0, -1).map((l) => l.cells.map((c) => { const a = colOf({ x0: c.x0, x1: c.x0 }), b = colOf({ x0: c.x1, x1: c.x1 }); return { text: c.shown, from: a, to: b }; }));
  const valueHeaders = nameLine ? nameLine.cells.filter((c) => c.num || c.date).length : 0;
  const pivot = headers.length >= 2 || valueHeaders > 0 || names.filter((n, i, a) => n && a.indexOf(n) !== i).length > 0;
  const lead = kinds.map((k, i) => (k !== 'number' ? i : -1)).filter((i) => i >= 0 && i < kinds.indexOf('number'));
  const totalRows = grid.filter((r) => lead.some((i) => r[i] && TOTAL.test(r[i].text)) || (r[0] && TOTAL.test(r[0].text))).length;
  const grandTotal = grid.slice(-2).some((r) => r.some((c) => c && TOTAL.test(c.text)));   // the last row, or the one above a footer line
  const groups = pivot ? lead.map((i) => names[i] || `column ${i + 1}`) : lead.filter((i) => { const vals = grid.map((r) => r[i]); const filled = vals.filter(Boolean).length; return filled > 0 && filled < grid.length * 0.75; }).map((i) => names[i] || `column ${i + 1}`);
  return {
    title: titleLine ? titleLine.cells.map((c) => c.shown).join(' ') : '', filters,
    columns: merged.map((_, i) => ({ name: names[i], kind: kinds[i] })), headerLevels: headers.length, pivot, columnGroups: spans,
    rowGroups: groups, totalRows, grandTotal, dataRows: grid.length,
  };
}

export const TRUTH = [
  { id: 'ssrs_report-builder-expand-matrix', source: 'https://learn.microsoft.com/en-us/sql/reporting-services/media/report-builder-expand-matrix.png', terms: 'Microsoft Learn documentation, CC BY 4.0', kind: 'SSRS matrix (pivot)', columns: 14, numeric: 12, headerLevels: 3, pivot: true, rowGroups: ['Territory', 'Sales Date'], totalRows: 4, grandTotal: true, filters: 0, names: ['Territory', 'Sales Date', 'Sales', 'Quantity'] },
  { id: 'ssrs_ssrs-tutorial-basic-table-report', source: 'https://learn.microsoft.com/en-us/sql/reporting-services/media/ssrs-tutorial-basic-table-report.png', terms: 'Microsoft Learn documentation, CC BY 4.0', kind: 'SSRS grouped table', columns: 5, numeric: 2, headerLevels: 1, pivot: false, rowGroups: ['Sales Date', 'Subcategory'], totalRows: 8, grandTotal: true, filters: 0, names: ['Sales Date', 'Subcategory', 'Product', 'Quantity', 'Sales'], title: 'Product Sales' },
  { id: 'ssrs_param-view-report', source: 'https://learn.microsoft.com/en-us/sql/reporting-services/media/ssrb-parameter-tutorial-view-report.png', terms: 'Microsoft Learn documentation, CC BY 4.0', kind: 'SSRS parameter + matrix', columns: 3, numeric: 2, headerLevels: 1, pivot: true, rowGroups: ['Subcategory'], totalRows: 1, grandTotal: true, filters: 1, names: ['Subcategory', 'Total'] },
];

export function scoreTable(t, r) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const got = r.columns.map((c) => norm(c.name)).join(' | ');
  const checks = {
    columns: r.columns.length === t.columns, numericColumns: r.columns.filter((c) => c.kind === 'number').length === t.numeric,
    headerNames: t.names.filter((n) => got.includes(norm(n))).length >= Math.ceil(t.names.length * 0.75),
    headerLevels: r.headerLevels === t.headerLevels, pivot: r.pivot === t.pivot,
    rowGroups: t.rowGroups.length === r.rowGroups.length, totals: r.totalRows === t.totalRows, grandTotal: r.grandTotal === t.grandTotal,
    filters: r.filters.length === t.filters, ...(t.title ? { title: norm(r.title) === norm(t.title) } : {}),
  };
  return { ...checks, score: `${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const bench = process.argv[2]; const rows = [];
  for (const t of TRUTH) {
    const ocr = JSON.parse(await readFile(join(bench, 'run', t.id + '.ocr.json'), 'utf8'));
    const r = extractTable(ocr.words, [ocr.width, ocr.height]);
    const s = scoreTable(t, r);
    console.log(`\n=== ${t.kind}: ${s.score}`);
    console.log(`  title "${r.title}", filters ${JSON.stringify(r.filters)}, header levels ${r.headerLevels}, pivot ${r.pivot}, data rows ${r.dataRows}`);
    console.log(`  columns: ${r.columns.map((c) => `${c.name || '?'} (${c.kind})`).join(' | ')}`);
    console.log(`  column groups: ${r.columnGroups.map((l) => l.map((c) => `${c.text}[${c.from}-${c.to}]`).join(' ')).join(' / ')}`);
    console.log(`  row groups: ${r.rowGroups.join(', ') || '-'}, total rows ${r.totalRows}, grand total ${r.grandTotal}`);
    console.log(`  failed: ${Object.entries(s).filter(([k, v]) => v === false).map(([k]) => k).join(', ') || 'none'}`);
    rows.push({ report: t.kind, ...s });
  }
  console.table(rows.map((r) => ({ report: r.report, score: r.score })));
}
