/**
 * Reads one panel: what kind of visual it is, and the relative sizes of its marks.
 *
 * No model and no lookup of values: the type comes from the geometry of the coloured marks (bars share a baseline,
 * slices fill a circle, lines are thin and long, dots are many and small, tiles fill a rectangle) and from the layout
 * of the words (a KPI is one big number with a short label, a table is words on a grid). Sizes are measured in pixels
 * and given as 0-100 shapes, the same form the AI path returns; the replica engine generates every value from them.
 * Labels come only from words that stayed visible; masked labels become "Item N".
 */
import { height, isBigBox, isMaskGrey, keyHex, labelStacks, rgbAt, width, wordCenter, type Box, type Img, type Word } from './image';
import { background, bySeries, findMarks, inkTest, isTextSpeck, sameColor, splitColumns, type Mark } from './marks';

export type ChartType = 'kpi' | 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'treemap' | 'map' | 'table' | 'text' | 'placeholder' | 'combo' | 'waterfall' | 'gauge' | 'funnel' | 'gantt' | 'heatmap';

export interface Reading {
  type: ChartType;
  /** 0-1: how clearly the evidence pointed to this type (an input for the confidence score). */
  certainty: number;
  /** Visual fields in the replica spec's shape (dimension, series, points…), without id, span or title. */
  fields: Record<string, unknown>;
  /** Main mark colour, for the page theme. */
  color?: string;
  /** A best guess where no reader could type the panel (not in the spec): no evidence against a report. */
  guess?: boolean;
  /** Columns only (not in the spec): each category's centre, the baseline and the bar series' colours. */
  at?: number[]; base?: number; keys?: number[];
}

const round = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const norm100 = (xs: number[]) => { const m = Math.max(...xs, 1e-9); return xs.map((x) => round((x / m) * 100)); };
const text = (ws: Word[]) => ws.filter((w) => w.kept && w.text).sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.text).join(' ').trim();

/** Words on one text line, left to right, as phrases split at wide gaps. */
/**
 * An axis row's words grouped into its labels by their spacing: labels on a category axis are evenly spaced, so word
 * centres much closer than the usual step belong to one label (a two-word label; a slanted label read in pieces; a label
 * half masked), whatever their heights. Grouped as phrases, a row of slanted labels, each at its own height, fell apart
 * into lines of one or two.
 */
function stepGroups(ws: Word[], med: number): { ws: Word[]; x0: number; x1: number; yc: number }[] {
  const sorted = [...ws].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2)), cx = (w: Word) => w.x + w.w / 2;
  const d = sorted.slice(1).map((w, i) => cx(w) - cx(sorted[i])).filter((x) => x > med);
  if (d.length < 2) return [];
  const step = [...d].sort((a, b) => a - b)[d.length >> 1];
  const groups: Word[][] = [];
  for (const w of sorted) { const g = groups[groups.length - 1]; if (g && cx(w) - cx(g[g.length - 1]) < step * 0.5) g.push(w); else groups.push([w]); }
  return groups.map((g) => ({ ws: g, x0: Math.min(...g.map((w) => w.x)), x1: Math.max(...g.map((w) => w.x + w.w)), yc: g.reduce((a, w) => a + w.y + w.h / 2, 0) / g.length }));
}

function phrases(ws: Word[], med: number) {
  const lines: { yc: number; ws: Word[] }[] = [];
  for (const w of [...ws].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const yc = w.y + w.h / 2, l = lines.find((l) => Math.abs(l.yc - yc) < med * 0.55);
    if (l) l.ws.push(w); else lines.push({ yc, ws: [w] });
  }
  const out: { ws: Word[]; x0: number; x1: number; yc: number }[] = [];
  for (const l of lines) {
    l.ws.sort((a, b) => a.x - b.x);
    let cur: Word[] = [];
    for (const w of l.ws) {
      const last = cur[cur.length - 1];
      if (last && w.x - (last.x + last.w) > med * 1.2) { out.push({ ws: cur, x0: cur[0].x, x1: last.x + last.w, yc: l.yc }); cur = []; }
      cur.push(w);
    }
    if (cur.length) out.push({ ws: cur, x0: cur[0].x, x1: cur[cur.length - 1].x + cur[cur.length - 1].w, yc: l.yc });
  }
  return out;
}

/** Words laid out on a grid: at least 4 lines with 2+ cells and 2+ columns whose starts or ends line up. */
export function looksLikeTable(ws: Word[], med: number) {
  if (ws.length < 10) return false;
  const lines: { y: number; ws: Word[] }[] = [];
  for (const w of [...ws].sort((a, b) => a.y - b.y)) { const l = lines.find((l) => Math.abs(l.y - w.y) < med * 0.6); if (l) l.ws.push(w); else lines.push({ y: w.y, ws: [w] }); }
  const multi = lines.filter((l) => l.ws.length >= 2);
  if (multi.length < 4) return false;
  const aligned = (pos: (w: Word) => number) => {
    const counts = new Map<number, number>();
    multi.forEach((l) => new Set(l.ws.map((w) => Math.round(pos(w) / (med * 2)))).forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
    return [...counts.values()].filter((n) => n >= Math.max(3, multi.length * 0.6)).length;
  };
  return Math.max(aligned((w) => w.x), aligned((w) => w.x + w.w)) + Math.min(aligned((w) => w.x), aligned((w) => w.x + w.w)) >= 2;
}

/** Legend swatches: small solid squares or circles with a label just to their right. */
function legend(marks: Mark[], words: Word[], med: number) {
  const out: { key: number; name: string; mark: Mark }[] = [];
  for (const m of marks) {
    const w = width(m.b), h = height(m.b);
    if (w > med * 1.6 || h > med * 1.6 || w < 3 || h < 3 || Math.abs(w - h) > Math.max(3, med * 0.35) || m.fill < 0.6) continue;
    const right = words.filter((x) => Math.abs(x.y + x.h / 2 - m.cy) < med * 0.7 && x.x >= m.b[2] - 1 && x.x - m.b[2] < med * 1.6);
    if (!right.length) continue;
    // the label: words after the swatch until a wide gap
    const line = words.filter((x) => Math.abs(x.y + x.h / 2 - m.cy) < med * 0.7 && x.x >= m.b[2] - 1).sort((a, b) => a.x - b.x);
    const label: Word[] = [];
    for (const x of line) { const last = label[label.length - 1]; if (last && x.x - (last.x + last.w) > med * 1.1) break; label.push(x); }
    out.push({ key: m.key, name: label.every((x) => x.kept && x.text) ? label.map((x) => x.text).join(' ') : '', mark: m });
  }
  return out;
}

/** Most frequent value within a tolerance, and how many share it. */
function mode(xs: number[], tol: number) {
  let best = 0, at = 0;
  for (const x of xs) { const n = xs.filter((y) => Math.abs(y - x) <= tol).length; if (n > best) { best = n; at = x; } }
  return { at, n: best };
}

/** Splits marks into categories along one axis: overlapping marks (stacks) share one; wide gaps separate groups. */
function categories(rs: Mark[], lo: (m: Mark) => number, hi: (m: Mark) => number, grouped: boolean) {
  const sorted = [...rs].sort((a, b) => lo(a) - lo(b));
  const clusters: { ms: Mark[]; lo: number; hi: number }[] = [];
  for (const m of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && lo(m) < c.hi - Math.min(hi(m) - lo(m), c.hi - c.lo) * 0.4) { c.ms.push(m); c.hi = Math.max(c.hi, hi(m)); } else clusters.push({ ms: [m], lo: lo(m), hi: hi(m) });
  }
  if (!grouped || clusters.length < 4) return clusters;
  // grouped bars: bars of one category sit close; categories are separated by the wider gaps
  const gaps = clusters.slice(1).map((c, i) => c.lo - clusters[i].hi);
  // (the line between "within a category" and "between categories" splits the gaps into the two most distinct groups,
  // as Otsu's threshold does: halfway between the smallest and largest gap, one unusually wide gap, where a mask hides a
  // column, merged every category)
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  if (sortedGaps[sortedGaps.length - 1] - sortedGaps[0] < 3) return clusters;
  const total = sortedGaps.reduce((a, g) => a + g, 0);
  let best = -1, split = sortedGaps[sortedGaps.length - 1], below = 0;
  for (let i = 1; i < sortedGaps.length; i++) {
    below += sortedGaps[i - 1];
    if (sortedGaps[i] === sortedGaps[i - 1]) continue;
    const n0 = i, n1 = sortedGaps.length - i, m0 = below / n0, m1 = (total - below) / n1, between = n0 * n1 * (m1 - m0) ** 2;
    if (between > best) { best = between; split = (sortedGaps[i] + sortedGaps[i - 1]) / 2; }
  }
  const merged: typeof clusters = [{ ...clusters[0], ms: [...clusters[0].ms] }];
  gaps.forEach((g, i) => { const c = clusters[i + 1]; if (g < split) { const m = merged[merged.length - 1]; m.ms.push(...c.ms); m.hi = c.hi; } else merged.push({ ...c, ms: [...c.ms] }); });
  return merged;
}

/** "Revenue by Region" → measure "Revenue", dimension "Region". */
export function splitTitle(title: string) {
  const m = /^(.+?)\s+(?:by|per|across|over)\s+(.+)$/i.exec(title.trim());
  return m ? { measure: m[1].trim(), dimension: m[2].trim() } : { measure: title.trim(), dimension: '' };
}

