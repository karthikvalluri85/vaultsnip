// Prototype of a key-free layout pipeline (developer tool; nothing here ships yet):
//   1. panels  : recursive cuts along empty gutters, with each card's own fill colour as a new background
//   2. type    : SigLIP + CLIP zero-shot on each panel crop, plus geometry and text checks (KPI, table, bar vs column)
//   3. title   : the topmost line of OCR words in the panel that VaultSnip's masking rules keep
// and a scorer against hand annotations (tools/eval-vision/bench/truth.json).
//
//   node tools/eval-vision/pipeline.mjs <bench dir with images and run/*.ocr.json> [--only id1,id2]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline as hfPipeline, RawImage } from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- 1. panels ---------- */

const key = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
/** Most common colour (16 levels per channel) in a region of the image. */
function dominant(img, x0, y0, x1, y1, step = 3) {
  const counts = new Map(); const { data, width, channels } = img;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = (y * width + x) * channels; const k = key(data[i], data[i + 1], data[i + 2]); counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = 0, bk = 0, total = 0; for (const [k, n] of counts) { total += n; if (n > best) { best = n; bk = k; } }
  return { color: [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8], share: best / Math.max(1, total) };
}

/** RGB image with any transparency laid on white (transparent margins must not count as content). */
export function flatten(img) {
  if (img.channels !== 4) return img.channels === 3 ? img : img.rgb();
  const { data, width, height } = img, out = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { const a = data[i + 3] / 255; out[j] = data[i] * a + 255 * (1 - a); out[j + 1] = data[i + 1] * a + 255 * (1 - a); out[j + 2] = data[i + 2] * a + 255 * (1 - a); }
  return new RawImage(out, width, height, 3);
}

/**
 * Edge map: a pixel is "ink" where it differs sharply from its right or lower neighbour. Smooth backgrounds (flat,
 * gradient, card fills) have no edges, so gutters between visuals are empty whatever the design; card borders, text,
 * axes and marks are edges.
 */
export function edges(img, T = 22) {
  const { data, width: W, height: H } = img, e = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = (y * W + x) * 3, r = i + 3, d = i + W * 3;
    const dx = Math.max(Math.abs(data[i] - data[r]), Math.abs(data[i + 1] - data[r + 1]), Math.abs(data[i + 2] - data[r + 2]));
    const dy = Math.max(Math.abs(data[i] - data[d]), Math.abs(data[i + 1] - data[d + 1]), Math.abs(data[i + 2] - data[d + 2]));
    if (dx > T || dy > T) e[y * W + x] = 1;
  }
  return e;
}

/**
 * Panels by recursive XY-cut on the edge map: the widest empty horizontal or vertical gutter splits a region, until no
 * gutter is left. Card borders do not block a cut inside the card: a cut only needs the inside to be empty, and a
 * region's own border lines are trimmed first. Returns boxes [x0, y0, x1, y1].
 */
