// Benchmark for the on-device layout builder (developer tool; images are not redistributed, see truth.json sources).
// Runs web/lib/vs-layout.js in Chromium exactly as the app does: the image decoded by the browser at the size the app
// works at, masks drawn with the app's own canvas call in its grey, masked words without text. Scores panels found,
// chart types and table structure against hand annotations.
//
//   node tools/layout-bench/run.mjs [bench dir, default .bench] [--opts '{"cross":false}'] [--dump file.json] [--json file.json]
// The bench dir holds the images (powerbi/, tableau/, looker/, reports/; fetch.mjs) and run/<id>.ocr.json from
// VaultSnip's own review step (ocr.mjs): { width, height, words: [{ text, x, y, w, h, kept }], masks: [{ x, y, w, h }] }.
// --json writes the summary figures (the format of baseline.json).
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_BENCH, ROOT, items, truth } from './items.mjs';
import { addDetails, chartDetails, layoutBuilder, same, scorePage } from './builder.mjs';

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const bench = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : DEFAULT_BENCH;
const opts = arg('--opts') ? JSON.parse(arg('--opts')) : {};
const byId = Object.fromEntries(items(bench).map((it) => [it.id, it]));
// a run that stops early must not leave an older result behind for the gate to read
if (arg('--json')) await rm(arg('--json'), { force: true });

const builder = await layoutBuilder(opts);
const build = async (id) => builder.build(byId[id].file, JSON.parse(await readFile(byId[id].ocr, 'utf8')));

// --dump file.json: every panel's signals with whether it was right, and each page's true accuracy (for calibrating
// the confidence score)
const dump = { panels: [], pages: [] };
const rows = [];
const tools = {};
let F = 0, V = 0, P = 0, TS = 0, TL = 0;
const details = {};
for (const d of truth.dashboards) {
  const r = await build(d.id);
  const { counted, truths, hits, strict, lenient: len } = scorePage(r.panels, d.visuals, d.ignore);
  for (const p of counted) { const t = truths.find((t) => t.hit === p); dump.panels.push({ dashboard: d.id, type: p.type, certainty: p.certainty, features: p.features, titled: !!p.title, area: ((p.box[2] - p.box[0]) * (p.box[3] - p.box[1])) / r.imageArea, found: !!t, truth: t?.type ?? null, correct: !!t && same(p.type, t.type, true) }); }
  dump.pages.push({ dashboard: d.id, visuals: truths.length, right: len, found: hits.length, predicted: counted.length, coverage: r.coverage, confidence: r.confidence ?? null });
  addDetails(details, chartDetails(truths, r.spec));
  F += hits.length; V += truths.length; P += counted.length; TS += strict; TL += len;
  const t = tools[d.tool] ||= { dashboards: 0, visuals: 0, found: 0, typesRight: 0 };
  t.dashboards++; t.visuals += truths.length; t.found += hits.length; t.typesRight += len;
  rows.push({ dashboard: d.id.slice(0, 28), tool: d.tool, visuals: truths.length, found: hits.length, predicted: counted.length, typesLenient: len, typesStrict: strict, ms: r.ms,
    wrong: hits.filter((t) => !same(t.hit.type, t.type, true)).map((t) => `${t.type}→${t.hit.type}`).join(' '), missed: truths.filter((t) => !t.hit).map((t) => t.type).join(' ') });
}
console.table(rows);
if (arg('--dump')) await writeFile(arg('--dump'), JSON.stringify(dump, null, 1));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const D = details;
console.log(`CHART DETAILS: series layout right on ${D.layoutRight}/${D.layoutChecked} bar, column and combo charts found ${JSON.stringify(D.layoutWrong)}; reference lines found ${D.refFound}/${D.refTruth}, added where there is none ${D.refFalse}`);
console.log(`DASHBOARDS: found ${F}/${V} visuals (${Math.round((F / V) * 100)}%), ${P} panels predicted, types ${TL}/${F} lenient (${Math.round((TL / Math.max(1, F)) * 100)}%), ${TS} strict`);

// reports: structure of the whole page
const rrows = [];
for (const t of truth.reports || []) {
  let r;
  try { r = await build(t.id); } catch { continue; }
  const v = r.spec.rows[0]?.visuals[0] || {};
  const got = { type: v.type, subtotals: !!v.subtotals, grandTotal: !!v.grandTotal, rowDims: (v.rowDims || []).length, groupBy: (v.groupBy || []).length, parameters: (r.spec.parameters || []).length };
  const checks = Object.entries(t.want).map(([k, w]) => got[k] === w);
  rrows.push({ report: t.id.slice(5, 40), score: `${checks.filter(Boolean).length}/${checks.length}`, right: checks.filter(Boolean).length, of: checks.length, ...got, columns: (v.columns || []).map((c) => c.name).join('|').slice(0, 60) });
}
console.table(rrows.map(({ right, of, ...r }) => r));
await builder.close();

// the review step's own results, from the OCR runs: how often the pre-flight check had to catch text the first pass left
// readable, and how long reading took
const runs = await Promise.all(Object.values(byId).map(async (it) => JSON.parse(await readFile(it.ocr, 'utf8'))));
const secs = runs.map((o) => o.ms / 1000).sort((a, b) => a - b);
const found = runs.flatMap((o) => o.findings || []);
const byType = {};
found.forEach((f) => { byType[f.type] = (byType[f.type] || 0) + 1; });
const review = { images: runs.length, checkPassedFirstTime: runs.filter((o) => o.gate === 'pass').length, checkCaughtLeftovers: runs.filter((o) => o.gate === 'blocked' || o.gate === 'review').length,
  findings: found.length, blocking: found.filter((f) => f.severity === 'block').length, findingsByType: byType,
  medianSeconds: secs[Math.floor(secs.length / 2)], slowestSeconds: secs[secs.length - 1] };
console.log(`REVIEW: check passed first time on ${review.checkPassedFirstTime}/${review.images} images; ${review.findings} items to resolve (${review.blocking} blocking): ${JSON.stringify(byType)}; ` +
  `reading took ${review.medianSeconds.toFixed(1)} s median, ${review.slowestSeconds.toFixed(1)} s slowest`);

if (arg('--json')) {
  const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  await writeFile(arg('--json'), JSON.stringify({
    version, measured: new Date().toISOString().slice(0, 10), opts,
    dashboards: { count: truth.dashboards.length, visuals: V, found: F, foundPct: pct(F, V), extraPanels: P - F, typesRightLenient: TL, typesRightStrict: TS, typesRightPct: pct(TL, F),
      endToEndPct: pct(TL, V),
      seriesLayout: { checked: D.layoutChecked, right: D.layoutRight, rightPct: pct(D.layoutRight, D.layoutChecked), wrong: D.layoutWrong },
      refLines: { inTruth: D.refTruth, found: D.refFound, addedWhereNone: D.refFalse },
      byTool: Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, { ...t, foundPct: pct(t.found, t.visuals), typesRightPct: pct(t.typesRight, t.found) }])) },
    reports: { count: rrows.length, checksRight: rrows.reduce((a, r) => a + r.right, 0), checks: rrows.reduce((a, r) => a + r.of, 0) },
    review,
  }, null, 1) + '\n');
}
