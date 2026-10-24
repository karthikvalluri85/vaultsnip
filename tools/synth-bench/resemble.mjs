// How closely the on-device replica resembles the original (developer tool): on the generated dashboards, whose truth
// records every visual's box, title, categories, values and series colour, each visual the builder found is compared
// with its original. Run tools/synth-bench/run.mjs first (it saves the reviews this reads).
//
//   node tools/synth-bench/resemble.mjs [--dir .bench/synth] [--json result.json] [--why] [--ai]
// --ai scores the AI answers tools/ai-bench recorded (<id>.ai.json) instead of the on-device builder. An AI answer has
// no pixel boxes, so its visuals are matched to the originals in reading order (rows top to bottom, left to right):
// each original takes the next unused visual of its type or a close cousin.
// --why lists each chart whose category count is wrong (original and replica counts) and the words not shown.
//
// - Layout: visuals that share a row in the original share one in the replica (pairwise), and each visual's span of the
//   12-column grid overlaps its original's share of the page width (intersection over union).
// - Shape: the replica has as many categories as the original, and its bar, line or pie values follow the original's
//   (100 minus the mean gap on a 0-100 scale; pie slices compared largest first, since a pie may start anywhere).
// - Text: of the title words and the category labels left wholly readable by masking, the share the replica shows (a
//   KPI's label is its measure name).
// - Colour: the replica's main colour is within a short distance of the original's main series colour.
// - Generic labels left: each replica is rendered as the app shows it (Shape-preserving mode, realistic names on) and
//   every displayed category, series, measure and dimension label, title and KPI label is checked for a placeholder
//   ("Item 2", "Value", "Series 2", "Category"...). The target is 0: a replica never shows one.
// Values in a replica are invented on purpose; shapes are relative sizes, which is what the replica keeps.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, same, scorePage } from '../layout-bench/builder.mjs';
import { chromium } from 'playwright';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth'));
if (arg('--json')) await rm(arg('--json'), { force: true });
const TYPE = { hbar: 'bar' };
const WHY = process.argv.includes('--why');
const AI = process.argv.includes('--ai');
const SHAPED = ['bar', 'column', 'line', 'pie', 'donut', 'area'];

const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);

/** Where each visual of a spec sits: its row and its column range on the 12-column grid, as shares of the width; by
 *  id, and in reading order as `list`. */
function placed(spec) {
  const at = new Map();
  at.list = [];
  (spec.rows || []).forEach((row, ri) => {
    const total = row.visuals.reduce((a, v) => a + (v.span || 1), 0) || 12;
    let x = 0;
    for (const v of row.visuals) { const e = { row: ri, x0: x / total, x1: (x + (v.span || 1)) / total, v }; at.set(v.id, e); at.list.push(e); x += v.span || 1; }
  });
  return at;
}

