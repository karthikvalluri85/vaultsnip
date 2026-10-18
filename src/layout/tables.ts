/**
 * Table and pivot structure from word positions, for dashboards' tables and for paginated reports (SSRS, Crystal
 * Reports, BusinessObjects): columns, header levels, pivot column groups, row groups, subtotal and grand-total rows,
 * and parameter prompts. Deterministic: it cannot invent text. Masked words reach it with no text, so a column of
 * masked numbers is recognised by its right alignment, and a masked label becomes a neutral name.
 */
import { median, medianHeight, type Box, type Word } from './image';
import { formatOf } from './charts';

const NUM = /^[(\-+]?[$€£¥₹]?\d[\d,.]*[%kKmMbB]?\)?$/;
const DATE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|q[1-4]|fy\d{2,4}|20\d\d)$/i;
const TOTAL = /^(grand\s+)?(sub)?totals?:?$/i;
const STAMP = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}(:\d{2})?|am|pm|page|of|\d+)$/i;
const BUTTON = /(view report|apply|run report|refresh)/i;
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
// two words of one date ("January 5," "2009", "12:00:00" "AM") are never split into columns
const datePart = (a: string, b: string) => (MONTH.test(a) && b === '') || (a === '' && /^\d{4}$/.test(b)) || (MONTH.test(a) && /^\d{1,2},?$/.test(b)) || (/^\d{1,2},$/.test(a) && /^\d{4}$/.test(b)) || (/^\d{1,2}:\d{2}/.test(a) && /^(am|pm)$/i.test(b));

interface Cell { x0: number; x1: number; words: Word[]; kept: boolean; text: string }
interface Line { yc: number; top: number; bottom: number; ws: Word[]; cells: Cell[] }

const shownText = (ws: Word[]) => (ws.every((w) => w.kept && w.text) ? ws.map((w) => w.text).join(' ') : '');

