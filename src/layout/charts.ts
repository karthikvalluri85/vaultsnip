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
import { bySeries, findMarks, inkTest, isTextSpeck, sameColor, splitColumns, type Mark } from './marks';

export type ChartType = 'kpi' | 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'treemap' | 'map' | 'table' | 'text' | 'placeholder';

export interface Reading {
  type: ChartType;
  /** 0-1: how clearly the evidence pointed to this type (an input for the confidence score). */
  certainty: number;
  /** Visual fields in the replica spec's shape (dimension, series, points…), without id, span or title. */
  fields: Record<string, unknown>;
  /** Main mark colour, for the page theme. */
  color?: string;
}

const round = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const norm100 = (xs: number[]) => { const m = Math.max(...xs, 1e-9); return xs.map((x) => round((x / m) * 100)); };
const text = (ws: Word[]) => ws.filter((w) => w.kept && w.text).sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.text).join(' ').trim();

/** Words on one text line, left to right, as phrases split at wide gaps. */
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
  const sortedGaps = [...gaps].sort((a, b) => a - b), split = (sortedGaps[0] + sortedGaps[sortedGaps.length - 1]) / 2;
  if (sortedGaps[sortedGaps.length - 1] - sortedGaps[0] < 3) return clusters;
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
function axisLabels(words: Word[], cats: { lo: number; hi: number }[], along: 'x' | 'y', band: [number, number], med: number) {
  const ws = words.filter((w) => { const [cx, cy] = wordCenter(w); const v = along === 'x' ? cy : cx; return v >= band[0] && v <= band[1]; });
  return cats.map((c, i) => {
    const pad = Math.max(med * 0.6, (c.hi - c.lo) * 0.25);
    const here = ws.filter((w) => { const [cx, cy] = wordCenter(w); const v = along === 'x' ? cx : cy; return v >= c.lo - pad && v <= c.hi + pad; });
    const t = here.length && here.every((w) => w.kept && w.text) ? text(here) : '';
    return t || `Item ${i + 1}`;
  });
}

interface Ctx {
  img: Img; b: Box; words: Word[]; med: number; title: string;
  ink: (x: number, y: number) => boolean;
  body: Mark[]; rects: Mark[]; thin: Mark[]; markArea: number; coverage: number;
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
  const slices = runs.filter((s) => s.n >= 3);
  if (!slices.length) return null;
  const members = slices.map((s, i) => c.nameOf(s.key) || `Item ${i + 1}`);
  return { type: donut ? 'donut' : 'pie', certainty: Math.min(1, (ringF - cornerF) * 1.1),
    fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series: [{ name: c.measure.name, shape: norm100(slices.map((s) => s.n)) }] } };
}

/** Columns or bars: solid rectangles of one thickness sharing a baseline. */
function bars(c: Ctx): Reading | null {
  const rs = c.rects.filter((m) => m.n >= 20);
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
  const vert = bottom.n >= Math.max(2, rs.length * 0.5) && cv(rs.map((m) => width(m.b))) < 0.35;
  const horiz = left.n >= Math.max(2, rs.length * 0.5) && cv(rs.map((m) => height(m.b))) < 0.35;
  if (!vert && !horiz) return null;
  const isCol = vert && (!horiz || bottom.n > left.n || (bottom.n === left.n && height(hull(rs)) >= width(hull(rs))));
  const on = rs.filter((m) => (isCol ? atBottom(m, bottom.at) || rs.some((o) => o !== m && Math.abs(o.b[1] - m.b[3]) <= 2) : atLeft(m, left.at) || rs.some((o) => o !== m && Math.abs(o.b[2] - m.b[0]) <= 2)));
  const keys = bySeries(on).slice(0, 6);
  const cats = (isCol ? categories(on, (m) => m.b[0], (m) => m.b[2], keys.length > 1) : categories(on, (m) => m.b[1], (m) => m.b[3], keys.length > 1)).slice(0, 30);
  if (cats.length < 2) return null;
  const touches = (m: Mark, o: Mark) => (isCol ? Math.abs(m.b[3] - o.b[1]) <= 2 || Math.abs(o.b[3] - m.b[1]) <= 2 : Math.abs(m.b[2] - o.b[0]) <= 2 || Math.abs(o.b[2] - m.b[0]) <= 2);
  const stacked = keys.length > 1 && cats.some((k) => k.ms.some((m) => k.ms.some((o) => o !== m && !sameColor(m.key, o.key) && touches(m, o))));
  const len = (m: Mark) => (isCol ? height(m.b) : width(m.b));
  const raw = keys.map((k) => cats.map((cat) => cat.ms.filter((m) => sameColor(m.key, k.key)).reduce((a, m) => a + len(m), 0)));
  const max = Math.max(...raw.flat(), 1e-9);
  const members = isCol
    ? axisLabels(c.words, cats, 'x', [bottom.at - 2, bottom.at + c.med * 4], c.med)
    : axisLabels(c.words, cats, 'y', [c.b[0], left.at + 2], c.med);
  const series = keys.map((k, i) => ({ name: c.nameOf(k.key) || (keys.length === 1 ? c.measure.name : `Series ${i + 1}`), shape: raw[i].map((v) => round((v / max) * 100)) }));
  const strength = (isCol ? bottom.n : left.n) / rs.length;
  return { type: isCol ? 'column' : 'bar', certainty: Math.min(1, 0.45 + strength * 0.5),
    fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series, stacked, ...(isCol ? {} : { horizontal: true }) } };
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
  const below = phrases(c.words.filter((w) => w.y >= yBot - c.med * 0.5 && w.y <= yBot + c.med * 4 && w.x + w.w >= x0 - c.med * 3 && w.x <= x1 + c.med * 3), c.med);
  const useLabels = below.length >= 3 && below.length <= 40;
  const xs = useLabels ? below.map((p) => (p.x0 + p.x1) / 2) : Array.from({ length: 12 }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / 12);
  const members = useLabels ? below.map((p, i) => (p.ws.every((w) => w.kept && w.text) ? p.ws.map((w) => w.text).join(' ') : `Item ${i + 1}`)) : xs.map((_, i) => `Item ${i + 1}`);
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
  const series = use.map((s, i) => {
    const got = ys[i];
    const filled = got.map((y, j) => (Number.isFinite(y) ? y : got.slice(0, j).reverse().find(Number.isFinite) ?? got.find(Number.isFinite) ?? yBot));
    return { name: c.nameOf(s.key) || (use.length === 1 ? c.measure.name : `Series ${i + 1}`), shape: filled.map((y) => round(((floor - y) / (floor - yTop)) * 100)) };
  });
  const longest = Math.max(...ms.map((m) => width(m.b))) / Math.max(1, width(c.plot));
  return { type: isArea ? 'area' : 'line', certainty: Math.min(0.9, 0.4 + longest * 0.5),
    fields: { dimension: { name: c.dName || 'Period', members }, measure: c.measure, series, ...(isArea && use.length > 1 ? { stacked: true } : {}) } };
}

