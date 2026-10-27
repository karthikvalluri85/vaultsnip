// FIDELITY: the one number VaultSnip is judged by (see the rule in CLAUDE.md).
//
// A replica has to look like the original: every visual of the original present, in its place, of its kind, with its
// title, and *nothing else*. This scorer is deliberately harsher than run.mjs:
//   - it counts every panel the builder produces, including ones over application chrome (toolbars, filter bars,
//     "Ask a question about your data"). run.mjs drops those through each dashboard's `ignore` list, which hid the
//     worst thing a user sees: invented cards that are not in the original at all.
//   - a visual counts only when it is found, of the right kind, and roughly the right size and place.
//
//   fidelity = right / max(visuals in the original, panels produced)
//
// so a page scores 100% only when the builder finds every visual, types each one right, and invents nothing.
//
//   node tools/layout-bench/fidelity.mjs [bench dir] [--set new|all] [--json out.json] [--dump out.json] [--only id]
import { readFile, writeFile, rm } from 'node:fs/promises';
import { DEFAULT_BENCH, items, truth } from './items.mjs';
import { layoutBuilder, same } from './builder.mjs';

const arg = (name, d = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const bench = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : DEFAULT_BENCH;
const SET = arg('--set', 'new');
if (arg('--json')) await rm(arg('--json'), { force: true });

// The 31 dashboards of the "new" set: every one labelled after the benchmark grew past the first twelve. They are the
// ones the builder was never tuned on, so they are the honest measure.
const FIRST12 = new Set(['sample-it-spend_it3', 'sample-procurement_discount-analysis', 'sample-human-resources_hr-3', 'sample-procurement_spend-overview',
  'FinanceDashboard', 'ClinicPerformanceDashboard', 'KPI-Progress-Status', 'HRAnalytics', 'new-dashboard-example-2206',
  'looker-tabbed-dashboard-example', 'add-text-results-2218', 'kestrelmoor']);
const wanted = (d) => (arg('--only') ? d.id === arg('--only') : SET === 'all' ? true : !FIRST12.has(d.id));

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const overlap = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? (w * h) / (area(a) + area(b) - w * h) : 0;
};

/**
 * One page scored. A predicted panel matches a true visual when each one's centre falls in the other and they overlap
 * by at least a quarter: the same test run.mjs uses, plus the overlap, so a panel that swallows half the page does not
 * count as "found". Every other panel is an invention.
 */
export function fidelity(panels, visuals) {
  const truths = visuals.map((v) => ({ ...v, hit: null }));
  const taken = new Set();
  for (const t of truths) {
    let best = null, bestOv = 0;
    for (const p of panels) {
      if (taken.has(p)) continue;
      const ov = overlap(p.box, t.bbox);
      if (ov >= 0.25 && inside(centre(p.box), t.bbox) && inside(centre(t.bbox), p.box) && ov > bestOv) { best = p; bestOv = ov; }
    }
    if (best) { t.hit = best; t.ov = bestOv; taken.add(best); }
  }
  const found = truths.filter((t) => t.hit);
  const right = found.filter((t) => same(t.hit.type, t.type, true));
  const invented = panels.filter((p) => !taken.has(p));
  return { truths, found, right, invented, score: right.length / Math.max(panels.length, truths.length || 1) };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('fidelity.mjs')) {
  const byId = Object.fromEntries(items(bench).map((it) => [it.id, it]));
  const builder = await layoutBuilder();
  const rows = [], dump = [];
  let R = 0, V = 0, P = 0, F = 0, INV = 0, perfect = 0;
  try {
    for (const d of truth.dashboards.filter(wanted)) {
      const it = byId[d.id];
      const r = await builder.build(it.file, JSON.parse(await readFile(it.ocr, 'utf8')));
      const f = fidelity(r.panels, d.visuals);
      R += f.right.length; V += d.visuals.length; P += r.panels.length; F += f.found.length; INV += f.invented.length;
      if (f.score === 1) perfect++;
      rows.push({ dashboard: d.id.slice(0, 30), tool: d.tool, visuals: d.visuals.length, panels: r.panels.length,
        found: f.found.length, right: f.right.length, invented: f.invented.length, fidelity: Math.round(f.score * 100) + '%',
        wrong: f.found.filter((t) => !same(t.hit.type, t.type, true)).map((t) => `${t.type}→${t.hit.type}`).join(' ').slice(0, 44),
        missed: f.truths.filter((t) => !t.hit).map((t) => t.type).join(' ').slice(0, 24) });
      dump.push({ id: d.id, tool: d.tool, score: f.score, visuals: d.visuals.length, panels: r.panels.length,
        wrong: f.found.filter((t) => !same(t.hit.type, t.type, true)).map((t) => ({ truth: t.type, got: t.hit.type, title: t.title, box: t.bbox })),
        missed: f.truths.filter((t) => !t.hit).map((t) => ({ type: t.type, title: t.title, box: t.bbox })),
        invented: f.invented.map((p) => ({ type: p.type, box: p.box.map(Math.round), title: p.title || '', certainty: p.certainty, features: p.features })),
        // every panel with what it matched, so a candidate rule can be tried against this file without building again
        panelList: r.panels.map((p) => { const t = f.truths.find((t) => t.hit === p); return { type: p.type, box: p.box.map(Math.round), title: p.title || '', certainty: p.certainty, features: p.features, truth: t ? t.type : null, right: !!t && same(p.type, t.type, true) }; }),
        size: [r.fileWidth ?? 0, r.fileHeight ?? 0] });
    }
  } finally { await builder.close(); }
  rows.sort((a, b) => parseFloat(a.fidelity) - parseFloat(b.fidelity));
  console.table(rows);
  const pct = (a, b) => Math.round((a / Math.max(1, b)) * 1000) / 10;
  const mean = rows.reduce((s, r) => s + parseFloat(r.fidelity), 0) / Math.max(1, rows.length);
  const result = { set: arg('--only') || SET, dashboards: rows.length,
    fidelity: Math.round(mean * 10) / 10, perfect, visuals: V, panels: P, found: F, right: R, invented: INV,
    foundPct: pct(F, V), typesPct: pct(R, F), inventedPerPage: Math.round((INV / Math.max(1, rows.length)) * 100) / 100 };
  console.log(`\nFIDELITY ${result.fidelity}% (mean over ${rows.length} dashboards; ${perfect} perfect)`);
  console.log(`  of ${V} real visuals: ${F} found (${result.foundPct}%), ${R} also right (${pct(R, V)}%)`);
  console.log(`  ${P} panels produced, ${INV} invented (${result.inventedPerPage} per page)`);
  if (arg('--dump')) await writeFile(arg('--dump'), JSON.stringify(dump, null, 1));
  if (arg('--json')) await writeFile(arg('--json'), JSON.stringify(result, null, 1) + '\n');
}