function lines(words: Word[], med: number): Line[] {
  const out: Line[] = [];
  // one line: words that overlap vertically by at least 40% (a header cell set a few pixels higher stays in its row)
  for (const w of [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const yc = w.y + w.h / 2;
    const l = out.find((l) => Math.min(l.bottom, w.y + w.h) - Math.max(l.top, w.y) >= Math.min(w.h, l.bottom - l.top, med * 1.5) * 0.4 && Math.abs(l.yc - yc) < med * 1.1);
    if (l) { l.ws.push(w); l.yc = (l.yc * (l.ws.length - 1) + yc) / l.ws.length; l.top = Math.min(l.top, w.y); l.bottom = Math.max(l.bottom, w.y + w.h); }
    else out.push({ yc, top: w.y, bottom: w.y + w.h, ws: [w], cells: [] });
  }
  for (const l of out) {
    l.ws.sort((a, b) => a.x - b.x);
    for (const w of l.ws) {
      const c = l.cells[l.cells.length - 1];
      if (c && w.x - c.x1 < med * 0.75) { c.words.push(w); c.x1 = w.x + w.w; } else l.cells.push({ x0: w.x, x1: w.x + w.w, words: [w], kept: true, text: '' });
    }
    for (const c of l.cells) { c.kept = c.words.every((w) => w.kept && w.text); c.text = shownText(c.words); }
  }
  return out.sort((a, b) => a.yc - b.yc);
}

export interface TableReading {
  title: string;
  parameters: { label: string; value: string }[];
  columns: { name: string; numeric: boolean; date: boolean; cells: string[] }[];
  headerLevels: number;
  columnGroups: { text: string; from: number; to: number }[][];
  pivot: boolean;
  rowGroups: number[];           // column indexes shown once per group
  totalRows: number;
  grandTotal: boolean;
  dataRows: number;
}

export function readTable(words: Word[], box: Box): TableReading | null {
  // single symbols (expand/collapse icons read as "©", "+", bullets) are not cells
  words = words.filter((w) => !(w.kept && w.text.length === 1 && !/[\p{L}\p{N}]/u.test(w.text)));
  const med = medianHeight(words), ls = lines(words, med);
  if (ls.length < 2) return null;
  const top = box[1] + (box[3] - box[1]) * 0.3;
  const lineText = (l: Line) => l.ws.map((w) => (w.kept ? w.text : '')).join(' ');
  // parameter / filter prompts: a visible label ending in "?" or ":", or a run button, near the top
  const isParam = (l: Line) => l.yc < top && (l.cells.some((c) => c.kept && /[?:]$/.test(c.text) && c.text.length > 2) || BUTTON.test(lineText(l)));
  const parameters = ls.filter(isParam).flatMap((l) => l.cells.filter((c) => c.kept && /[?:]$/.test(c.text) && c.text.length > 2).map((c) => ({ label: c.text.replace(/\s*[?:]$/, ''), value: '' })));
  const body = ls.filter((l) => !isParam(l));
  const titleLine = body.find((l, i) => i < 2 && l.ws.every((w) => w.h > med * 1.3) && l.cells.length <= 2);
  const rows = body.filter((l) => l !== titleLine);
  if (rows.length < 2) return null;

  // column ranges: x ranges covered by words in many rows
  const x0 = Math.floor(box[0]), W = Math.ceil(box[2]) - x0, cover = new Uint16Array(W + 2);
  for (const l of rows) for (const w of l.ws) for (let x = Math.max(0, Math.floor(w.x) - x0); x <= Math.min(W, Math.ceil(w.x + w.w) - x0); x++) cover[x]++;
  const need = Math.max(1, rows.length * 0.15);
  let cols: [number, number][] = [];
  for (let x = 0, s = -1; x <= W; x++) { const on = cover[x] >= need; if (on && s < 0) s = x; if ((!on || x === W) && s >= 0) { cols.push([s + x0, x + x0]); s = -1; } }
  const merged: [number, number][] = [];
  for (const c of cols) { const last = merged[merged.length - 1]; if (last && c[0] - last[1] < med * 0.6) last[1] = c[1]; else merged.push([...c]); }
  // touching columns (right-aligned numbers beside left-aligned text) are split where many rows share a small gap
  cols = merged.flatMap(([a, b]) => {
    const votes = new Map<number, number>(); let here = 0;
    for (const l of rows) {
      const ws = l.ws.filter((w) => w.x + w.w > a && w.x < b);
      if (ws.length < 2) continue; here++;
      for (let i = 1; i < ws.length; i++) {
        const g0 = ws[i - 1].x + ws[i - 1].w, g1 = ws[i].x;
        if (g1 - g0 >= 1.5 && !datePart(ws[i - 1].text, ws[i].text)) { const bin = Math.round((g0 + g1) / 8); votes.set(bin, (votes.get(bin) || 0) + 1); }
      }
    }
    const splits = [...votes.entries()].filter(([, n]) => here >= 4 && n >= here * 0.45).map(([bin]) => bin * 4).sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > med);
    if (!splits.length) return [[a, b] as [number, number]];
    const e = [a, ...splits, b]; return e.slice(1).map((v, i) => [e[i], v] as [number, number]);
  });
  if (cols.length < 1) return null;
  const colOf = (xa: number, xb: number) => { const xc = (xa + xb) / 2; let best = 0, d = Infinity; cols.forEach((c, i) => { const dd = xc < c[0] ? c[0] - xc : xc > c[1] ? xc - c[1] : 0; if (dd < d) { d = dd; best = i; } }); return best; };

  // which rows are data: a line whose cells fill at least two columns and is not all header words
  const grid = rows.map((l) => { const r: Word[][] = cols.map(() => []); l.ws.forEach((w) => r[colOf(w.x, w.x + w.w)].push(w)); return r; });
  const alignedRight = cols.map((_, i) => {
    const ends = grid.map((r) => r[i]).filter((ws) => ws.length).map((ws) => ws[ws.length - 1].x + ws[ws.length - 1].w);
    const starts = grid.map((r) => r[i]).filter((ws) => ws.length).map((ws) => ws[0].x);
    const spread = (xs: number[]) => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))); };
    return ends.length >= 3 && spread(ends) + 1 < spread(starts) * 0.6;
  });
  // masked cells are numbers when their column is right-aligned or a visible word in it names a measure (Sales, Qty, %…)
  const MEASURE = /^(sales|revenue|amount|quantity|qty|units|count|value|cost|price|profit|margin|budget|actual|target|variance|var|balance|tax|discount|orders|%|\$|€|£)$/i;
  const measureHeader = cols.map((_, i) => grid.some((r) => r[i].some((w) => w.kept && MEASURE.test(w.text.replace(/[():]/g, '')))));
  const isNumCell = (ws: Word[], i: number) => ws.length > 0 && ws.every((w) => (w.kept && w.text ? NUM.test(w.text) : alignedRight[i] || measureHeader[i]));
  // the first data row: has a number cell and no visible words naming a column (a header row with one masked word
  // must not pass for data just because the masked word sits right-aligned)
  const headerish = (r: Word[][]) => r.filter((ws, i) => ws.length && ws.every((w) => w.kept && w.text && !NUM.test(w.text) && !DATE.test(w.text)) && alignedRight[i]).length >= 2;
  // VaultSnip masks numbers by default, so when the table has masked cells a data row has one too; a fully visible
  // line above them (years or months over the columns) is a header
  const anyMasked = grid.some((r) => r.some((ws) => ws.some((w) => !w.kept)));
  // the row of column names: near the top, the line with the most visible words (at least three); data comes after it
  const keptWords = (r: Word[][]) => r.reduce((n, ws) => n + ws.filter((w) => w.kept && w.text && !NUM.test(w.text)).length, 0);
  let nameIdx = -1;
  grid.slice(0, Math.max(1, Math.ceil(grid.length * 0.5))).forEach((r, i) => { if (keptWords(r) >= 3 && (nameIdx < 0 || keptWords(r) > keptWords(grid[nameIdx]))) nameIdx = i; });
  const firstData = grid.findIndex((r, i) => i > nameIdx && !headerish(r) && (!anyMasked || r.some((ws) => ws.some((w) => !w.kept))) && r.filter((ws, i) => isNumCell(ws, i)).length >= 1 && r.filter((ws) => ws.length).length >= Math.min(2, cols.length));
  if (firstData < 0) return null;
  const headerLines = rows.slice(0, firstData).filter((l) => l.yc > rows[firstData].yc - med * 8);
  const dataGrid = grid.slice(firstData);
  while (dataGrid.length > 1 && dataGrid[dataGrid.length - 1].every((ws) => ws.every((w) => w.kept && STAMP.test(w.text)))) dataGrid.pop();

  // a column named for a dimension (Product, Customer…) holds names, even when its masked cells happen to line up right
  const DIMENSION = /\b(product|name|category|subcategory|customer|client|region|country|city|state|store|territory|department|description|item|account|vendor|supplier|employee|owner|segment|channel)\b/i;
  const headerOf = (i: number) => (headerLines.length ? headerLines[headerLines.length - 1].ws.filter((w) => colOf(w.x, w.x + w.w) === i).map((w) => w.text).join(' ') : '');
  const numeric = cols.map((_, i) => {
    const cs = dataGrid.map((r) => r[i]).filter((ws) => ws.length);
    if (DIMENSION.test(headerOf(i))) return cs.length > 0 && cs.filter((ws) => ws.every((w) => w.kept && NUM.test(w.text))).length > cs.length * 0.6;
    return cs.length > 0 && cs.filter((ws) => isNumCell(ws, i)).length > cs.length * 0.6;
  });
  const date = cols.map((_, i) => { const cs = dataGrid.map((r) => r[i]).filter((ws) => ws.length); return cs.filter((ws) => ws.some((w) => w.kept && DATE.test(w.text))).length > cs.length * 0.4; });
  const nameLine = headerLines[headerLines.length - 1];
  const nameWords = cols.map((c, i) => (nameLine ? nameLine.ws.filter((w) => colOf(w.x, w.x + w.w) === i) : []));
  const names = nameWords.map((ws) => (ws.length ? shownText(ws) || '' : ''));
  // header lines above the names are column groups; a wrapped header row (two text lines, side by side cells) is one level
  const levels: Line[] = [];
  for (const l of headerLines.slice(0, -1)) {
    const last = levels[levels.length - 1];
    const sideBySide = last && l.yc - last.yc < med * 1.6 && !l.cells.some((c) => last.cells.some((d) => Math.min(c.x1, d.x1) - Math.max(c.x0, d.x0) > 0));
    if (sideBySide) { last.cells = [...last.cells, ...l.cells].sort((a, b) => a.x0 - b.x0); last.ws = [...last.ws, ...l.ws]; } else levels.push({ ...l, cells: [...l.cells], ws: [...l.ws] });
  }
  const columnGroups = levels.map((l) => l.cells.map((c) => ({ text: c.text, from: colOf(c.x0, c.x0), to: colOf(c.x1, c.x1) })));
  const valueHeaders = nameLine ? nameLine.cells.filter((c) => c.kept && (NUM.test(c.text) || DATE.test(c.text))).length : 0;
  const repeated = names.filter((n, i, a) => n && a.indexOf(n) !== i).length > 0;
  const pivot = columnGroups.some((g) => g.some((c) => c.to > c.from)) || valueHeaders >= 2 || repeated;
  const firstNum = numeric.indexOf(true);
  const lead = cols.map((_, i) => i).filter((i) => !numeric[i] && (firstNum < 0 || i < firstNum));
  const isTotal = (r: Word[][]) => r.some((ws) => ws.length && TOTAL.test(shownText(ws)));
  const totalRows = dataGrid.filter(isTotal).length;
  const grandTotal = dataGrid.slice(-2).some(isTotal);
  // a lead column filled on only some rows shows its value once per group
  const rowGroups = lead.filter((i) => { const filled = dataGrid.filter((r) => !isTotal(r) && r[i].length).length, n = dataGrid.filter((r) => !isTotal(r)).length; return filled > 0 && filled < n * 0.75; });
  return {
    title: titleLine ? titleLine.cells.map((c) => c.text || '[Client]').join(' ') : '',
    parameters,
    columns: cols.map((_, i) => ({ name: names[i], numeric: numeric[i], date: date[i], cells: dataGrid.filter((r) => !isTotal(r)).map((r) => shownText(r[i])) })),
    headerLevels: levels.length + (nameLine ? 1 : 0), columnGroups, pivot, rowGroups, totalRows, grandTotal, dataRows: dataGrid.length,
  };
}