/** Number format a measure name suggests. Only visible label words are used; masked values never are. */
export function formatOf(name: string): { format: string; currency?: string } {
  const s = name.toLowerCase();
  if (/%|percent|rate\b|ratio|share|margin|growth|conversion|churn|bounce|utili[sz]ation|attainment|yoy|var.*%/.test(s)) return { format: 'percent' };
  if (/€/.test(s)) return { format: 'currency', currency: '€' };
  if (/£/.test(s)) return { format: 'currency', currency: '£' };
  if (/₹/.test(s)) return { format: 'currency', currency: '₹' };
  if (/\$|revenue|sales|cost|spend|profit|amount|price|budget|income|invoice|expense|payment|value|arr\b|mrr\b|savings|discount\b|salary|billing/.test(s)) return { format: 'currency', currency: '$' };
  if (/count|number|#|qty|quantity|units|headcount|employees|orders|visits|users|sessions|tickets|patients|hires/.test(s)) return { format: 'integer' };
  return { format: 'number' };
}

/** Plot area: the panel without its title band. */
function plotBox(b: Box, words: Word[], med: number): Box {
  const top = words.filter((w) => w.y < b[1] + height(b) * 0.25).reduce((y, w) => Math.max(y, w.y + w.h), b[1]);
  return [b[0], Math.min(top + 2, b[1] + height(b) * 0.3), b[2], b[3]];
}

/** Members along an axis: visible words just outside the plot, one per category; masked or missing → Item N. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (s: string) => {
  const m = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i.exec(s);
  return m ? MONTH_NAMES.findIndex((n) => n.toLowerCase() === m[1].toLowerCase()) : -1;
};
/**
 * An axis of months in order: when at least half its labels (and at least three) read as months that follow one
 * another, the sequence is certain, and every label takes its month: one the reader misread ("Max" for Mar) or that was
 * covered as unread text is the month its neighbours imply. Months are not sensitive; nothing is copied from a mask.
 */
export function monthsInOrder(members: string[]): string[] {
  const at = members.map(monthOf);
  const votes = new Map<number, number>();
  at.forEach((m, i) => { if (m >= 0) { const start = (m - i + 1200) % 12; votes.set(start, (votes.get(start) || 0) + 1); } });
  const [start, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0];
  if (n < 3 || n < members.length / 2) return members;
  return members.map((_, i) => MONTH_NAMES[(start + i) % 12]);
}

function axisLabels(words: Word[], cats: { lo: number; hi: number }[], along: 'x' | 'y', band: [number, number], med: number) {
  const ws = words.filter((w) => { const [cx, cy] = wordCenter(w); const v = along === 'x' ? cy : cx; return v >= band[0] && v <= band[1]; });
  return monthsInOrder(cats.map((c, i) => {
    const pad = Math.max(med * 0.6, (c.hi - c.lo) * 0.25);
    const here = ws.filter((w) => { const [cx, cy] = wordCenter(w); const v = along === 'x' ? cx : cy; return v >= c.lo - pad && v <= c.hi + pad; });
    const t = here.length && here.every((w) => w.kept && w.text) ? text(here) : '';
    return t || `Item ${i + 1}`;
  }));
}

interface Ctx {
  img: Img; b: Box; words: Word[]; med: number; title: string;
  ink: (x: number, y: number) => boolean;
  body: Mark[]; rects: Mark[]; thin: Mark[]; markArea: number; coverage: number;
  /** Every mark, small ones included, but not legend swatches (the dashes of a reference line are small). */
  all: Mark[];
  nameOf: (key: number) => string; measure: { name: string; format: string; currency?: string }; dName: string; plot: Box;
}

const keyAt = (img: Img, x: number, y: number) => { const [r, g, b] = rgbAt(img, x, y); return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); };
const cv = (xs: number[]) => { const mu = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length); return mu ? Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / xs.length) / mu : 0; };
const hull = (ms: Mark[]): Box => [Math.min(...ms.map((m) => m.b[0])), Math.min(...ms.map((m) => m.b[1])), Math.max(...ms.map((m) => m.b[2])), Math.max(...ms.map((m) => m.b[3]))];

/** Pie or donut: the big marks together fill a circle; slice shares are read around a ring. */
function pie(c: Ctx): Reading | null {
  // (a legend's swatches are small solid squares: they are not slices, and would stretch the outline)
  const largest = Math.max(0, ...c.body.map((m) => m.n));
  const swatch = (m: Mark) => m.fill > 0.9 && m.n < largest * 0.15 && width(m.b) / height(m.b) > 0.7 && width(m.b) / height(m.b) < 1.4;
  // (nor are rules and dividers, a few pixels thick)
  const big = c.body.filter((m) => m.n >= c.markArea * 0.02 && m.fill > 0.25 && !swatch(m) && Math.min(width(m.b), height(m.b)) > 3);
  if (!big.length) return null;
  const u = hull(big), uw = width(u), uh = height(u), r = Math.max(uw, uh) / 2;
  // a pie is round, unless the screenshot or the panel cuts it: then its short side lies on the panel's edge
  const cut = (uw > uh ? Math.min(u[1] - c.b[1], c.b[3] - u[3]) : Math.min(u[0] - c.b[0], c.b[2] - u[2])) <= 3;
  const ratio = uw / uh;
  if (!(ratio >= 0.8 && ratio <= 1.25) && !(cut && ratio >= 0.45 && ratio <= 2.2)) return null;
  if (r < Math.min(width(c.b), height(c.b)) * 0.12) return null;
  // the circle: a mask over a slice's label can hide an edge of the pie, so the hull may be short on one side; the
  // radius comes from its longer side, and the centre is tried at either end of the shorter side as well as its middle
  const centres = (lo: number, hi: number) => (hi - lo < 2 * r - 2 ? [(lo + hi) / 2, lo + r, hi - r] : [(lo + hi) / 2]);
  const fit = (cx: number, cy: number) => {
    let ring = 0, ringN = 0, corner = 0, cornerN = 0, mid = 0, midN = 0;
    for (let y = Math.floor(cy - r); y < cy + r; y += 2) for (let x = Math.floor(cx - r); x < cx + r; x += 2) {
      if (x < c.b[0] || y < c.b[1] || x >= c.b[2] || y >= c.b[3]) continue;   // only what the panel shows
      const d = Math.hypot(x - cx, y - cy) / r, on = c.ink(x, y) ? 1 : 0;
      if (d > 0.7 && d < 0.92) { ring += on; ringN++; } else if (d > 1.1) { corner += on; cornerN++; } else if (d < 0.35) { mid += on; midN++; }
    }
    return { cx, cy, ringF: ring / Math.max(1, ringN), cornerF: corner / Math.max(1, cornerN), midF: mid / Math.max(1, midN) };
  };
  const { cx, cy, ringF, cornerF, midF } = centres(u[0], u[2]).flatMap((x) => centres(u[1], u[3]).map((y) => fit(x, y)))
    .reduce((a, b) => (b.ringF - b.cornerF > a.ringF - a.cornerF ? b : a));
  if (ringF < 0.8 || cornerF > 0.2) return null;
  const donut = midF < 0.3, rr = r * (donut ? 0.81 : 0.6);
  const runs: { key: number; n: number }[] = [];
  for (let a = 0; a < 360; a++) {
    const x = Math.round(cx + rr * Math.sin((a * Math.PI) / 180)), y = Math.round(cy - rr * Math.cos((a * Math.PI) / 180));
    if (!c.ink(x, y)) continue;
    const k = keyAt(c.img, x, y), last = runs[runs.length - 1];
    if (last && sameColor(last.key, k)) last.n++; else runs.push({ key: k, n: 1 });
  }
  if (runs.length > 1 && sameColor(runs[0].key, runs[runs.length - 1].key)) runs[0].n += runs.pop()!.n;
  // a label printed inside a slice ("33.9%" in dark text) cuts it into two runs with a short run of the text's colour
  // between them: a short run between two runs of one colour is part of that slice
  for (let i = 0; runs.length > 2 && i < runs.length; i++) {
    const prev = runs[(i - 1 + runs.length) % runs.length], next = runs[(i + 1) % runs.length];
    if (runs[i].n < 18 && prev !== next && sameColor(prev.key, next.key)) {
      prev.n += runs[i].n + next.n;
      const j = runs.indexOf(next);
      runs.splice(Math.max(i, j), 1); runs.splice(Math.min(i, j), 1);
      i = -1;
    }
  }
  const slices = runs.filter((s) => s.n >= 3);
  if (!slices.length) return null;
  const members = slices.map((s, i) => c.nameOf(s.key) || `Item ${i + 1}`);
  return { type: donut ? 'donut' : 'pie', certainty: Math.min(1, (ringF - cornerF) * 1.1),
    fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series: [{ name: c.measure.name, shape: norm100(slices.map((s) => s.n)) }] } };
}

/** Columns or bars: solid rectangles of one thickness sharing a baseline. */
/** A reference line across a chart, in the series' 0-100 shape units, with the words that name it. */
export interface RefLine { name: string; shape: number; dashed?: boolean }
const satOf = (k: number) => { const r = (k >> 8) & 15, g = (k >> 4) & 15, b = k & 15; return Math.max(r, g, b) - Math.min(r, g, b); };

/**
 * Reference lines (a target, an average, a threshold): straight lines at one value across most of the plot, drawn over
 * or behind the series. Along a column or line chart they run across (dir 'h'); along a bar chart, up and down ('v').
 * What makes one, and not a gridline, an axis or a row of text:
 * - it lies inside the value range (`range`, between the baseline and the plot's far edge), not on or past the baseline,
 *   where axis lines and category labels are;
 * - it stands out from the panel's background (gridlines are faint);
 * - it is one unbroken rule in a colour that is not a series' (a few pieces at most, where it crosses words or bars),
 *   or evenly spaced dashes, found pixel row by pixel row because a dash can be a few pixels, below what counts as a
 *   mark (a series line crossing the dashes leaves a few odd gaps);
 * - it is alone in its colour: three or more such rows of one colour are gridlines, solid or dashed.
 * At most two. `span` is the extent the series cover along the line, and `toShape` maps a position on the value axis to
 * the series' 0-100 shape units.
 */