export function findPanels(img, opts = {}) {
  const W = img.width, H = img.height, e = edges(img, opts.threshold ?? 12);
  const minGap = Math.max(5, Math.round(Math.min(W, H) * (opts.gapFrac ?? 0.011)));
  const out = [];
  const rowInk = (x0, x1, y) => { let n = 0; for (let x = x0; x < x1; x++) n += e[y * W + x]; return n; };
  const colInk = (y0, y1, x) => { let n = 0; for (let y = y0; y < y1; y++) n += e[y * W + x]; return n; };
  // a straight line spanning most of the region (a card border or rule) is a frame, not content
  const isRule = (n, len) => n > len * 0.85;
  function trim(x0, y0, x1, y1) {
    const w = x1 - x0, h = y1 - y0;
    const emptyRow = (y) => { const n = rowInk(x0, x1, y); return n <= 1 || isRule(n, w); };
    const emptyCol = (x) => { const n = colInk(y0, y1, x); return n <= 1 || isRule(n, h); };
    while (y0 < y1 - 1 && emptyRow(y0)) y0++; while (y1 - 1 > y0 && emptyRow(y1 - 1)) y1--;
    while (x0 < x1 - 1 && emptyCol(x0)) x0++; while (x1 - 1 > x0 && emptyCol(x1 - 1)) x1--;
    return [x0, y0, x1, y1];
  }
  function bestGap(prof, len) {
    const tol = 2; let best = null, s = -1;   // a gutter is truly empty: borders crossing it block it
    for (let i = 0; i <= prof.length; i++) {
      const empty = i < prof.length && (prof[i] <= tol || isRule(prof[i], len));
      if (empty && s < 0) s = i;
      if (!empty && s >= 0) { if (s > 0 && i < prof.length && i - s >= minGap && (!best || i - s > best[1] - best[0])) best = [s, i]; s = -1; }
    }
    return best;
  }
  // the full tree of cuts; a node remembers whether border lines framed it (a card)
  function cut(x0, y0, x1, y1, depth) {
    const raw = [x0, y0, x1, y1];
    [x0, y0, x1, y1] = trim(x0, y0, x1, y1);
    const w = x1 - x0, h = y1 - y0;
    if (w < 12 || h < 8) return null;
    // framed: rule lines were trimmed on two opposite sides
    const framed = (y0 - raw[1] > 0 && raw[3] - y1 > 0 && isRule(rowInk(x0, x1, Math.max(raw[1], y0 - 1)), w) && isRule(rowInk(x0, x1, Math.min(raw[3] - 1, y1)), w))
      || (x0 - raw[0] > 0 && raw[2] - x1 > 0 && isRule(colInk(y0, y1, Math.max(raw[0], x0 - 1)), h) && isRule(colInk(y0, y1, Math.min(raw[2] - 1, x1)), h));
    const node = { b: framed ? raw : [x0, y0, x1, y1], inner: [x0, y0, x1, y1], framed, kids: null, axis: null };
    if (depth > 14) return node;
    const py = Array.from({ length: h }, (_, i) => rowInk(x0, x1, y0 + i)), px = Array.from({ length: w }, (_, i) => colInk(y0, y1, x0 + i));
    const gy = bestGap(py, w), gx = bestGap(px, h);
    if (!gy && !gx) return node;
    if (gy && (!gx || gy[1] - gy[0] >= gx[1] - gx[0])) { const m = y0 + Math.round((gy[0] + gy[1]) / 2); node.axis = 'y'; node.kids = [cut(x0, y0, x1, m, depth + 1), cut(x0, m, x1, y1, depth + 1)].filter(Boolean); }
    else { const m = x0 + Math.round((gx[0] + gx[1]) / 2); node.axis = 'x'; node.kids = [cut(x0, y0, m, y1, depth + 1), cut(m, y0, x1, y1, depth + 1)].filter(Boolean); }
    if (!node.kids.length) node.kids = null;
    return node;
  }
  const areaOf = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const page = W * H;
  // leaves of a subtree, to judge whether a node's content is several sizeable visuals or one visual in pieces
  const leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n]);
  const substantialParts = (n, frac) => {
    // the largest pieces at the first level where the node splits into more than one sizeable part
    const big = (n.kids || []).filter((k) => areaOf(k.b) >= areaOf(n.inner) * frac);
    return big.length;
  };
  function select(n) {
    const a = areaOf(n.b);
    if (!n.kids) { out.push(n.b); return; }
    // a card is one visual unless it holds at least two sizeable parts (each >= 20% of the card)
    if (n.framed && a < page * 0.5 && substantialParts(n, 0.2) < 2) { out.push(n.b); return; }
    // a region of moderate size whose top or bottom cut only peels off a thin strip (title, legend, axis labels) is one
    // visual; side-by-side cuts never count, so a row of tiles is not mistaken for one visual with a sliver
    const hgt = (b) => b[3] - b[1];
    const thin = n.axis === 'y' && n.kids.length === 2 && Math.min(...n.kids.map((k) => hgt(k.b))) < hgt(n.b) * 0.25;
    if (a <= page * 0.4 && thin && leaves(n).length <= 12) { out.push(n.b); return; }
    n.kids.forEach(select);
  }
  const root = cut(0, 0, W, H, 0);
  if (root) select(root);
  return out;
}

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const wordsIn = (words, b) => words.filter((w) => inside([w.x + w.w / 2, w.y + w.h / 2], b));

/**
 * Turns raw cut regions into panels: text-only strips (titles, legends, axis labels) join the region below or above them;
 * a region with a big number stays on its own (a KPI); tiny specks are dropped.
 */