const PERSON = /\b(name|owner|manager|rep|agent|employee|customer name|contact|assignee|physician|doctor)\b/i;
const ORG = /\b(company|account|customer|client|vendor|supplier|partner|organi[sz]ation|payer|provider|hospital|store)\b/i;
const ID = /\b(id|number|no\.?|code|#|order|invoice|po)\b/i;

/** A table reading as a replica visual: a table (grouped or not) or a pivot. */
export function tableVisual(t: TableReading, title: string): Record<string, unknown> {
  const distinct = (xs: string[]) => [...new Set(xs.filter((x) => x && !TOTAL.test(x)))];
  const colName = (i: number) => t.columns[i].name || `Column ${i + 1}`;
  if (t.pivot) {
    const lead = t.columns.map((c, i) => i).filter((i) => !t.columns[i].numeric).slice(0, 2);
    const rowDims = lead.map((i) => {
      const m = distinct(t.columns[i].cells);
      const n = Math.max(2, Math.min(12, t.columns[i].cells.filter(Boolean).length || 3));
      return { name: colName(i), members: m.length ? m.slice(0, 12) : Array.from({ length: n }, (_, k) => `Item ${k + 1}`) };
    });
    const numCols = t.columns.map((c, i) => i).filter((i) => t.columns[i].numeric);
    const numNames = numCols.map((i) => t.columns[i].name).filter(Boolean);
    const uniq = distinct(numNames).filter((n) => !TOTAL.test(n));
    // measures repeat under each column group (Sales, Quantity, Sales, Quantity…); otherwise the headers are members
    const measuresRepeat = uniq.length >= 1 && uniq.length < numNames.length && uniq.length <= 4;
    const measures = (measuresRepeat ? uniq : [splitMeasure(title)]).map((n) => ({ name: n, ...formatOf(n) }));
    const colDims: { name: string; members: string[] }[] = [];
    const groupRows = t.columnGroups.filter((g) => g.some((c) => c.to > c.from || numCols.includes(c.from)));
    groupRows.slice(-2).forEach((g, gi) => {
      const ms = distinct(g.filter((c) => !TOTAL.test(c.text)).map((c, k) => c.text || `Group ${k + 1}`));
      if (ms.length) colDims.push({ name: `Column group ${gi + 1}`, members: ms.slice(0, 12) });
    });
    if (!measuresRepeat) {
      const ms = numNames.filter((n) => !TOTAL.test(n));
      if (ms.length) colDims.push({ name: 'Column', members: distinct(ms).slice(0, 12) });
    }
    return {
      type: 'pivot', rowDims: rowDims.length ? rowDims : [{ name: 'Row', members: ['Item 1', 'Item 2', 'Item 3'] }], colDims: colDims.slice(0, 2), measures,
      subtotals: t.totalRows > (t.grandTotal ? 1 : 0), grandTotal: t.grandTotal,
      totalColumn: t.columns.some((c) => TOTAL.test(c.name)),
    };
  }
  const columns = t.columns.slice(0, 10).map((c, i) => {
    const name = colName(i);
    if (c.numeric) { const f = formatOf(name); return { name, kind: f.format === 'currency' ? 'currency' : f.format === 'percent' ? 'percent' : 'number', ...(f.currency ? { currency: f.currency } : {}) }; }
    if (c.date) return { name, kind: 'date' };
    const visible = c.cells.filter(Boolean);
    if (visible.length >= c.cells.length * 0.7 && visible.length) return { name, kind: 'category', members: distinct(visible).slice(0, 25) };
    if (PERSON.test(name)) return { name, kind: 'person' };
    if (ORG.test(name)) return { name, kind: 'org' };
    if (ID.test(name)) return { name, kind: 'id' };
    return { name, kind: 'text' };
  });
  const groupBy = t.rowGroups.filter((i) => i < columns.length).map((i) => columns[i].name);
  return {
    type: 'table', columns, rowCount: Math.max(3, Math.min(25, t.dataRows - t.totalRows)),
    ...(groupBy.length ? { groupBy } : {}), ...(t.totalRows > (t.grandTotal ? 1 : 0) ? { subtotals: true } : {}), ...(t.grandTotal ? { grandTotal: true } : {}),
  };
}

function splitMeasure(title: string) {
  const m = /^(.+?)\s+(?:by|per)\s+/i.exec(title);
  return (m ? m[1] : title).trim() || 'Value';
}