function refLines(c: Ctx, dir: 'h' | 'v', span: [number, number], range: [number, number], toShape: (p: number) => number, seriesKeys: number[] = []): RefLine[] {
  const len = (m: Mark) => (dir === 'h' ? width(m.b) : height(m.b)), thick = (m: Mark) => (dir === 'h' ? height(m.b) : width(m.b));
  const pos = (m: Mark) => (dir === 'h' ? (m.b[1] + m.b[3]) / 2 : (m.b[0] + m.b[2]) / 2);
  const lo = (m: Mark) => (dir === 'h' ? m.b[0] : m.b[1]), hi = (m: Mark) => (dir === 'h' ? m.b[2] : m.b[3]);
  const maxThick = Math.max(3, Math.round(c.med * 0.3));
  const [r0, r1] = [Math.min(...range), Math.max(...range)];
  const inRange = (q: number) => q > r0 && q < r1;
  // (long in itself too: half of a chart read as a single bar is a few pixels)
  const extent = Math.max(1, span[1] - span[0]), minLen = Math.max(extent * 0.5, c.med * 6);
  // (contrast: from the panel's background, by luminance; a coloured line may be a little paler than a grey one)
  const [br, bgG, bb] = background(c.img, c.b), bgLum = 0.3 * br + 0.59 * bgG + 0.11 * bb;
  const lumOf = (k: number) => 0.3 * ((k >> 8) & 15) * 17 + 0.59 * ((k >> 4) & 15) * 17 + 0.11 * (k & 15) * 17;
  const stands = (k: number) => Math.abs(lumOf(k) - bgLum) >= (satOf(k) >= 3 ? 35 : 70);
  type Row = { key: number; at: number; a: number; z: number; dashed: boolean };
  const found: Row[] = [];

  // solid rules: marks a few pixels thick, long, in one or a few pieces covering their length
  const series = (x: number, y: number) => x >= 0 && y >= 0 && x < c.img.width && y < c.img.height && seriesKeys.some((k) => sameColor(k, keyAt(c.img, x, y)));
  const pieces = c.all.filter((m) => thick(m) <= maxThick && len(m) >= 3 && len(m) >= thick(m) * 2 && hi(m) > span[0] && lo(m) < span[1] && inRange(pos(m)));
  const groups: { key: number; at: number; ms: Mark[] }[] = [];
  for (const m of pieces.sort((p, q) => lo(p) - lo(q))) {
    const g = groups.find((g) => sameColor(g.key, m.key) && Math.abs(g.at - pos(m)) <= 2);
    if (g) g.ms.push(m); else groups.push({ key: m.key, at: pos(m), ms: [m] });
  }
  for (const g of groups) {
    const a = Math.min(...g.ms.map(lo)), z = Math.max(...g.ms.map(hi)), cover = g.ms.reduce((s, m) => s + len(m), 0) / Math.max(1, z - a);
    // (never in a series' own colour: a zigzag line's peaks at one height look like dashes)
    if (z - a < minLen || seriesKeys.some((k) => sameColor(k, g.key))) continue;
    // (solid: a few pieces covering the length, where antialiased edges or words break it; dashed: evenly spaced dashes
    // large enough to be marks, such as dashes drawn over bars, which the pixel scan below cannot tell from the bars)
    const ms = [...g.ms].sort((p, q) => lo(p) - lo(q)), gaps = ms.slice(1).map((m, j) => lo(m) - hi(ms[j])).filter((x) => x > 0);
    const usual = [...gaps].sort((p, q) => p - q)[gaps.length >> 1];
    const even = gaps.length >= 4 && gaps.filter((x) => Math.abs(x - usual) <= Math.max(3, usual * 0.5)).length >= gaps.length * 0.7;
    if (g.ms.length <= 8 && cover >= 0.9) found.push({ key: g.key, at: g.at, a, z, dashed: false });
    else if (g.ms.length >= 5 && even && cover >= 0.25 && cover < 0.9 && usual <= Math.max(10, c.med)) found.push({ key: g.key, at: g.at, a, z, dashed: true });
  }

  // dashes: each pixel row (or column) inside the value range, outside words, as runs of ink
  const [bx0, by0] = [Math.max(0, Math.floor(c.b[0])), Math.max(0, Math.floor(c.b[1]))];
  const bw = Math.min(c.img.width, Math.ceil(c.b[2])) - bx0, bh = Math.min(c.img.height, Math.ceil(c.b[3])) - by0;
  const wordAt = new Uint8Array(Math.max(0, bw * bh));
  for (const w of c.words) for (let y = Math.max(0, Math.floor(w.y - by0) - 1); y < Math.min(bh, Math.ceil(w.y + w.h - by0) + 1); y++)
    for (let x = Math.max(0, Math.floor(w.x - bx0) - 1); x < Math.min(bw, Math.ceil(w.x + w.w - bx0) + 1); x++) wordAt[y * bw + x] = 1;
  const xy = (u: number, v: number): [number, number] => (dir === 'h' ? [u, v] : [v, u]);
  // (a series' own colour is not a dash: where dashes cross bars, the bars between them would join the runs; nor is a
  // pixel next to it, the antialiased edge of a series line, which a zigzag line leaves at one height again and again)
  const on = (u: number, v: number) => {
    const [x, y] = xy(u, v);
    if (x < bx0 || y < by0 || x >= bx0 + bw || y >= by0 + bh || wordAt[(y - by0) * bw + (x - bx0)] || !c.ink(x, y) || series(x, y)) return false;
    return !(series(x + 1, y) || series(x - 1, y) || series(x, y + 1) || series(x, y - 1));
  };
  const dashRows: (Row & { runs: number })[] = [];
  for (let v = Math.ceil(r0) + 1; v < r1; v++) {
    const runs: [number, number][] = [];
    for (let u = Math.max(0, Math.floor(span[0])), s = -1; u <= Math.ceil(span[1]); u++) {
      const ink = u < Math.ceil(span[1]) && on(u, v);
      if (ink && s < 0) s = u;
      if (!ink && s >= 0) { runs.push([s, u]); s = -1; }
    }
    if (runs.length < 8) continue;
    // (a dash has clear space on both sides of the line, just past its thickness; the tips of a zigzag line's peaks, at
    // one height and evenly spaced, have the line itself on one side)
    const off = maxThick + 1, clear = (u: number, d: number) => { const [x, y] = xy(u, v + d); return !c.ink(x, y); };
    if (runs.filter(([s, e]) => { const u = Math.floor((s + e) / 2); return clear(u, -off) && clear(u, off); }).length < runs.length * 0.6) continue;
    const lens = runs.map(([s, e]) => e - s), gaps = runs.slice(1).map(([s], j) => s - runs[j][1]);
    const mid = (xs: number[]) => [...xs].sort((p, q) => p - q)[xs.length >> 1];
    const ml = mid(lens), mg = mid(gaps);
    // (dashes are short and close together: a series line crossing a row of pixels leaves runs far apart)
    if (ml < 2 || ml > Math.max(14, c.med * 1.2) || mg < 2 || mg > Math.max(10, c.med)) continue;
    if (gaps.filter((g) => Math.abs(g - mg) <= Math.max(2, mg * 0.5)).length < gaps.length * 0.7) continue;
    if (lens.filter((l) => Math.abs(l - ml) <= Math.max(2, ml * 0.5)).length < lens.length * 0.7) continue;
    const a = runs[0][0], z = runs[runs.length - 1][1], cover = lens.reduce((s, l) => s + l, 0) / Math.max(1, z - a);
    if (z - a < minLen || cover < 0.2 || cover > 0.85) continue;
    // the dashes' colour: the commonest among their middles
    const keys = runs.map(([s, e]) => { const [x, y] = xy(Math.floor((s + e) / 2), v); return keyAt(c.img, x, y); });
    const count = (k: number) => keys.filter((o) => sameColor(o, k)).length;
    const key = keys.reduce((best, k) => (count(k) > count(best) ? k : best), keys[0]);
    // (one line drawn over two or three pixel rows: the row with the most dashes stands for it)
    const prev = dashRows[dashRows.length - 1];
    if (prev && v - prev.at <= 2 && sameColor(prev.key, key)) { if (runs.length > prev.runs) Object.assign(prev, { at: v, a, z, runs: runs.length }); continue; }
    dashRows.push({ key, at: v, a, z, dashed: true, runs: runs.length });
  }
  // (the same dashes found as marks and by the scan count once)
  found.push(...dashRows.filter((r) => !found.some((o) => o.dashed && sameColor(o.key, r.key) && Math.abs(o.at - r.at) <= 3)));
  const lines = found.filter((r) => stands(r.key) && found.filter((o) => sameColor(o.key, r.key) && o.dashed === r.dashed).length < 3);
  // (above the tallest series value, a stack's total for instance, the shape passes 100)
  return lines.slice(0, 2).map((r) => ({ name: refName(c, dir, r.at, r.a, r.z, inRange) || 'Target', shape: Math.max(0, Math.min(400, Math.round(toShape(r.at)))), ...(r.dashed ? { dashed: true } : {}) }));
}

/** A reference line's name: readable words beside it (on the plot side of the baseline, near the line), without numbers. */
function refName(c: Ctx, dir: 'h' | 'v', at: number, a: number, z: number, inRange: (q: number) => boolean) {
  const near = c.words.filter((w) => w.kept && w.text && /[a-z]/i.test(w.text) && (dir === 'h'
    ? Math.abs(w.y + w.h / 2 - at) <= c.med * 1.6 && inRange(w.y + w.h / 2) && w.x + w.w >= a - c.med * 6 && w.x <= z + c.med * 6
    : Math.abs(w.x + w.w / 2 - at) <= c.med * 4 && inRange(w.x + w.w / 2) && (w.y + w.h <= a + c.med * 2 || w.y >= z - c.med * 2)));
  return near.sort((p, q) => p.x - q.x).slice(0, 3).map((w) => w.text.replace(/[\d.,%$€£:]+/g, '').trim()).filter(Boolean).join(' ');
}