/** Scatter or bubble: many small solid dots. */
function scatter(c: Ctx): Reading | null {
  const dots = c.body.filter((m) => Math.max(width(m.b), height(m.b)) < Math.min(width(c.b), height(c.b)) * 0.08 && m.fill > 0.45 && Math.abs(width(m.b) - height(m.b)) <= Math.max(2, width(m.b) * 0.4));
  if (dots.length < 8 || dots.length < c.body.length * 0.5) return null;
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
  const regions = c.body.filter((m) => !thinSet.has(m) && m.fill >= 0.12 && m.fill < 0.8 && m.n >= pa * 0.0003 && Math.min(width(m.b), height(m.b)) >= 3);
  // (solid rectangles among the marks themselves: the column splitting behind c.rects slices irregular regions too)
  const solid = c.body.filter((m) => m.fill >= 0.85).length;
  const asMap = { type: 'map' as const, certainty: 0.55, fields: { basemap: 'world', mapKind: 'filled', dimension: { name: c.dName || 'Region', members: [] }, measure: c.measure, series: [{ name: c.measure.name, shape: [] }] } };
  // neighbouring regions in close shades join into one mark: one large irregular mark holding many shades is a map too
  // (an area chart's fill is one colour)
  // (not bars that touch, which the bar reader finds on a shared baseline, nor a pie, which is round and evenly filled)
  const round = (m: Mark) => { const r = width(m.b) / Math.max(1, height(m.b)); return r > 0.85 && r < 1.18 && m.fill > 0.68; };
  if (c.thin.length <= 2 && !bars(c) && c.body.some((m) => m.n >= pa * 0.08 && m.fill >= 0.15 && m.fill < 0.85 && m.colors >= 4 && !round(m))) return asMap;
  if (regions.length < 6 || c.thin.length > 2 || solid > regions.length * 0.5) return null;
  if (regions.reduce((a, m) => a + m.n, 0) < pa * 0.08) return null;
  // neighbouring regions share borders: most of them touch another
  const touch = (a: Mark, b: Mark) => a.b[0] <= b.b[2] + 2 && b.b[0] <= a.b[2] + 2 && a.b[1] <= b.b[3] + 2 && b.b[1] <= a.b[3] + 2;
  if (regions.filter((m) => regions.some((o) => o !== m && touch(m, o))).length < regions.length * 0.6) return null;
  return asMap;
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
  const tiles = [...rs].sort((a, b) => b.n - a.n).slice(0, 20);
  const members = tiles.map((t, i) => {
    const ws = c.words.filter((w) => { const [x, y] = wordCenter(w); return x >= t.b[0] && x <= t.b[2] && y >= t.b[1] && y <= t.b[3]; });
    const ph = phrases(ws, c.med)[0];
    return ph && ph.ws.every((w) => w.kept && w.text) ? ph.ws.map((w) => w.text).join(' ') : `Item ${i + 1}`;
  });
  return { type: 'treemap', certainty: Math.min(1, tiled), fields: { dimension: { name: c.dName || 'Category', members }, measure: c.measure, series: [{ name: c.measure.name, shape: norm100(tiles.map((t) => t.n)) }] } };
}