export function assemblePanels(regions, words, W, H) {
  const med = words.length ? [...words].sort((a, b) => a.h - b.h)[Math.floor(words.length / 2)].h : 12;
  let ps = regions.filter((b) => area(b) > W * H * 0.0008 && (b[2] - b[0]) > 6 && (b[3] - b[1]) > 6).map((b) => ({ b: [...b], words: wordsIn(words, b) }));
  const textOnly = (p) => {
    if (!p.words.length) return false;
    const cover = p.words.reduce((a, w) => a + w.w * w.h, 0) / area(p.b);
    const big = p.words.some((w) => w.h > med * 1.9);
    return !big && ((p.b[3] - p.b[1]) < med * 4.5 || cover > 0.35);
  };
  // join text strips to the nearest overlapping panel below (titles) or above (axis labels, legends under charts)
  for (let pass = 0; pass < 3; pass++) {
    const strips = ps.filter(textOnly);
    for (const s of strips) {
      if (!ps.includes(s)) continue;
      const overlapX = (p) => Math.max(0, Math.min(p.b[2], s.b[2]) - Math.max(p.b[0], s.b[0])) / Math.min(p.b[2] - p.b[0], s.b[2] - s.b[0]);
      const cand = ps.filter((p) => p !== s && overlapX(p) > 0.5 && !textOnly(p)).map((p) => ({ p, gap: p.b[1] >= s.b[3] ? p.b[1] - s.b[3] : s.b[1] >= p.b[3] ? (s.b[1] - p.b[3]) * 1.5 : Infinity }))
        .filter((c) => c.gap < Math.max(med * 6, H * 0.06)).sort((a, b) => a.gap - b.gap);
      if (!cand.length) continue;
      const t = cand[0].p; t.b = [Math.min(t.b[0], s.b[0]), Math.min(t.b[1], s.b[1]), Math.max(t.b[2], s.b[2]), Math.max(t.b[3], s.b[3])]; t.words = wordsIn(words, t.b);
      ps = ps.filter((p) => p !== s);
    }
  }
  // drop panels inside others (nested remains of a card)
  ps = ps.filter((p) => !ps.some((q) => q !== p && area(q) > area(p) && inside(center(p.b), q.b) && area(p) < area(q) * 0.25 && !p.words.some((w) => w.h > med * 1.9)));
  return ps.filter((p) => area(p.b) > W * H * 0.004 || p.words.some((w) => w.h > med * 1.9)).map((p) => ({ ...p, med }));
}

/* ---------- 2. type ---------- */

export const LABELS = {
  kpi: 'a KPI card on a dashboard showing one large number with a small label',
  column: 'a column chart with vertical bars',
  bar: 'a horizontal bar chart',
  line: 'a line chart with a line over time',
  area: 'an area chart with a filled area under a line',
  pie: 'a pie or donut chart',
  table: 'a data table with rows and columns of text',
  map: 'a map with shaded regions',
  scatter: 'a scatter plot of dots',
  treemap: 'a treemap of nested rectangles',
  text: 'a paragraph of text',
};
const NAMES = Object.keys(LABELS), TEXTS = Object.values(LABELS);

let models = null;
async function loadModels() {
  models ??= await Promise.all([
    hfPipeline('zero-shot-image-classification', 'Xenova/siglip-base-patch16-224', { dtype: 'quantized', device: 'cpu' }).then((m) => ({ m, t: 'This is a photo of {}.' })),
    hfPipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { dtype: 'quantized', device: 'cpu' }).then((m) => ({ m, t: 'a screenshot of {}' })),
  ]);
  return models;
}

/** Bars or columns: long horizontal runs of saturated colour mean horizontal bars. */
function orientation(img, b) {
  const { data, width, channels } = img; let hRuns = 0, hLen = 0, vRuns = 0, vLen = 0;
  const sat = (x, y) => { const i = (y * width + x) * channels; const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]); return mx - mn > 40 || mx < 90; };
  for (let y = b[1]; y < b[3]; y += 3) { let run = 0; for (let x = b[0]; x < b[2]; x++) { if (sat(x, y)) run++; else { if (run > 3) { hRuns++; hLen += run; } run = 0; } } }
  for (let x = b[0]; x < b[2]; x += 3) { let run = 0; for (let y = b[1]; y < b[3]; y++) { if (sat(x, y)) run++; else { if (run > 3) { vRuns++; vLen += run; } run = 0; } } }
  const mh = hRuns ? hLen / hRuns : 0, mv = vRuns ? vLen / vRuns : 0;
  return mh > mv * 1.15 ? 'bar' : 'column';
}