function bars(c: Ctx): Reading | null {
  // (a solid reference line is a long rule a few pixels thick, not a bar)
  // (across most of the panel; one or two of them: many thin tall marks are a dense column chart's columns)
  const thinLong = (m: Mark) => Math.min(width(m.b), height(m.b)) <= Math.max(3, Math.round(c.med * 0.3)) && Math.max(width(m.b), height(m.b)) >= Math.min(width(m.b), height(m.b)) * 15
    && (width(m.b) >= height(m.b) ? width(m.b) >= width(c.b) * 0.4 : height(m.b) >= height(c.b) * 0.4);
  const rules = c.rects.filter(thinLong);
  const rule = (m: Mark) => rules.length <= 2 && rules.includes(m);
  // (a line drawn over the bars cuts each one it crosses in two: pieces of one colour, one above the other with the same
  // sides, a rule's thickness apart, are one bar again; likewise side by side for horizontal bars)
  const gap = Math.max(3, Math.round(c.med * 0.3)) + 2;
  const joined: Mark[] = [];
  // (only across a line: the gap's middle is ink of another colour, and so is the gap's line just past the bar's side;
  // neighbouring bars have background between, and dense columns' separators stop where the columns do)
  const lineAt = (x: number, y: number, key: number) => c.ink(Math.round(x), Math.round(y)) && !sameColor(keyAt(c.img, Math.round(x), Math.round(y)), key);
  for (const m of c.rects.filter((m) => m.n >= 20 && !rule(m)).sort((p, q) => p.b[1] - q.b[1] || p.b[0] - q.b[0])) {
    const o = joined.find((o) => sameColor(o.key, m.key) && (
      (Math.abs(o.b[0] - m.b[0]) <= 1 && Math.abs(o.b[2] - m.b[2]) <= 1 && m.b[1] - o.b[3] >= 0 && m.b[1] - o.b[3] <= gap && lineAt((m.b[0] + m.b[2]) / 2, (o.b[3] + m.b[1]) / 2, m.key) && (lineAt(m.b[0] - 3, (o.b[3] + m.b[1]) / 2, m.key) || lineAt(m.b[2] + 2, (o.b[3] + m.b[1]) / 2, m.key)))
      || (Math.abs(o.b[1] - m.b[1]) <= 1 && Math.abs(o.b[3] - m.b[3]) <= 1 && m.b[0] - o.b[2] >= 0 && m.b[0] - o.b[2] <= gap && lineAt((o.b[2] + m.b[0]) / 2, (m.b[1] + m.b[3]) / 2, m.key) && (lineAt((o.b[2] + m.b[0]) / 2, m.b[1] - 3, m.key) || lineAt((o.b[2] + m.b[0]) / 2, m.b[3] + 2, m.key)))));
    if (!o) { joined.push({ ...m }); continue; }
    const u: Box = [Math.min(o.b[0], m.b[0]), Math.min(o.b[1], m.b[1]), Math.max(o.b[2], m.b[2]), Math.max(o.b[3], m.b[3])];
    Object.assign(o, { b: u, n: o.n + m.n, fill: Math.min(1, (o.n + m.n) / (width(u) * height(u))), cx: (u[0] + u[2]) / 2, cy: (u[1] + u[3]) / 2 });
  }
  const rs = joined;
  if (rs.length < 2) return null;
  // the shared baseline: a bar sits on it when it starts there, or when everything between the baseline and its visible
  // start is mask grey (a mask over a category label can cover a bar's first pixels; it hides the bar, it does not end it)
  const grey = (x: number, y: number) => x >= 0 && y >= 0 && x < c.img.width && y < c.img.height && isMaskGrey(...rgbAt(c.img, x, y));
  const hiddenX = (m: Mark, at: number) => { const y = Math.round((m.b[1] + m.b[3]) / 2); for (let x = Math.round(at); x < m.b[0]; x++) if (!grey(x, y)) return false; return true; };
  const hiddenY = (m: Mark, at: number) => { const x = Math.round((m.b[0] + m.b[2]) / 2); for (let y = m.b[3]; y < Math.round(at); y++) if (!grey(x, y)) return false; return true; };
  // (a tolerance in proportion to the bars' thickness: an axis line or antialiasing can take a few pixels off a bar's start)
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const tolX = Math.max(3, med(rs.map((m) => height(m.b))) * 0.3), tolY = Math.max(3, med(rs.map((m) => width(m.b))) * 0.3);
  const atLeft = (m: Mark, at: number) => Math.abs(m.b[0] - at) <= tolX || (m.b[0] > at && hiddenX(m, at));
  const atBottom = (m: Mark, at: number) => Math.abs(m.b[3] - at) <= tolY || (m.b[3] < at && hiddenY(m, at));
  const baseline = (cands: number[], on: (m: Mark, at: number) => boolean) => cands.reduce((best, at) => {
    const n = rs.filter((m) => on(m, at)).length;
    return n > best.n ? { at, n } : best;
  }, { at: 0, n: 0 });
  const bottom = baseline(rs.map((m) => m.b[3]), atBottom), left = baseline(rs.map((m) => m.b[0]), atLeft);
  // (in stacked columns most segments stand on another segment, not on the baseline: they count as standing)
  const stackedOn = (m: Mark) => rs.some((o) => o !== m && Math.abs(o.b[1] - m.b[3]) <= 2 && Math.min(o.b[2], m.b[2]) - Math.max(o.b[0], m.b[0]) >= width(m.b) * 0.6);
  const standing = rs.filter((m) => atBottom(m, bottom.at) || stackedOn(m)).length;
  const vert = bottom.n >= 2 && standing >= rs.length * 0.5 && cv(rs.map((m) => width(m.b))) < 0.35;
  // (in a horizontal bar chart every bar spans one row height — a mark that is many times larger or smaller than the
  //  typical bar is a chart background, legend icon or other decoration, not a bar; use the median to find the
  //  representative height and exclude anything outside ½× to 2.5× that value)
  const hHeights = rs.map((m) => height(m.b));
  const medBarH = [...hHeights].sort((a, b) => a - b)[hHeights.length >> 1];
  const horizRs = rs.filter((m) => height(m.b) >= medBarH * 0.5 && height(m.b) <= medBarH * 2.5);
  const horiz = left.n >= Math.max(2, rs.length * 0.5) && horizRs.length >= 2 && cv(horizRs.map((m) => height(m.b))) < 0.35;
  if (!vert && !horiz) return null;
  const isCol = vert && (!horiz || bottom.n > left.n || (bottom.n === left.n && height(hull(rs)) >= width(hull(rs))));
  const on = rs.filter((m) => (isCol ? atBottom(m, bottom.at) || rs.some((o) => o !== m && Math.abs(o.b[1] - m.b[3]) <= 2) : atLeft(m, left.at) || rs.some((o) => o !== m && Math.abs(o.b[2] - m.b[0]) <= 2)));
  const keys = bySeries(on).slice(0, 6);
  const cats = (isCol ? categories(on, (m) => m.b[0], (m) => m.b[2], keys.length > 1) : categories(on, (m) => m.b[1], (m) => m.b[3], keys.length > 1)).slice(0, 30);
  if (cats.length < 2) return null;
  const touches = (m: Mark, o: Mark) => (isCol ? Math.abs(m.b[3] - o.b[1]) <= 2 || Math.abs(o.b[3] - m.b[1]) <= 2 : Math.abs(m.b[2] - o.b[0]) <= 2 || Math.abs(o.b[2] - m.b[0]) <= 2);
  const stacked = keys.length > 1 && cats.some((k) => k.ms.some((m) => k.ms.some((o) => o !== m && !sameColor(m.key, o.key) && touches(m, o))));
  const len = (m: Mark) => (isCol ? height(m.b) : width(m.b));
  // colours that never share a category are one series coloured by category (or one bar highlighted), not a clustered
  // chart: there, every category holds bars of two or more colours
  // (a category or two may hold two colours where neighbouring bars of different colours fall into one)
  const mixed = cats.filter((cat) => cat.ms.some((m) => cat.ms.some((o) => !sameColor(m.key, o.key)))).length;
  const byCategory = keys.length > 1 && mixed <= Math.max(0, Math.floor(cats.length * 0.15));
  const raw = byCategory ? [cats.map((cat) => cat.ms.reduce((a, m) => a + len(m), 0))]
    : keys.map((k) => cats.map((cat) => cat.ms.filter((m) => sameColor(m.key, k.key)).reduce((a, m) => a + len(m), 0)));
  const max = Math.max(...raw.flat(), 1e-9);
  const members = isCol
    ? axisLabels(c.words, cats, 'x', [bottom.at - 2, bottom.at + c.med * 4], c.med)
    : axisLabels(c.words, cats, 'y', [c.b[0], left.at + 2], c.med);
  const series = byCategory ? [{ name: c.measure.name, shape: raw[0].map((v) => round((v / max) * 100)) }]
    : keys.map((k, i) => ({ name: c.nameOf(k.key) || (keys.length === 1 ? c.measure.name : `Series ${i + 1}`), shape: raw[i].map((v) => round((v / max) * 100)) }));
  // 100% stacked: every category's stack reaches the same length (within a few percent)
  const totals = cats.map((_, j) => raw.reduce((a, r) => a + r[j], 0));
  // (each series in most categories: a treemap's tiles fill columns of one height too, but every tile in a colour of its own)
  const stackedPercent = stacked && cats.length >= 2 && Math.min(...totals) >= Math.max(...totals) * 0.97
    && keys.every((k) => cats.filter((cat) => cat.ms.some((m) => sameColor(m.key, k.key))).length >= cats.length * 0.6);
  const hullOn = hull(on), rim = Math.max(3, Math.round(c.med * 0.3)) + 2;
  const refs = (isCol
    ? refLines(c, 'h', [hullOn[0], hullOn[2]], [Math.max(c.b[1] + 2, hullOn[1] - (bottom.at - hullOn[1]) * 0.15), bottom.at - rim], (y) => ((bottom.at - y) / max) * 100, keys.map((k) => k.key))
    : refLines(c, 'v', [hullOn[1], hullOn[3]], [left.at + rim, Math.min(c.b[2] - c.med * 1.5, hullOn[2] + (hullOn[2] - left.at) * 0.15)], (x) => ((x - left.at) / max) * 100, keys.map((k) => k.key))
  // (the search reaches a little past the longest bar's or stack's end, not into a header above; a line exactly at the
  // end is where the bars' own edges line up, as in a stack of equal totals)
  ).filter((r) => Math.abs(r.shape - (stacked ? (Math.max(...totals) / max) * 100 : 100)) >= 1.5);
  const strength = (isCol ? bottom.n : left.n) / rs.length;
  return { type: isCol ? 'column' : 'bar', certainty: Math.min(1, 0.45 + strength * 0.5),
    fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series, stacked, ...(stackedPercent ? { stackedPercent: true } : {}),
      ...(refs.length && !stackedPercent ? { refLines: refs } : {}), ...(isCol ? {} : { horizontal: true }) },
    ...(isCol ? { at: cats.map((k) => (k.lo + k.hi) / 2), base: bottom.at, keys: keys.map((k) => k.key) } : {}) };
}

/** Area (a wide filled shape) or line (long thin strokes): heights sampled under the axis labels. */
function lines(c: Ctx): Reading | null {
  const wide = c.body.filter((m) => width(m.b) >= width(c.plot) * 0.4 && m.fill >= 0.3 && m.fill < 0.92 && height(m.b) > c.med * 2);
  const major = (ss: ReturnType<typeof bySeries>) => ss.filter((s) => s.n >= ss[0].n * 0.25).slice(0, 6);
  const lineSeries = major(bySeries(c.thin)), areaSeries = major(bySeries(wide));
  if (!areaSeries.length && !lineSeries.length) return null;
  const isArea = areaSeries.length > 0 && areaSeries[0].n > (lineSeries[0]?.n || 0) * 3;
  const use = isArea ? areaSeries : lineSeries;
  const ms = use.flatMap((s) => s.marks), [x0, yTop, x1, yBot] = hull(ms);
  // the axis labels: the first row of words below the line (its lowest point may sit far above the axis) that holds at
  // least three words across most of the line's width; else the words just below the line
  // (across the whole panel: the line's own extent can be narrower than its axis; of the rows, the one with most words
  // is the axis, a y-axis label or an axis title being a row of one)
  // (by each word's middle: a slanted label's box starts above the line's lowest point)
  const under = c.words.filter((w) => w.y + w.h / 2 >= yBot - c.med * 0.5 && w.y + w.h <= c.b[3] + 1 && w.x + w.w >= c.b[0] && w.x <= c.b[2]).sort((p, q) => p.y - q.y);
  const labelRows: Word[][] = [];
  // (by each word's middle: a reader's boxes for one row of labels can start a few pixels apart)
  const mid = (w: Word) => w.y + w.h / 2;
  for (const w of under) { const r = labelRows.find((r) => Math.abs(mid(r[0]) - mid(w)) <= c.med * 1.2); if (r) r.push(w); else labelRows.push([w]); }
  const axisRow = labelRows.filter((r) => r.length >= 3 && Math.max(...r.map((w) => w.x + w.w)) - Math.min(...r.map((w) => w.x)) >= Math.min(x1 - x0, width(c.b) * 0.6) * 0.5)
    .sort((p, q) => q.length - p.length)[0];
  const belowWords = axisRow || c.words.filter((w) => w.y >= yBot - c.med * 0.5 && w.y <= yBot + c.med * 4 && w.x + w.w >= x0 - c.med * 3 && w.x <= x1 + c.med * 3);
  // (the axis row's labels by their spacing, when that finds more of them than phrases do)
  const asPhrases = phrases(belowWords, c.med), bySteps = axisRow ? stepGroups(axisRow, c.med) : [];
  const below = bySteps.length > asPhrases.length ? bySteps : asPhrases;
  const useLabels = below.length >= 3 && below.length <= 40;
  // labels that cannot be read as phrases (slanted, or masked as unread text) still sit in one group per category below
  // the axis: the groups give the categories' positions; twelve evenly spaced points only when there are none
  const groups: Word[][] = [];
  const cx = (w: Word) => w.x + w.w / 2;
  if (!useLabels) {
    const near = c.words.filter((w) => w.y >= yBot - c.med * 0.5 && w.y <= yBot + c.med * 8 && cx(w) >= x0 - c.med && cx(w) <= x1 + c.med * 3)
      .sort((p, q) => cx(p) - cx(q));
    for (const w of near) { const g = groups[groups.length - 1]; if (g && cx(w) - cx(g[g.length - 1]) <= c.med * 1.5) g.push(w); else groups.push([w]); }
  }
  const byGroups = !useLabels && groups.length >= 3 && groups.length <= 40 && cx(groups[groups.length - 1][0]) - cx(groups[0][0]) >= (x1 - x0) * 0.5;
  const xs = useLabels ? below.map((p) => (p.x0 + p.x1) / 2)
    : byGroups ? groups.map((g) => g.reduce((p, w) => p + cx(w), 0) / g.length)
    : Array.from({ length: 12 }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / 12);
  // (a group's words name its category when they all stayed readable)
  const members = monthsInOrder(useLabels ? below.map((p, i) => (p.ws.length && p.ws.every((w) => w.kept && w.text) ? p.ws.map((w) => w.text).join(' ') : `Item ${i + 1}`))
    : byGroups ? groups.map((g, i) => (g.every((w) => w.kept && w.text) ? g.map((w) => w.text).join(' ') : `Item ${i + 1}`))
    : xs.map((_, i) => `Item ${i + 1}`));
  const ys = use.map((s) => xs.map((x) => {
    const xi = Math.round(Math.min(Math.max(x, x0), x1 - 1));
    for (const dx of [0, -1, 1, -2, 2, -4, 4, -8, 8]) {
      const xx = xi + dx; let top = -1, sum = 0, n = 0;
      if (xx < 0 || xx >= c.img.width) continue;
      for (let y = Math.floor(yTop); y < yBot; y++) {
        if (c.ink(xx, y) && sameColor(keyAt(c.img, xx, y), s.key)) { if (top < 0) top = y; sum += y; n++; if (!isArea && n > 8) break; }
      }
      if (n) return isArea ? top : sum / n;
    }
    return NaN;
  }));
  const span = Math.max(1, yBot - yTop), floor = yBot + span * 0.12;
  const toShape = (y: number) => ((floor - y) / (floor - yTop)) * 100;
  const filledYs = use.map((_, i) => ys[i].map((y, j) => (Number.isFinite(y) ? y : ys[i].slice(0, j).reverse().find(Number.isFinite) ?? ys[i].find(Number.isFinite) ?? yBot)));
  // (beside other lines, one that keeps exactly one height all the way is a reference line drawn solid, not a series)
  const flat = use.map((s, i) => !isArea && use.length >= 2 && Math.max(...filledYs[i]) - Math.min(...filledYs[i]) <= 2 && width(hull(s.marks)) >= (x1 - x0) * 0.6);
  const series = use.map((s, i) => ({ name: c.nameOf(s.key) || (use.length === 1 ? c.measure.name : `Series ${i + 1}`), shape: filledYs[i].map((y) => round(toShape(y))) }))
    .filter((_, i) => !flat[i]);
  const longest = Math.max(...ms.map((m) => width(m.b))) / Math.max(1, width(c.plot));
  // (from a little above the highest point: a header's rule higher up is not a target)
  const top = Math.max(c.b[1] + 2, yTop - (yBot - yTop) * 0.15), inPlot = (q: number) => q > top && q < yBot - 2;
  const refs = [...use.flatMap((s, i) => {
    if (!flat[i]) return [];
    const at = filledYs[i].reduce((a, y) => a + y, 0) / filledYs[i].length, u = hull(s.marks);
    return [{ name: c.nameOf(s.key) || refName(c, 'h', at, u[0], u[2], inPlot) || 'Target', shape: round(toShape(at)) }];
  }), ...refLines(c, 'h', [x0, x1], [top, yBot - 2], toShape, use.filter((_, i) => !flat[i]).map((s) => s.key))].slice(0, 2);
  return { type: isArea ? 'area' : 'line', certainty: Math.min(0.9, 0.4 + longest * 0.5),
    fields: { dimension: { name: c.dName || 'Period', members }, measure: c.measure, series, ...(isArea && use.length > 1 ? { stacked: true } : {}), ...(refs.length ? { refLines: refs } : {}) } };
}