function kpi(c: Ctx, certainty: number): Reading {
  const small = c.words.filter((w) => !isBigBox(w, c.med) && w.y < c.b[1] + height(c.b) * 0.75);
  const top = small.length ? Math.min(...small.map((w) => w.y)) : 0;
  const label = text(small.filter((w) => w.kept && Math.abs(w.y - top) < c.med * 0.8));
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
  const pieces = body.filter((m) => !thin.includes(m) && m.fill < 0.35 && m.n / Math.max(width(m.b), height(m.b)) <= 6);
  for (const s of bySeries(pieces)) {
    if (s.marks.length < 2 || thin.some((t) => sameColor(t.key, s.key))) continue;
    const u = hull(s.marks);
    if (width(u) < width(b) * 0.4) continue;
    thin.push({ key: s.key, b: u, n: s.n, fill: s.n / Math.max(1, width(u) * height(u)), cx: (u[0] + u[2]) / 2, cy: (u[1] + u[3]) / 2, colors: 1 });
  }
  // solid rectangles, with touching dense columns split apart first (a block of columns of nearly one height, joined by
  // 1 px separators of a lighter shade, is solid too, so every mark is tried)
  const rects = body.flatMap((m) => { const parts = splitColumns(img, m, ink); return parts.length > 1 ? parts : m.fill >= 0.8 ? [m] : []; })
    .filter((m) => m.fill >= 0.8 && Math.min(width(m.b), height(m.b)) >= 3);
  Object.assign(features, { coverage: Math.round(coverage * 1000) / 1000, marks: body.length, rects: rects.length, thin: thin.length, series: series.length, words: words.length, bigMasked: bigMasked.length, grid: grid ? 1 : 0, swatches: swatches.length, vivid: vivid.length });
  const c: Ctx = { img, b, words, med, title, ink, body, rects, thin, markArea, coverage, nameOf, measure, dName, plot: plotBox(b, words, med) };
  const done = (r: Reading | null) => (r ? { ...r, color } : null);

  // a KPI: one to three big masked values (numbers are masked by default) and a short label
  // (a table's zebra stripes are not bars: four or more bands of exactly one length, starting at one x, each a row
  // tall with the row's words in its band, under words on a grid. Masked names over a stripe cut it, but the pieces still
  // match. A bar chart's bars, even of equal length, are thinner than a row and labelled beside them.)
  const tol = Math.max(3, width(b) * 0.02);
  const holdsWord = (m: Mark) => words.some((w) => { const y = wordCenter(w)[1]; return y >= m.b[1] && y <= m.b[3]; });
  const stripes = grid && rects.length >= 4 && rects.some((r) => {
    const same = rects.filter((m) => Math.abs(width(m.b) - width(r.b)) <= tol && Math.abs(m.b[0] - r.b[0]) <= tol && height(m.b) >= med * 1.5);
    return same.length >= 4 && same.length >= rects.length * 0.8 && same.filter(holdsWord).length >= same.length / 2;
  });
  const barReading = stripes ? null : bars(c);
  // (the value is large for its card: masked data labels inside a big chart are not KPI values; a card holding a big
  // value, a few words and next to no marks (a coloured delta or arrow at most) is a KPI however tall the grid
  // stretches it)
  const bigH = Math.max(0, ...bigMasked.map((w) => w.h));
  const prominent = bigH >= height(b) * 0.12 || (bigMasked.length >= 1 && coverage < 0.012 && body.length <= 4 && words.length <= 6);
  // (a KPI card has one sparkline at most: two or more long coloured lines are a line chart, whatever its masks look like)
  const lineChart = thin.filter((t) => sat(t.key) >= 3).length >= 2;
  if (prominent && bigMasked.length <= 3 && words.length <= 18 && !(barReading && rects.length >= 3) && !lineChart) return done(kpi(c, 0.85))!;
  // words on a grid make a table, unless the panel also holds coloured strokes or several vivid colours (a table's
  // rules and stripes are grey or one colour): then a line or scatter reading comes first and the table is the fallback
  const table = grid ? { type: 'table' as const, certainty: coverage < 0.05 ? 0.8 : 0.6, fields: {} } : null;
  const colourful = vivid.length >= 2 || thin.some((t) => sat(t.key) >= 3);
  return done(pie(c)) || done(treemap(c)) || done(map(c)) || done(barReading) || (table && !colourful ? done(table) : null)
    || done(lines(c)) || done(scatter(c)) || done(table)
    || (prominent && words.length <= 24 ? done(kpi(c, 0.5))! : null)
    || (coverage < 0.05 && words.length >= 6 ? done({ type: 'text', certainty: 0.5, fields: {} })! : null)
    || done({ type: 'placeholder', certainty: 0.2, fields: { originalType: coverage > 0.1 ? 'chart' : 'visual' } })!;
}