/** Words laid out as a grid: at least 4 lines and 2 aligned columns. */
function looksLikeTable(ws, med) {
  if (ws.length < 10) return false;
  const lines = []; for (const w of [...ws].sort((a, b) => a.y - b.y)) { const l = lines.find((l) => Math.abs(l.y - w.y) < med * 0.6); if (l) l.ws.push(w); else lines.push({ y: w.y, ws: [w] }); }
  const multi = lines.filter((l) => l.ws.length >= 2);
  if (multi.length < 4) return false;
  const starts = multi.flatMap((l) => l.ws.map((w) => Math.round(w.x / (med * 2))));
  const counts = {}; starts.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
  return Object.values(counts).filter((n) => n >= Math.max(3, multi.length * 0.6)).length >= 2;
}

export async function classify(img, p) {
  const [siglip, clip] = await loadModels();
  const crop = await img.crop([Math.max(0, p.b[0]), Math.max(0, p.b[1]), Math.min(img.width - 1, p.b[2]), Math.min(img.height - 1, p.b[3])]);
  const score = {}; NAMES.forEach((n) => { score[n] = 0; });
  for (const { m, t } of [siglip, clip]) {
    const out = await m(crop, TEXTS, { hypothesis_template: t });
    const sum = out.reduce((a, o) => a + o.score, 0) || 1;
    out.forEach((o) => { score[NAMES[TEXTS.indexOf(o.label)]] += o.score / sum / 2; });
  }
  let type = NAMES.reduce((a, b) => (score[b] > score[a] ? b : a));
  const med = p.med, big = p.words.some((w) => w.h > med * 1.9);
  // text checks the image models cannot make
  if (big && p.words.length <= 18 && !looksLikeTable(p.words, med)) type = 'kpi';
  else if (looksLikeTable(p.words, med) && ['table', 'text', 'bar', 'kpi'].includes(type)) type = 'table';
  if (type === 'bar' || type === 'column') type = orientation(img, p.b);
  return { type, score };
}

/* ---------- 3. title ---------- */

export function title(p) {
  const kept = p.words.filter((w) => w.kept);
  if (!kept.length) return '';
  const top = Math.min(...kept.map((w) => w.y));
  const band = kept.filter((w) => w.y - top < p.med * 0.8 && w.y < p.b[1] + (p.b[3] - p.b[1]) * 0.45).sort((a, b) => a.x - b.x);
  return band.map((w) => w.text).join(' ');
}

/* ---------- scoring ---------- */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
const LENIENT = { combo: ['column', 'line', 'bar'], pie: ['pie'], area: ['area', 'line'], line: ['line', 'area'], waterfall: ['column'], column: ['column'], bar: ['bar'] };
export function sameType(got, want, lenient) { return got === want || (lenient && (LENIENT[want] || []).includes(got)); }

export function scoreDashboard(dash, panels, keptWords) {
  const truths = dash.visuals.map((v) => ({ ...v, hit: null }));
  const counted = panels.filter((p) => !(dash.ignore || []).some((g) => inside(center(p.b), g)));
  // a prediction matches a true visual when each one's centre lies inside the other's box
  for (const p of counted) {
    const t = truths.find((t) => !t.hit && inside(center(p.b), t.bbox) && inside(center(t.bbox), p.b));
    if (t) t.hit = p;
  }
  const hits = truths.filter((t) => t.hit);
  const keptSet = new Set(keptWords.map((w) => norm(w.text)).filter(Boolean));
  const titled = hits.filter((t) => norm(t.title).split(' ').some((w) => keptSet.has(w)));
  const titleOk = titled.filter((t) => { const want = norm(t.title).split(' ').filter((w) => keptSet.has(w)); const got = new Set(norm(t.hit.title).split(' ')); return want.filter((w) => got.has(w)).length >= Math.ceil(want.length * 0.5); });
  return {
    visuals: truths.length, found: hits.length, predicted: counted.length,
    typeStrict: hits.filter((t) => sameType(t.hit.type, t.type, false)).length, typeLenient: hits.filter((t) => sameType(t.hit.type, t.type, true)).length,
    titles: `${titleOk.length}/${titled.length}`, misses: truths.filter((t) => !t.hit).map((t) => t.title),
    wrongTypes: hits.filter((t) => !sameType(t.hit.type, t.type, true)).map((t) => `${t.title}: ${t.type}→${t.hit.type}`),
  };
}