/** Scatter or bubble: many small solid dots. */
function scatter(c: Ctx): Reading | null {
  // (bubble charts have fewer, larger dots than tight scatter plots; allow dots up to 15% of the panel's
  //  short side, and accept as few as 3 when the panel has very few marks overall)
  const dots = c.body.filter((m) => Math.max(width(m.b), height(m.b)) < Math.min(width(c.b), height(c.b)) * 0.15 && m.fill > 0.45 && Math.abs(width(m.b) - height(m.b)) <= Math.max(2, width(m.b) * 0.4));
  if (dots.length < 3 || dots.length < c.body.length * 0.35) return null;
  const xs = dots.map((d) => d.cx), ys = dots.map((d) => d.cy);
  const dx0 = Math.min(...xs), dx1 = Math.max(...xs), dy0 = Math.min(...ys), dy1 = Math.max(...ys);
  // dots in a row along one line are a dotted sparkline or markers on a line, not a scatter
  if (dy1 - dy0 < height(c.b) * 0.15 || dx1 - dx0 < width(c.b) * 0.15) return null;
  const sizes = norm100(dots.map((d) => d.n)), varied = Math.max(...sizes) > Math.min(...sizes) * 2.5;
  const parts = /^(.+?)\s+(?:vs\.?|versus|and)\s+(.+?)(?:\s+by\s+.+)?$/i.exec(c.title);
  const xName = parts ? parts[1] : 'X', yName = parts ? parts[2] : 'Y';
  return { type: 'scatter', certainty: Math.min(0.9, 0.4 + dots.length / 60), fields: {
    xMeasure: { name: xName, ...formatOf(xName) }, yMeasure: { name: yName, ...formatOf(yName) },
    points: dots.slice(0, 60).map((d, i) => [round(((d.cx - dx0) / Math.max(1, dx1 - dx0)) * 90 + 5), round(((dy1 - d.cy) / Math.max(1, dy1 - dy0)) * 90 + 5), varied ? sizes[i] : 50]),
    ...(varied ? { bubble: true } : {}) } };
}

/** Treemap: solid tiles of several sizes filling a rectangle. */
/**
 * A filled map: many irregular regions (countries, states) that touch one another and together cover a good share of
 * the panel. Neither solid rectangles (bars, treemap tiles) nor thin strokes (lines). Which map it is cannot be told
 * from the outlines, so the replica draws a world map and borrows its places from the rest of the dashboard.
 */
function map(c: Ctx): Reading | null {
  const pa = width(c.b) * height(c.b);
  const thinSet = new Set(c.thin);
  // (a country is a piece of the panel, not a speck: at a floor of three ten-thousandths a legend's swatches counted
  //  as six touching regions, and one stacked area chart beside its legend read as a continent)
  const regions = c.body.filter((m) => !thinSet.has(m) && m.fill >= 0.12 && m.fill < 0.8 && m.n >= pa * 0.002 && Math.min(width(m.b), height(m.b)) >= 3);
  // (solid rectangles among the marks themselves: the column splitting behind c.rects slices irregular regions too)
  // (colour-scale legend strips are tiny solid marks much smaller than any region; exclude them from the solid count so
  //  they do not suppress map detection — but large solid marks, such as treemap tiles, are still counted)
  const minRegionN = regions.length ? Math.min(...regions.map((m) => m.n)) : 0;
  const solid = c.body.filter((m) => m.fill >= 0.85 && (!minRegionN || m.n >= minRegionN * 0.4)).length;
  const asMap = { type: 'map' as const, certainty: 0.55, fields: { basemap: 'world', mapKind: 'filled', dimension: { name: c.dName || 'Region', members: [] }, measure: c.measure, series: [{ name: c.measure.name, shape: [] }] } };
  // neighbouring regions in close shades join into one mark: one large irregular mark holding many shades is a map too
  // (an area chart's fill is one colour)
  // (not bars that touch, which the bar reader finds on a shared baseline, nor a pie, which is round and evenly filled)
  const round = (m: Mark) => { const r = width(m.b) / Math.max(1, height(m.b)); return r > 0.85 && r < 1.18 && m.fill > 0.68; };
  // (nor a stacked area chart, which is also one large irregular shape in several colours: it stands on the plot's
  //  baseline, inked right along its own bottom edge, where a continent's coastline is ragged)
  // (and its top is a profile that rises and falls, where a map drawn on a square tile is inked along its top edge
  //  as well as its bottom one)
  const inkedRow = (m: Mark, y: number) => {
    let n = 0, t = 0;
    for (let x = Math.ceil(m.b[0]); x <= Math.floor(m.b[2]); x += 2) { t++; if (c.ink(x, Math.round(y))) n++; }
    return t > 0 ? n / t : 0;
  };
  const flatBottom = (m: Mark) => inkedRow(m, m.b[3] - 2) >= 0.8 && inkedRow(m, m.b[1] + 2) < 0.8;
  // (an area chart's bands span nearly the full panel width; a single map region does not)
  if (c.thin.length <= 2 && !bars(c) && c.body.some((m) => m.n >= pa * 0.08 && m.fill >= 0.15 && m.fill < 0.85 && m.colors >= 4 && !round(m) && !flatBottom(m) && width(m.b) < width(c.b) * 0.85)) return asMap;
  // Choropleth-with-background: a large neutral (grey or unsaturated) base map + a few coloured country overlays
  // (e.g. a Power BI European choropleth with 3-6 highlighted countries on a world base map)
  const satK = (k: number) => { const r = (k >> 8) & 15, g = (k >> 4) & 15, b = k & 15; return Math.max(r, g, b) - Math.min(r, g, b); };
  const bgMark = !bars(c) && c.thin.length <= 2 && c.body.find((m) => !thinSet.has(m) && m.n >= pa * 0.15 && m.fill >= 0.5 && satK(m.key) <= 2);
  if (bgMark) {
    const overlays = regions.filter((m) => m !== bgMark && satK(m.key) >= 2);
    if (overlays.length >= 3 && overlays.length <= 10) {
      const sp2 = hull(overlays);
      const wd2 = overlays.filter((m) => width(m.b) >= width(sp2) * 0.6).length;
      const yOv2 = (a: Mark, b: Mark) => Math.max(0, Math.min(a.b[3], b.b[3]) - Math.max(a.b[1], b.b[1]));
      const stacked2 = overlays.every((r, i) => overlays.slice(i + 1).every((o) => yOv2(r, o) <= 5));
      if (!stacked2 && wd2 <= 1) {
        const tc2 = (a: Mark, b: Mark) => a.b[0] <= b.b[2] + 2 && b.b[0] <= a.b[2] + 2 && a.b[1] <= b.b[3] + 2 && b.b[1] <= a.b[3] + 2;
        if (overlays.filter((r) => overlays.some((o) => o !== r && tc2(r, o))).length >= overlays.length * 0.4) return asMap;
      }
    }
  }
  if (regions.length < 6 || c.thin.length > 2 || solid > regions.length * 0.5) return null;
  if (regions.reduce((a, m) => a + m.n, 0) < pa * 0.08) return null;
  // (a stacked area chart's bands are irregular regions that touch too, and they can be six or more. The chart stands
  //  on the plot's baseline, so its largest band is inked right along its own bottom edge; a country's coastline is
  //  ragged, and a map's largest region is not.)
  const span = hull(regions), wide = regions.filter((m) => width(m.b) >= width(span) * 0.6).length;
  if (wide >= Math.max(3, regions.length * 0.45)) return null;
  // (stacked area bands form non-overlapping horizontal stripes; map regions freely overlap in Y)
  const yOv = (a: Mark, b: Mark) => Math.max(0, Math.min(a.b[3], b.b[3]) - Math.max(a.b[1], b.b[1]));
  if (regions.every((r, i) => regions.slice(i + 1).every((o) => yOv(r, o) <= 5)) && wide >= 2) return null;
  // neighbouring regions share borders: most of them touch another
  const touch = (a: Mark, b: Mark) => a.b[0] <= b.b[2] + 2 && b.b[0] <= a.b[2] + 2 && a.b[1] <= b.b[3] + 2 && b.b[1] <= a.b[3] + 2;
  if (regions.filter((m) => regions.some((o) => o !== m && touch(m, o))).length < regions.length * 0.6) return null;
  return asMap;
}

/**
 * A waterfall: columns side by side that do not share a baseline but chain, each starting where the one before ended
 * (up from its top, or down from it), with totals standing on the baseline. Shape: the first column as 100, then each
 * step signed, then the total.
 */