/** The originals in reading order, each with the next unused visual of a compatible type (AI answers). */
function byOrder(panels, at) {
  const rows = [];
  for (const t of [...panels].sort((a, b) => a.box[1] - b.box[1])) {
    const row = rows.find((r) => r.some((o) => Math.min(o.box[3], t.box[3]) - Math.max(o.box[1], t.box[1]) > Math.min(o.box[3] - o.box[1], t.box[3] - t.box[1]) * 0.5));
    if (row) row.push(t); else rows.push([t]);
  }
  const order = rows.flatMap((r) => r.sort((a, b) => a.box[0] - b.box[0]));
  const used = new Set();
  let from = 0;
  return order.map((t) => {
    const want = TYPE[t.type] || t.type;
    for (let j = from; j < at.list.length && j < from + 4; j++) {
      const e = at.list[j];
      if (!used.has(e) && same(e.v.type, want, true)) { used.add(e); from = j + 1; return { t, hit: e }; }
    }
    return { t, hit: null };
  }).filter((x) => x.hit);
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.truth.json')).sort();
const builder = AI ? null : await layoutBuilder();
const all = { title: 0, titleShown: 0, cats: 0, catsShown: 0, pairs: 0, pairsRight: 0, xIou: [], counts: 0, countsRight: 0, shape: [], text: 0, textShown: 0, colour: 0, colourRight: 0 };
let pages = 0;
const specs = [];
try {
  for (const f of files) {
    const truth = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    const review = await readFile(join(DIR, truth.id + '.review.json'), 'utf8').then(JSON.parse, () => null);
    if (!review) continue;
    if (!truth.panels.some((p) => 'title' in p)) { console.error(`${f} has no titles: regenerate with tools/synth-bench/gen.mjs`); process.exit(1); }
    let spec, pairs;
    if (AI) {
      const rec = await readFile(join(DIR, truth.id + '.ai.json'), 'utf8').then(JSON.parse, () => null);
      if (!rec?.spec) continue;
      spec = rec.spec;
      pairs = byOrder(truth.panels, placed(spec));
    } else {
      const r = await builder.build(join(DIR, truth.file), review);
      spec = r.spec;
      const s = scorePage(r.panels, truth.panels.map((p) => ({ type: TYPE[p.type] || p.type, bbox: p.box })));
      const at = placed(spec);
      // the truth visuals the replica has, with their replica visual
      pairs = s.truths.map((t, i) => ({ t: truth.panels[i], hit: t.hit && at.get(t.hit.vid) })).filter((x) => x.hit);
    }
    pages++;
    specs.push(spec);
    const W = truth.width, k = review.width / truth.width;
    // layout: rows (vertical overlap in the original) and horizontal placement
    const sameRow = (a, b) => Math.min(a.box[3], b.box[3]) - Math.max(a.box[1], b.box[1]) > Math.min(a.box[3] - a.box[1], b.box[3] - b.box[1]) * 0.5;
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      all.pairs++; if (sameRow(pairs[i].t, pairs[j].t) === (pairs[i].hit.row === pairs[j].hit.row)) all.pairsRight++;
    }
    for (const { t, hit } of pairs) {
      const x0 = t.box[0] / W, x1 = t.box[2] / W;
      const inter = Math.max(0, Math.min(x1, hit.x1) - Math.max(x0, hit.x0)), union = Math.max(x1, hit.x1) - Math.min(x0, hit.x0);
      all.xIou.push(union > 0 ? inter / union : 0);
      const v = hit.v;
      // shape
      if (SHAPED.includes(TYPE[t.type] || t.type) && t.values) {
        const members = v.dimension?.members || [], shape = v.series?.[0]?.shape || [];
        all.counts++;
        if (WHY && shape.length !== t.values.length) console.log(`  count ${truth.id} ${t.type}: original ${t.values.length}, replica ${shape.length} (${v.type})`);
        if (shape.length === t.values.length && members.length === t.values.length) {
          all.countsRight++;
          const max = Math.max(...t.values.map(Math.abs), 1e-9);
          let a = t.values.map((x) => (x / max) * 100), b = shape.map(Number);
          if (t.type === 'pie' || t.type === 'donut') { a = [...a].sort((p, q) => q - p); b = [...b].sort((p, q) => q - p); }
          all.shape.push(100 - mean(a.map((x, i) => Math.abs(x - b[i]))));
        }
      }
      // text: title words and category labels left readable by masking (a kept word with that text inside the visual)
      const inBox = (w) => { const cx = (w.x + w.w / 2) / k, cy = (w.y + w.h / 2) / k; return cx >= t.box[0] && cx <= t.box[2] && cy >= t.box[1] && cy <= t.box[3]; };
      const readable = new Set(review.words.filter((w) => w.kept && w.text && inBox(w)).map((w) => norm(w.text)));
      // (a KPI's label is its measure name; a category label counts only when all its words stayed readable: one with a
      // masked name in it is "Item N" in the replica, as it should be)
      const shown = new Set([...tokens(v.title || ''), ...tokens(v.measure?.name || ''), ...(v.dimension?.members || []).flatMap(tokens)]);
      const wantTitle = tokens(t.title || '').filter((w) => readable.has(w));
      const wantCats = (t.cats || []).filter((cat) => tokens(cat).length && tokens(cat).every((w) => readable.has(w))).flatMap(tokens);
      const titleShown = new Set([...tokens(v.title || ''), ...tokens(v.measure?.name || '')]), catsShown = new Set((v.dimension?.members || []).flatMap(tokens));
      all.text += wantTitle.length + wantCats.length;
      all.textShown += wantTitle.filter((w) => shown.has(w)).length + wantCats.filter((w) => shown.has(w)).length;
      all.title += wantTitle.length; all.titleShown += wantTitle.filter((w) => titleShown.has(w)).length;
      all.cats += wantCats.length; all.catsShown += wantCats.filter((w) => catsShown.has(w)).length;
      if (WHY) { const lost = [...wantTitle, ...wantCats].filter((w) => !shown.has(w)); if (lost.length) console.log(`  text ${truth.id} ${t.type} (${v.type}): lost ${lost.join(' ')} | title "${v.title || ''}"`); }
    }
    // colour: the page's main colour against the original's main series colour
    const orig = hex(truth.panels.find((p) => p.color)?.color), got = hex(spec.theme?.primary);
    if (orig) { all.colour++; if (got && Math.hypot(orig[0] - got[0], orig[1] - got[1], orig[2] - got[2]) <= 60) all.colourRight++; }
  }
} finally {
  if (builder) await builder.close();
}
// generic labels left, in the rendered replicas
const GENERIC = /^\s*(?:person|company|entity|owner|item|category|categories|value|values|series|metric|measure|kpi|line|member|point|group|period|dimension|label|entry|[a-e])\s*\d*\s*$/i;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let labels = 0, generic = 0;
const genericSeen = {};
try {
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  for (const f of ['web/lib/echarts.min.js', 'web/lib/vs-faker.js', 'web/replica.js']) await page.addScriptTag({ content: await readFile(join(ROOT, f), 'utf8') });
  const shown = await page.evaluate((specs) => specs.map((spec) => {
    const m = DSCReplica.model(spec, { mode: 'shape', seed: 7, realistic: true });
    return { csv: m.csv, titles: (spec.rows || []).flatMap((r) => r.visuals.map((v) => v.title || '')) };
  }), specs);
  const cells = (line) => { const out = []; let cur = '', q = false; for (const ch of line) { if (q) { if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  for (const { csv, titles } of shown) {
    const rows = csv.split(/\r?\n/).slice(1).filter(Boolean).map(cells);
    // labels, plus table cells that hold names or text (a person, organisation, text or category column)
    const texts = [...new Set(rows.flatMap((c) => [c[2], c[3], c[4], c[5], c[6], ['text', 'org', 'person', 'category'].includes(c[8]) ? c[7] : '']).filter(Boolean)), ...titles.filter(Boolean)];
    for (const t of texts) { labels++; if (GENERIC.test(t)) { generic++; genericSeen[t] = (genericSeen[t] || 0) + 1; if (WHY) console.log(`  generic "${t}" in: ${rows.filter((c) => c.slice(2, 7).includes(t)).slice(0, 2).map((c) => c.slice(0, 7).join(" | ")).join(" ; ") || "a title"}`); } }
  }
} finally {
  await browser.close();
}
const result = { resemblance: { dashboards: pages,
  genericLabels: { left: generic, of: labels, examples: Object.entries(genericSeen).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} (${v})`) },
  layout: { sameRowPct: pct(all.pairsRight / Math.max(1, all.pairs)), widthMatchPct: pct(mean(all.xIou)) },
  shape: { categoriesRightPct: pct(all.countsRight / Math.max(1, all.counts)), shapeMatchPct: Math.round((mean(all.shape) ?? 0) * 10) / 10, charts: all.counts },
  text: { shownPct: pct(all.textShown / Math.max(1, all.text)), readableWords: all.text, titlesPct: pct(all.titleShown / Math.max(1, all.title)), labelsPct: pct(all.catsShown / Math.max(1, all.cats)) },
  colour: { matchPct: pct(all.colourRight / Math.max(1, all.colour)) } } };
const R = result.resemblance;
console.log(`RESEMBLANCE on ${pages} generated dashboards (${AI ? 'recorded AI answers' : 'visuals the on-device builder found'}):`);
console.log(`  layout   same row ${R.layout.sameRowPct}% of pairs, width match ${R.layout.widthMatchPct}%`);
console.log(`  shape    categories right ${R.shape.categoriesRightPct}% of ${R.shape.charts} charts, shape match ${R.shape.shapeMatchPct}% where right`);
console.log(`  text     ${R.text.shownPct}% of ${R.text.readableWords} readable title and label words shown (titles ${R.text.titlesPct}%, category labels ${R.text.labelsPct}%)`);
console.log(`  colour   main colour right on ${R.colour.matchPct}% of dashboards`);
console.log(`  generic  ${R.genericLabels.left} generic labels left in the rendered replicas, of ${R.genericLabels.of}${R.genericLabels.left ? ': ' + R.genericLabels.examples.join(', ') : ''}`);
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify({ measured: new Date().toISOString().slice(0, 10), ...result }, null, 1) + '\n');