/* ---------- main ---------- */

if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const bench = process.argv[2];
  const truth = JSON.parse(await readFile(join(here, 'bench', 'truth.json'), 'utf8'));
  const only = (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '').split(',').filter(Boolean);
  const rows = [], oracle = [], details = {};
  for (const dash of truth.dashboards.filter((d) => !only.length || only.includes(d.id))) {
    const folder = dash.tool === 'Power BI' ? 'powerbi' : dash.tool.toLowerCase();
    const file = { 'sample-it-spend_it3': 'sample-it-spend_it3.png', 'sample-procurement_discount-analysis': 'sample-procurement_discount-analysis.png', 'sample-human-resources_hr-3': 'sample-human-resources_hr-3.png', 'sample-procurement_spend-overview': 'sample-procurement_spend-overview.png', 'FinanceDashboard': 'FinanceDashboard.png', 'ClinicPerformanceDashboard': 'ClinicPerformanceDashboard.png', 'KPI-Progress-Status': 'KPI-Progress-Status.png', 'HRAnalytics': 'HRAnalytics.png', 'new-dashboard-example-2206': 'new-dashboard-example-2206.png', 'looker-tabbed-dashboard-example': 'looker-tabbed-dashboard-example.png', 'add-text-results-2218': 'add-text-results-2218.png' }[dash.id];
    const img = flatten(await RawImage.read(join(bench, folder, file)));
    const ocr = JSON.parse(await readFile(join(bench, 'run', dash.id + '.ocr.json'), 'utf8'));
    const k = img.width / ocr.width;
    const words = ocr.words.map((w) => ({ ...w, x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k }));
    const t0 = Date.now();
    const panels = assemblePanels(findPanels(img), words, img.width, img.height);
    for (const p of panels) { Object.assign(p, await classify(img, p)); p.title = title(p); }
    const s = scoreDashboard(dash, panels, words.filter((w) => w.kept));
    rows.push({ dashboard: dash.id.slice(0, 26), tool: dash.tool, ...s, seconds: Math.round((Date.now() - t0) / 1000) });
    // oracle: classify the true panels, to see the classifier apart from panel finding
    const med = words.length ? [...words].sort((a, b) => a.h - b.h)[Math.floor(words.length / 2)].h : 12;
    let ok = 0, okL = 0; const wrong = [];
    for (const v of dash.visuals) { const r = await classify(img, { b: v.bbox, words: wordsIn(words, v.bbox), med }); if (sameType(r.type, v.type, false)) ok++; if (sameType(r.type, v.type, true)) okL++; else wrong.push(`${v.title}: ${v.type}→${r.type}`); }
    oracle.push({ dashboard: dash.id.slice(0, 26), tool: dash.tool, visuals: dash.visuals.length, typeStrict: ok, typeLenient: okL, wrong: wrong.join('; ').slice(0, 160) });
    details[dash.id] = panels.map((p) => ({ box: p.b.map(Math.round), type: p.type, title: p.title }));
    console.log(`${dash.id}: ${panels.length} panels, found ${s.found}/${s.visuals}, types ${s.typeLenient}/${s.found}, titles ${s.titles}`);
  }
  console.log('\nEND TO END (panels found by the pipeline)'); console.table(rows.map(({ misses, wrongTypes, ...r }) => r));
  console.log('ORACLE (classifier on the true panels)'); console.table(oracle.map(({ wrong, ...r }) => r));
  const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
  console.log(`TOTAL end-to-end: found ${sum(rows, 'found')}/${sum(rows, 'visuals')} visuals, ${sum(rows, 'predicted')} panels predicted, types ${sum(rows, 'typeLenient')}/${sum(rows, 'found')} (strict ${sum(rows, 'typeStrict')})`);
  console.log(`TOTAL oracle: types ${sum(oracle, 'typeLenient')}/${sum(oracle, 'visuals')} lenient, ${sum(oracle, 'typeStrict')} strict`);
  await writeFile(join(bench, 'run', 'pipeline-results.json'), JSON.stringify({ rows, oracle, details }, null, 2));
}