function waterfall(c: Ctx): Reading | null {
  // (a legend's swatch among them is far narrower than a column)
  const all = c.rects.filter((m) => m.n >= 20), medW = [...all.map((m) => width(m.b))].sort((a, b) => a - b)[all.length >> 1] || 0;
  const rs = all.filter((m) => width(m.b) >= medW * 0.6).sort((a, b) => a.b[0] - b.b[0]);
  if (rs.length < 3 || rs.some((m, i) => i > 0 && m.b[0] < rs[i - 1].b[2] - 1)) return null;
  const ws = rs.map((m) => width(m.b)), mw = ws.reduce((a, b) => a + b, 0) / ws.length;
  if (ws.some((w) => Math.abs(w - mw) > mw * 0.35)) return null;
  const base = Math.max(...rs.map((m) => m.b[3])), tol = Math.max(3, mw * 0.15);
  const onBase = (m: Mark) => Math.abs(m.b[3] - base) <= tol;
  if (!onBase(rs[0])) return null;
  let level = rs[0].b[1], floating = 0;
  const steps = [height(rs[0].b)];
  for (let i = 1; i < rs.length; i++) {
    const m = rs[i], h = height(m.b);
    if (Math.abs(m.b[3] - level) <= tol && !onBase(m)) { steps.push(h); level = m.b[1]; floating++; }
    else if (Math.abs(m.b[1] - level) <= tol && !onBase(m)) { steps.push(-h); level = m.b[3]; floating++; }
    else if (i === rs.length - 1 && onBase(m) && Math.abs(m.b[1] - level) <= tol) steps.push(h);
    else return null;
  }
  if (floating < 2) return null;
  const cats = rs.map((m) => ({ lo: m.b[0], hi: m.b[2] }));
  const members = axisLabels(c.words, cats, 'x', [base - 2, base + c.med * 4], c.med);
  return { type: 'waterfall', certainty: 0.85, fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure,
    series: [{ name: c.measure.name, shape: steps.map((h) => Math.round((h / steps[0]) * 100)) }] } };
}

function treemap(c: Ctx): Reading | null {
  const rs = c.rects.filter((m) => m.n >= 40);
  if (rs.length < 3) return null;
  const u = hull(rs), pa = width(c.b) * height(c.b);
  const tiled = rs.reduce((a, m) => a + width(m.b) * height(m.b), 0) / Math.max(1, width(u) * height(u));
  if (tiled < 0.85 || width(u) * height(u) < pa * 0.25) return null;
  // tiled in two directions: tiles start at several x and several y positions, and they do not share a baseline
  const starts = (v: number[]) => v.filter((x, i) => v.findIndex((y) => Math.abs(y - x) <= 3) === i).length;
  if (starts(rs.map((m) => m.b[0])) < 2 || starts(rs.map((m) => m.b[1])) < 2 || mode(rs.map((m) => m.b[3]), 3).n === rs.length) return null;
  // a real treemap distributes area; one dominant tile (>85 % of all tile pixels) with a few tiny strips is a map's
  // colour-scale legend beside its background region, not a treemap
  const totalN = rs.reduce((a, m) => a + m.n, 0);
  if (Math.max(...rs.map((m) => m.n)) > totalN * 0.85) return null;
  // (treemap tiles are roughly rectangular; stacked bar segments are strongly elongated — their median aspect ratio
  //  is 4:1 or more, while a real treemap's tiles stay close to square or mildly rectangular)
  const aspects = rs.map((m) => Math.max(width(m.b), height(m.b)) / Math.max(1, Math.min(width(m.b), height(m.b))));
  const medAspect = [...aspects].sort((a, b) => a - b)[aspects.length >> 1];
  if (medAspect > 4) return null;
  const tiles = [...rs].sort((a, b) => b.n - a.n).slice(0, 20);
  const members = tiles.map((t, i) => {
    const ws = c.words.filter((w) => { const [x, y] = wordCenter(w); return x >= t.b[0] && x <= t.b[2] && y >= t.b[1] && y <= t.b[3]; });
    const ph = phrases(ws, c.med)[0];
    return ph && ph.ws.every((w) => w.kept && w.text) ? ph.ws.map((w) => w.text).join(' ') : `Item ${i + 1}`;
  });
  return { type: 'treemap', certainty: Math.min(1, tiled), fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series: [{ name: c.measure.name, shape: norm100(tiles.map((t) => t.n)) }] } };
}

/**
 * Gauge: an arc round a centre at its bottom (a half ring), a coloured progress arc over a grey track. The value is how
 * far round the coloured arc reaches, 0-100 (shapeValue).
 */
function gauge(c: Ctx): Reading | null {
  // (a full semicircle arc has low fill; a partial progress arc covering < 30% of the semicircle has a compact bbox
  //  that pushes fill above 0.7, so use 0.85 to catch thick short arcs without admitting solid bars)
  const arcs = c.body.filter((m) => m.fill < 0.85 && m.n >= 30 && width(m.b) >= width(c.b) * 0.08);
  // (a single piece, or the arc in two: a progress part and the track's remainder, each only part of the half ring)
  const union = arcs.length >= 2 ? [{ ...arcs[0], b: hull(arcs), keys: arcs.map((a) => a.key) }] : [];
  const cands = [...arcs.map((m) => ({ ...m, keys: [m.key] })), ...union]
    .filter((m) => width(m.b) >= width(c.b) * 0.25 && width(m.b) >= height(m.b) * 1.5 && width(m.b) <= height(m.b) * 2.6);
  for (const m of cands.sort((p, q) => width(q.b) - width(p.b))) {
    const cx = (m.b[0] + m.b[2]) / 2, cy = m.b[3], R = width(m.b) / 2;
    // the arc's own pixels lie in a band round the centre (outside the words: the value inside the ring, a label)
    let n = 0, inBand = 0;
    const inWord = (x: number, y: number) => c.words.some((w) => x >= w.x - 1 && x <= w.x + w.w + 1 && y >= w.y - 1 && y <= w.y + w.h + 1);
    for (let y = Math.floor(m.b[1]); y < m.b[3]; y += 2) for (let x = Math.floor(m.b[0]); x < m.b[2]; x += 2) {
      if (!c.ink(x, y) || !m.keys.some((k) => sameColor(keyAt(c.img, x, y), k)) || inWord(x, y)) continue;
      n++; const d = Math.hypot(x - cx, y - cy); if (d >= R * 0.45 && d <= R * 1.06) inBand++;
    }
    if (n < 30 || inBand < n * 0.9) continue;
    // (and the ring runs from end to end: its left foot, its top and its right foot all hold it; a rising line does not)
    const holds = (x0: number, y0: number, x1: number, y1: number) => { for (let y = Math.floor(y0); y < y1; y += 2) for (let x = Math.floor(x0); x < x1; x += 2) if (c.ink(x, y) && m.keys.some((k) => sameColor(keyAt(c.img, x, y), k)) && !inWord(x, y)) return true; return false; };
    if (!holds(cx - R, cy - R * 0.3, cx - R * 0.45, cy) || !holds(cx - R * 0.3, cy - R, cx + R * 0.3, cy - R * 0.5) || !holds(cx + R * 0.45, cy - R * 0.3, cx + R, cy)) continue;
    // the ring: every mark in the band; the progress, its vivid part, from the left end round
    const ring = c.body.filter((o) => { const [ox, oy] = [(o.b[0] + o.b[2]) / 2, (o.b[1] + o.b[3]) / 2]; const d = Math.hypot(ox - cx, oy - cy); return o.b[3] <= cy + 2 && d <= R * 1.05 && Math.hypot(o.b[0] - cx, o.b[3] - cy) <= R * 1.08; });
    const vivid = ring.filter((o) => satOf(o.key) >= 3);
    const lum = (k: number) => ((k >> 8) & 15) + ((k >> 4) & 15) + (k & 15);
    const greys = [...ring].sort((p, q) => lum(p.key) - lum(q.key));
    const prog = vivid.length ? vivid : greys.length >= 2 && lum(greys[0].key) < lum(greys[greys.length - 1].key) - 3 ? [greys[0]] : [m];
    let reach = Math.PI;
    for (const o of prog) for (let y = Math.floor(o.b[1]); y < o.b[3]; y += 2) for (let x = Math.floor(o.b[0]); x < o.b[2]; x += 2) {
      if (!c.ink(x, y) || !sameColor(keyAt(c.img, x, y), o.key)) continue;
      const a = Math.atan2(cy - y, x - cx); if (a >= 0 && a < reach) reach = a;
    }
    const value = round(((Math.PI - reach) / Math.PI) * 100);
    return { type: 'gauge' as ChartType, certainty: 0.75, fields: { measure: c.measure, shapeValue: value, min: 0, max: 100 } };
  }
  return null;
}

/** Funnel: three or more horizontal bars, one above another, centred on one line, of different widths. */
function funnel(c: Ctx): Reading | null {
  const rs = c.rects.filter((m) => m.n >= 30 && width(m.b) > height(m.b)).sort((p, q) => p.b[1] - q.b[1]);
  if (rs.length < 3) return null;
  const mids = rs.map((m) => (m.b[0] + m.b[2]) / 2), mid = [...mids].sort((a, b) => a - b)[mids.length >> 1];
  const centred = rs.filter((m, i) => Math.abs(mids[i] - mid) <= Math.max(3, width(c.b) * 0.02));
  if (centred.length < 3 || centred.length < rs.length * 0.8) return null;
  // one bar per row, of different widths, and not all starting at one left edge (that is a bar chart)
  if (centred.some((m, i) => i && m.b[1] < centred[i - 1].b[3] - 2)) return null;
  const ws = centred.map((m) => width(m.b));
  if (Math.max(...ws) < Math.min(...ws) * 1.3) return null;
  const members = axisLabels(c.words, centred.map((m) => ({ lo: m.b[1], hi: m.b[3] })), 'y', [c.b[0], Math.min(...centred.map((m) => m.b[0])) + 2], c.med);
  return { type: 'funnel' as ChartType, certainty: 0.8, fields: { dimension: { name: c.dName || 'Stage', members }, measure: c.measure, series: [{ name: c.measure.name, shape: norm100(ws) }] } };
}

/** Gantt: three or more horizontal bars, one per row, starting at different points along a shared time axis. */
function gantt(c: Ctx): Reading | null {
  const rs = c.rects.filter((m) => m.n >= 30 && width(m.b) > height(m.b)).sort((p, q) => p.b[1] - q.b[1]);
  if (rs.length < 3 || cv(rs.map((m) => height(m.b))) > 0.25) return null;
  if (rs.some((m, i) => i && m.b[1] < rs[i - 1].b[3] - 2)) return null;
  const lefts = rs.map((m) => m.b[0]), x0 = Math.min(...lefts), x1 = Math.max(...rs.map((m) => m.b[2])), span = Math.max(1, x1 - x0);
  // starts spread along the axis: three or more distinct ones, and no start shared by most bars (a bar chart's bars share
  // a baseline)
  const starts = lefts.filter((x, i) => lefts.findIndex((y) => Math.abs(y - x) <= span * 0.03) === i).length;
  if (starts < 3 || mode(lefts, span * 0.03).n >= rs.length * 0.6) return null;
  // (a diverging bar chart's bars each touch the zero line, with one end or the other)
  const ends = rs.flatMap((m) => [m.b[0], m.b[2]]);
  const zero = mode(ends, Math.max(2, span * 0.01));
  if (rs.filter((m) => Math.abs(m.b[0] - zero.at) <= Math.max(2, span * 0.01) || Math.abs(m.b[2] - zero.at) <= Math.max(2, span * 0.01)).length >= rs.length * 0.8) return null;
  // not a funnel: their middles are not on one line
  const mids = rs.map((m) => (m.b[0] + m.b[2]) / 2);
  if (Math.max(...mids) - Math.min(...mids) < span * 0.1) return null;
  const names = axisLabels(c.words, rs.map((m) => ({ lo: m.b[1], hi: m.b[3] })), 'y', [c.b[0], x0 + 2], c.med);
  const tasks = rs.map((m, i) => ({ name: names[i], start: round(((m.b[0] - x0) / span) * 100), end: round(((m.b[2] - x0) / span) * 100) }));
  return { type: 'gantt' as ChartType, certainty: 0.75, fields: { tasks, timeLabels: [] } };
}

