// The on-device layout builder on the generated dashboards (developer tool): a second, independent check next to the
// 12 real dashboards, so a builder change that only fits those 12 shows up. Uses the <id>.review.json files run.mjs
// saved (run that first) and each dashboard's annotated panels, scored exactly as the real-world benchmark is.
//   node tools/synth-bench/layout.mjs [--dir .bench/synth] [--json result.json] [--dump dump.json]
// --dump writes every panel's signals and each page's true accuracy in tools/layout-bench/run.mjs's format, so the
// confidence score can be set on generated pages and checked on the real ones (tools/layout-bench/confidence-check.mjs).
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, same, scorePage } from '../layout-bench/builder.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth'));
if (arg('--json')) await rm(arg('--json'), { force: true });
if (arg('--dump')) await rm(arg('--dump'), { force: true });
// the generator's panel kinds in the builder's words: Plotly's horizontal bars are bars
const TYPE = { hbar: 'bar' };

const files = (await readdir(DIR)).filter((f) => f.endsWith('.truth.json')).sort();
const builder = await layoutBuilder();
const byType = {}, confusion = {}, dump = { panels: [], pages: [] };
let V = 0, F = 0, L = 0, P = 0, missing = 0;
try {
  for (const f of files) {
    const truth = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    const review = await readFile(join(DIR, truth.id + '.review.json'), 'utf8').then(JSON.parse, () => null);
    if (!review) { missing++; continue; }
    const r = await builder.build(join(DIR, truth.file), review);
    const visuals = truth.panels.map((p) => ({ type: TYPE[p.type] || p.type, bbox: p.box }));
    const s = scorePage(r.panels, visuals);
    for (const p of s.counted) { const t = s.truths.find((t) => t.hit === p); dump.panels.push({ dashboard: truth.id, type: p.type, certainty: p.certainty, features: p.features, titled: !!p.title, area: ((p.box[2] - p.box[0]) * (p.box[3] - p.box[1])) / r.imageArea, found: !!t, truth: t?.type ?? null, correct: !!t && same(p.type, t.type, true) }); }
    dump.pages.push({ dashboard: truth.id, visuals: s.truths.length, right: s.lenient, found: s.hits.length, predicted: s.counted.length, coverage: r.coverage, confidence: r.confidence ?? null });
    V += visuals.length; F += s.hits.length; L += s.lenient; P += s.counted.length;
    for (const t of s.truths) {
      const k = byType[t.type] ||= { visuals: 0, found: 0, typesRight: 0 };
      k.visuals++; if (t.hit) { k.found++; if (same(t.hit.type, t.type, true)) k.typesRight++; else { const c = `${t.type}→${t.hit.type}`; confusion[c] = (confusion[c] || 0) + 1; } }
    }
  }
} finally {
  await builder.close();
}
if (missing) { console.error(`${missing} dashboard(s) have no review: run tools/synth-bench/run.mjs first`); process.exit(1); }
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const result = { synthLayout: { dashboards: files.length, visuals: V, found: F, foundPct: pct(F, V), extraPanels: P - F, typesRight: L, typesRightPct: pct(L, F), endToEndPct: pct(L, V),
  byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, foundPct: pct(v.found, v.visuals), typesRightPct: pct(v.typesRight, v.found) }])) } };
console.log(`LAYOUT on ${files.length} generated dashboards: found ${F}/${V} visuals (${result.synthLayout.foundPct}%), ${P - F} extra panels, types ${L}/${F} (${result.synthLayout.typesRightPct}%), end to end ${result.synthLayout.endToEndPct}%`);
console.log('mistyped: ' + Object.entries(confusion).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
console.log(Object.entries(result.synthLayout.byType).map(([k, v]) => `${k} ${v.found}/${v.visuals} found, ${v.typesRight} typed right`).join('; '));
if (arg('--dump')) await writeFile(arg('--dump'), JSON.stringify(dump, null, 1));
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify({ measured: new Date().toISOString().slice(0, 10), version: JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version, ...result }, null, 1) + '\n');