/**
 * Heatmap: a block of cells in a regular grid, each a shade of one scale. Neighbouring cells of close shades join into
 * one mark, so the grid is found from colour changes instead: down many rows, the changes fall at the same few x, evenly
 * spaced (the column edges), and across many columns at the same few y (the row edges).
 */
function heatmap(c: Ctx): Reading | null {
  // (cells of close shades join into blobs of any shape: the block is where the sizeable marks are)
  const big = c.body.filter((m) => m.n >= width(c.b) * height(c.b) * 0.01);
  if (!big.length) return null;
  const u = hull(big), pa = width(c.b) * height(c.b);
  if (width(u) * height(u) < pa * 0.25 || width(u) < 60 || height(u) < 40) return null;
  const at = (x: number, y: number) => rgbAt(c.img, Math.round(x), Math.round(y));
  const differ = (p: number[], q: number[]) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])) > 6;
  const edgesAlong = (horiz: boolean) => {
    const len = horiz ? width(u) : height(u), counts = new Array(Math.ceil(len)).fill(0), lines = 24;
    for (let k = 0; k < lines; k++) {
      const v = horiz ? u[1] + ((k + 0.5) / lines) * height(u) : u[0] + ((k + 0.5) / lines) * width(u);
      for (let s = 1; s < len; s++) { const p = horiz ? at(u[0] + s - 1, v) : at(v, u[1] + s - 1), q = horiz ? at(u[0] + s, v) : at(v, u[1] + s); if (differ(p, q)) counts[s]++; }
    }
    // a cell edge: a position where a colour change shows on many of the lines (each cell differs from some neighbours)
    const peaks: number[] = [];
    counts.forEach((n, s) => { if (n >= lines * 0.25 && (!peaks.length || s - peaks[peaks.length - 1] > 3)) peaks.push(s); });
    return peaks;
  };
  const xs = edgesAlong(true), ys = edgesAlong(false);
  const regular = (ps: number[], len: number) => {
    if (ps.length < 2) return 0;
    const all = [0, ...ps, len], gaps = all.slice(1).map((p, i) => p - all[i]), g = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
    return gaps.filter((x) => Math.abs(x - g) <= Math.max(3, g * 0.15)).length >= gaps.length * 0.8 ? gaps.length : 0;
  };
  const nc = regular(xs, width(u)), nr = regular(ys, height(u));
  if (nc < 3 || nr < 2 || nc * nr < 9) return null;
  // each cell's shade: its centre's distance from the background, scaled 0-100
  const bg = rgbAt(c.img, Math.round(c.b[0] + 2), Math.round(c.b[1] + 2)), dist = (p: number[]) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
  const cw = width(u) / nc, ch = height(u) / nr;
  const raw = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, k) => dist(at(u[0] + (k + 0.5) * cw, u[1] + (r + 0.5) * ch))));
  // (one colour scale: the cells' hues agree, where a map's tiles mix greens, blues and greys)
  const hueOf = (q: number[]) => { const mx = Math.max(...q), mn = Math.min(...q); if (mx - mn < 24) return -1; const [r, g, b] = q; const h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); return ((h * 60) + 360) % 360; };
  const hues = Array.from({ length: nr * nc }, (_, i) => hueOf(at(u[0] + ((i % nc) + 0.5) * cw, u[1] + (Math.floor(i / nc) + 0.5) * ch))).filter((h) => h >= 0);
  if (hues.length) { const h0 = [...hues].sort((a, b) => a - b)[hues.length >> 1]; if (hues.filter((h) => Math.min(Math.abs(h - h0), 360 - Math.abs(h - h0)) <= 30).length < hues.length * 0.8) return null; }
  const lo = Math.min(...raw.flat()), hi = Math.max(...raw.flat(), lo + 1);
  if (new Set(raw.flat().map((v) => Math.round(v / 12))).size < 3) return null;
  const matrix = raw.map((row) => row.map((v) => round(((v - lo) / (hi - lo)) * 100)));
  const rows = axisLabels(c.words, Array.from({ length: nr }, (_, r) => ({ lo: u[1] + r * ch, hi: u[1] + (r + 1) * ch })), 'y', [c.b[0], u[0] + 2], c.med);
  const cols = axisLabels(c.words, Array.from({ length: nc }, (_, k) => ({ lo: u[0] + k * cw, hi: u[0] + (k + 1) * cw })), 'x', [u[3] - 2, u[3] + c.med * 4], c.med);
  return { type: 'heatmap' as ChartType, certainty: 0.75, fields: { rows: { name: 'Row', members: rows }, columns: { name: 'Column', members: cols }, matrix, measure: c.measure } };
}

function kpi(c: Ctx, certainty: number): Reading {
  const small = c.words.filter((w) => !isBigBox(w, c.med) && w.y < c.b[1] + height(c.b) * 0.75);
  const top = small.length ? Math.min(...small.map((w) => w.y)) : 0;
  // (else the card's title: a reader can draw a label's boxes as tall as a value, as for a short "Gross Spend")
  const label = text(small.filter((w) => w.kept && Math.abs(w.y - top) < c.med * 0.8)) || c.title;
  return { type: 'kpi', certainty, fields: { measure: { name: label || 'KPI', ...formatOf(label) }, sparkline: c.thin.length > 0 || c.body.some((m) => width(m.b) > width(c.b) * 0.3 && m.fill < 0.9) } };
}

/**
 * `words` carry what the masked image shows (a masked word is its grey box); `gridWords` are the OCR boxes, for judging
 * whether words sit on a grid (masks over a column of numbers are merged into one block, which hides the grid).
 */
export function readPanel(img: Img, b: Box, words: Word[], med: number, title: string, features: Record<string, number> = {}, gridWords: Word[] = words): Reading {
  const pa = width(b) * height(b);
  const all = findMarks(img, b, words);
  const swatches = legend(all, words, med);
  const swatchSet = new Set(swatches.map((s) => s.mark));
  const body = all.filter((m) => !swatchSet.has(m) && !isTextSpeck(m) && m.n >= Math.max(12, pa * 0.0002));
  const ink = inkTest(img, b);
  const markArea = body.reduce((a, m) => a + m.n, 0), coverage = markArea / Math.max(1, pa);
  const stacked = labelStacks(words, med);
  const bigMasked = words.filter((w) => !w.kept && isBigBox(w, med) && !stacked.has(w));
  const masked = words.filter((w) => !w.kept && !stacked.has(w));
  const grid = looksLikeTable(gridWords, med);
  const series = bySeries(body);
  const sat = (k: number) => { const r = (k >> 8) & 15, g = (k >> 4) & 15, b = k & 15; return Math.max(r, g, b) - Math.min(r, g, b); };
  const vivid = series.filter((s) => sat(s.key) >= 3 && s.n >= (series[0]?.n || 0) * 0.15).sort((a, b) => b.n * sat(b.key) - a.n * sat(a.key));
  const color = vivid.length ? keyHex(vivid[0].key) : undefined;
  const nameOf = (key: number) => { const s = swatches.find((s) => sameColor(s.key, key)); return s ? s.name : ''; };
  const { measure: mName, dimension: dName } = splitTitle(title);
  const measure = { name: mName || 'Value', ...formatOf(mName || '') };
  const thin = body.filter((m) => m.n / Math.max(width(m.b), height(m.b)) <= 5 && Math.max(width(m.b), height(m.b)) >= width(b) * 0.25 && m.fill < 0.35);
  // a line broken into pieces (a stray word box on it, a mask, a gap at a marker) is still one line: thin, sparse pieces
  // of one colour that together run across most of the panel. Dots (a scatter) are compact and solid, and bars solid.
  // (small pieces count too: where a line crosses columns, the bits between them can be a few pixels each)
  // (a nearly flat piece fills its small box: it counts when it is a few pixels tall)
  const pieces = all.filter((m) => !swatchSet.has(m) && !thin.includes(m) && m.n >= 6 && (m.fill < 0.35 || height(m.b) <= 4) && m.n / Math.max(width(m.b), height(m.b)) <= 6);
  for (const s of bySeries(pieces)) {
    if (s.marks.length < 2 || thin.some((t) => sameColor(t.key, s.key))) continue;
    // the pieces of one line form a chain, left to right: each starts near where the one before ended, at about its
    // height (scattered blobs of one colour, such as a map's small regions, do not); the longest chain is the line
    const sorted = [...s.marks].sort((p, q) => p.b[0] - q.b[0]);
    const next = (p: Mark, q: Mark) => q.b[0] - p.b[2] <= Math.max(med * 4, width(b) * 0.08) && q.b[0] >= p.b[0]
      && Math.max(p.b[1], q.b[1]) - Math.min(p.b[3], q.b[3]) <= med * 1.5;
    let chain: Mark[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const c: Mark[] = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) if (next(c[c.length - 1], sorted[j])) c.push(sorted[j]);
      if (hull(c)[2] - hull(c)[0] > (chain.length ? width(hull(chain)) : 0)) chain = c;
    }
    if (chain.length < 2) continue;
    const u = hull(chain), n = chain.reduce((a, m) => a + m.n, 0);
    if (width(u) < width(b) * 0.4) continue;
    // (a flat row of six or more evenly spaced dashes is a dashed reference line, read as one by refLines, not a series;
    // a flat data line broken by a few words or masks stays a line)
    const gaps = chain.slice(1).map((m, j) => m.b[0] - chain[j].b[2]);
    const even = gaps.length >= 5 && Math.max(...gaps) - Math.min(...gaps) <= Math.max(3, Math.min(...gaps));
    if (height(u) <= Math.max(3, Math.round(med * 0.3)) && even) continue;
    // (a line has one height at each x, so its pieces do not overlap across: gridlines at several heights do)
    if (chain.reduce((a, m) => a + width(m.b), 0) > width(u) * 1.3) continue;
    thin.push({ key: s.key, b: u, n, fill: n / Math.max(1, width(u) * height(u)), cx: (u[0] + u[2]) / 2, cy: (u[1] + u[3]) / 2, colors: 1 });
  }
  // solid rectangles, with touching dense columns split apart first (a block of columns of nearly one height, joined by
  // 1 px separators of a lighter shade, is solid too, so every mark is tried)
  const rects = body.flatMap((m) => { const parts = splitColumns(img, m, ink); return parts.length > 1 ? parts : m.fill >= 0.8 ? [m] : []; })
    .filter((m) => m.fill >= 0.8 && Math.min(width(m.b), height(m.b)) >= 3);
  Object.assign(features, { coverage: Math.round(coverage * 1000) / 1000, marks: body.length, rects: rects.length, thin: thin.length, series: series.length, words: words.length, bigMasked: bigMasked.length, masked: masked.length, grid: grid ? 1 : 0, swatches: swatches.length, vivid: vivid.length });
  const c: Ctx = { img, b, words, med, title, ink, body, rects, thin, markArea, coverage, nameOf, measure, dName, plot: plotBox(b, words, med), all: all.filter((m) => !swatchSet.has(m)) };
  const done = (r: Reading | null) => (r ? { ...r, color } : null);

  // columns with a line over them in a colour of its own (a trend over monthly counts, a total over stacked columns) are
  // a combo: the line is read at each category, from the baseline, on a scale of its own
  const combo = (col: Reading | null): Reading | null => {
    if (!col || col.type !== 'column' || !col.at || col.base === undefined || !col.keys) return col;
    // (a series line rises and falls: a gridline's pieces between the columns join into a long, flat, tinted mark)
    // (and crosses each column of pixels once, in one run, at heights that keep changing: gridlines of one colour make
    // several runs, or, where columns hide all but one, sit at a few fixed heights)
    const oneRun = (t: Mark) => {
      let ok = 0, seen = 0;
      const heights = new Set<number>();
      for (let i = 0; i < 24; i++) {
        const x = Math.round(t.b[0] + ((i + 0.5) / 24) * width(t.b)), ys: number[] = [];
        for (let y = Math.floor(t.b[1]); y < t.b[3]; y++) if (sameColor(keyAt(img, x, y), t.key)) ys.push(y);
        if (!ys.length) continue;
        seen++; if (ys.every((y, j) => j === 0 || y - ys[j - 1] <= 3)) { ok++; heights.add(Math.round((ys[0] + ys[ys.length - 1]) / 4)); }
      }
      return seen >= 8 && ok >= seen * 0.8 && heights.size >= 6;
    };
    // (a flat stretch of the line is solid enough to pass for a sliver of a column: a colour whose "columns" are all a
    // few pixels tall and that forms a long line is the line)
    const slivers = (key: number) => rects.filter((m) => sameColor(m.key, key)).every((m) => height(m.b) <= 4);
    const lines = thin.filter((t) => sat(t.key) >= 3 && (!col.keys!.some((k) => sameColor(k, t.key)) || slivers(t.key)) && width(t.b) >= width(b) * 0.4 && height(t.b) >= Math.max(4, med * 0.5) && oneRun(t)).slice(0, 2);
    const extra = lines.map((t) => {
      const ys = col.at!.map((x0) => {
        for (const dx of [0, -1, 1, -2, 2]) {
          const x = Math.round(x0 + dx), hits: number[] = [];
          for (let y = Math.max(0, Math.floor(b[1])); y < col.base!; y++) if (sameColor(keyAt(img, x, y), t.key)) hits.push(y);
          // (a line crosses a category once: hits spread far apart are gridlines of that colour)
          if (hits.length) return hits[hits.length - 1] - hits[0] <= Math.max(6, med) ? hits.reduce((a, v) => a + v, 0) / hits.length : null;
        }
        return null;
      });
      if (ys.filter((y) => y !== null).length < ys.length * 0.6) return null;
      const known = ys.filter((y): y is number => y !== null), fill = (i: number) => ys[i] ?? known[0];
      // (on a scale of its own: the replica gives a series with its own measure its own axis, as the original has)
      const name = nameOf(t.key) || 'Line';
      return { name, kind: 'line', measure: { name, ...formatOf(name) }, shape: norm100(ys.map((_, i) => col.base! - fill(i))) };
    }).filter(Boolean);
    if (!extra.length) return col;
    const series = (col.fields.series as { name: string; shape: number[] }[]).map((x) => ({ ...x, kind: 'bar' }))
      // (series follow the colours one for one, unless the colours are one series coloured by category)
      .filter((_, i, all) => all.length !== col.keys!.length || !lines.some((t) => sameColor(col.keys![i], t.key)));
    return { ...col, type: 'combo', fields: { ...col.fields, series: [...series, ...extra] } };
  };
  // a KPI: one to three big masked values (numbers are masked by default) and a short label
  // (a table's zebra stripes are not bars: four or more bands of exactly one length, starting at one x, each a row
  // tall with the row's words in its band, under words on a grid. Masked names over a stripe cut it, but the pieces still
  // match. A bar chart's bars, even of equal length, are thinner than a row and labelled beside them.)
  const tol = Math.max(3, width(b) * 0.02);
  const holdsWord = (m: Mark) => words.some((w) => { const y = wordCenter(w)[1]; return y >= m.b[1] && y <= m.b[3]; });
  const stripes = grid && rects.length >= 4 && rects.some((r) => {
    const same = rects.filter((m) => Math.abs(width(m.b) - width(r.b)) <= tol && Math.abs(m.b[0] - r.b[0]) <= tol && height(m.b) >= med * 1.5);
    // (and run across most of the table: equal bars with their labels beside them cover a part of their panel)
    return same.length >= 4 && same.length >= rects.length * 0.8 && same.filter(holdsWord).length >= same.length / 2 && width(r.b) >= width(b) * 0.3;
  });
  const barReading = stripes ? null : bars(c);
  // (the value is large for its card: masked data labels inside a big chart are not KPI values; a card holding a big
  // value, a few words and next to no marks (a coloured delta or arrow at most) is a KPI however tall the grid
  // stretches it)
  const bigH = Math.max(0, ...bigMasked.map((w) => w.h));
  const prominent = bigH >= height(b) * 0.12 || (bigMasked.length >= 1 && coverage < 0.012 && body.length <= 4 && words.length <= 6);
  // (a KPI card has one sparkline at most: two or more long coloured lines are a line chart, whatever its masks look like)
  const lineChart = thin.filter((t) => sat(t.key) >= 3).length >= 2;
  // (a gauge shows its value big in its middle, as a KPI does: its half ring decides first)
  const gaugeReading = gauge(c);
  if (gaugeReading) return done(gaugeReading)!;
  // (a panel whose row marks look like table stripes is a chart or table, not a KPI: its bar reader was suppressed to
  //  let the table path win, and the KPI check must not fire before the table path gets its turn)
  // (solid rectangular marks that collectively cover a significant area are chart bars, not KPI decoration: a KPI's
  //  mini sparkline bars are tiny and cover well under 10% of the card; a full bar or column chart's bars cover 15%+)
  const rectArea = rects.reduce((s, r) => s + width(r.b) * height(r.b), 0);
  const chartRects = rects.length >= 5 && rectArea >= pa * 0.12;
  if (prominent && bigMasked.length <= 3 && words.length <= 18 && !(barReading && rects.length >= 2) && !chartRects && !lineChart && !stripes && coverage < 0.15) return done(kpi(c, 0.85))!;
  // a KPI card with a small chart in it (a sparkline, mini columns, an icon) or with its delta and comparison masked too:
  // a really big value, few words and little ink; a chart's own numbers are never that big for its panel
  // (not a line chart, two or more coloured lines; nor bars across much of the panel)
  const bigBars = !!barReading && rects.length >= 3 && width(hull(rects)) * height(hull(rects)) >= pa * 0.4;
  if (bigH >= height(b) * 0.12 && words.length <= 18 && coverage < 0.12 && !lineChart && !(bigBars || chartRects) && !stripes) return done(kpi(c, 0.7))!;
  // words on a grid make a table, unless the panel also holds coloured strokes or several vivid colours (a table's
  // rules and stripes are grey or one colour): then a line or scatter reading comes first and the table is the fallback
  const table = grid ? { type: 'table' as const, certainty: coverage < 0.05 ? 0.8 : 0.6, fields: {} } : null;
  // a masked table: many words, many masked value boxes, no solid bars and little ink (rows of data with sensitive values)
  // (a real masked table has many hidden value cells relative to its total word count; a text panel has few)
  const maskedTable = !grid && words.length >= 35 && bigMasked.length >= 4 && bigMasked.length >= words.length * 0.20 && rects.length <= 1 && coverage < 0.08
    ? { type: 'table' as const, certainty: 0.65, fields: {} } : null;
  const colourful = vivid.length >= 2 || thin.some((t) => sat(t.key) >= 3);
  // (a waterfall is read before columns: two of its columns may stand on the baseline, but its steps float)
  // (a 100% stack fills a rectangle as a treemap does: its repeated series colours decide)
  const percentBars = barReading && (barReading.fields as { stackedPercent?: boolean }).stackedPercent ? done(combo(barReading)) : null;
  // (a heatmap's cells fill a rectangle as a treemap's tiles do; funnel and
  // Gantt bars float off any baseline)
  // (a heatmap first: its columns of cells reach one height, as a 100% stack's do, but in shades of one colour)
  // (a table whose rows have coloured backgrounds is still a table: stripes being true already suppressed the bar reader,
  //  and the colour from the row banding must not let lines() fire ahead of the table reader)
  return done(heatmap(c)) || percentBars || done(funnel(c)) || done(gantt(c)) || done(pie(c)) || done(treemap(c)) || done(map(c)) || done(waterfall(c)) || done(combo(barReading)) || (maskedTable ? done(maskedTable) : (table && (!colourful || stripes) ? done(table) : null))
    // (boxes scattered about, joined by a stroke or two and not standing on any baseline: a decomposition tree, an
    //  org chart, a diagram. Saying so is truer than drawing a line chart that is not there.)
    || (rects.length >= 8 && !barReading && thin.length <= 3 && coverage < 0.06
      ? done({ type: "placeholder", certainty: 0.35, fields: { originalType: "chart" } })! : null)
    || done(scatter(c))
    // (very-low-ink, no-grid panels with many words and few masked values are prose text — grey separator lines from
    //  panel borders create thin marks that fool lines(); a masked chart has many masked axis-label boxes)
    || (coverage < 0.015 && words.length >= 25 && !lineChart && !grid && bigMasked.length < words.length * 0.20 ? done({ type: 'text', certainty: 0.5, fields: {} })! : null)
    || done(lines(c)) || done(table)
    || (prominent && words.length <= 24 ? done(kpi(c, 0.5))! : null)
    || (coverage < 0.05 && words.length >= 6 ? done({ type: 'text', certainty: 0.5, fields: {} })! : null)
    || done(bestGuess())
    || done({ type: 'placeholder', certainty: 0.2, fields: { originalType: coverage > 0.1 ? 'chart' : 'visual' } })!;

  // a chart no reader could type, with marks enough to draw: columns (the commonest chart) from its largest marks, left to
  // right, at a low certainty, so the replica shows a chart and the confidence score asks the user to check its type
  function bestGuess(): Reading | null {
    if (coverage <= 0.1) return null;
    const ms = [...body].sort((p, q) => q.n - p.n).slice(0, 8).sort((p, q) => p.b[0] - q.b[0]);
    if (ms.length < 2) return null;
    const base = Math.max(...ms.map((m) => m.b[3]));
    const members = axisLabels(words, ms.map((m) => ({ lo: m.b[0], hi: m.b[2] })), 'x', [base - 2, base + med * 4], med);
    return { type: 'column', certainty: 0.3, guess: true, fields: { dimension: { name: dName || 'Category', members }, measure, series: [{ name: measure.name, shape: norm100(ms.map((m) => height(m.b))) }] } };
  }
}
