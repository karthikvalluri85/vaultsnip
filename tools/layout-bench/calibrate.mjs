// Fits the on-device builder's confidence score (developer tool): a small logistic model that turns a panel's signals
// into the probability that the panel is right (found and typed correctly), from a benchmark dump:
//   node tools/layout-bench/run.mjs <bench> --dump dump.json
//   node tools/layout-bench/calibrate.mjs dump.json
// It reports leave-one-dashboard-out accuracy (each dashboard scored by a model that never saw it), then prints the
// weights fitted on everything, to copy into src/layout/confidence.ts.
import { readFile } from 'node:fs/promises';

const dump = JSON.parse(await readFile(process.argv[2], 'utf8'));
// the same signal list as src/layout/confidence.ts
export const TYPES = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter', 'treemap', 'table', 'kpi', 'text', 'placeholder'];
const x = (p) => {
  const f = p.features || {};
  return [1, ...TYPES.map((t) => (p.type === t ? 1 : 0)), p.certainty, Math.log10(Math.max(1e-4, p.area)) / 4, Math.min(1, (f.words || 0) / 40), f.grid || 0, Math.min(1, (f.coverage || 0) * 4), p.titled ? 1 : 0, (f.marks || 0) > 0 ? 1 : 0];
};
const sig = (z) => 1 / (1 + Math.exp(-z));
function fit(rows, l2 = 0.5, steps = 4000, lr = 0.3) {
  const n = x(rows[0]).length, w = new Array(n).fill(0);
  for (let s = 0; s < steps; s++) {
    const g = new Array(n).fill(0);
    for (const r of rows) { const xi = x(r), e = sig(xi.reduce((a, v, i) => a + v * w[i], 0)) - (r.correct ? 1 : 0); xi.forEach((v, i) => { g[i] += e * v; }); }
    w.forEach((_, i) => { w[i] -= lr * (g[i] / rows.length + (i ? l2 * w[i] / rows.length : 0)); });
  }
  return w;
}
const predict = (w, p) => sig(x(p).reduce((a, v, i) => a + v * w[i], 0));

// page score: expected right panels over (panels shown + visuals the page probably missed). The true value it estimates
// is right / (true visuals + extra panels): junk panels and missed visuals both make a replica less faithful
export const pageScore = (ps, coverage) => {
  const right = ps.reduce((a, p) => a + p.prob, 0), missed = ps.length * Math.max(0, 1 - coverage) * 1.5;
  return right / Math.max(1, ps.length + missed);
};

const dashboards = [...new Set(dump.panels.map((p) => p.dashboard))];
let brier = 0, n = 0; const pages = [];
for (const d of dashboards) {
  const w = fit(dump.panels.filter((p) => p.dashboard !== d));
  const ps = dump.panels.filter((p) => p.dashboard === d).map((p) => ({ ...p, prob: predict(w, p) }));
  ps.forEach((p) => { brier += (p.prob - (p.correct ? 1 : 0)) ** 2; n++; });
  const page = dump.pages.find((q) => q.dashboard === d);
  pages.push({ dashboard: d.slice(0, 28), estimate: Math.round(pageScore(ps, page.coverage) * 100), actual: Math.round((page.right / (page.visuals + page.predicted - page.found)) * 100) });
}
console.log('LEAVE-ONE-DASHBOARD-OUT');
console.table(pages);
const mae = pages.reduce((a, p) => a + Math.abs(p.estimate - p.actual), 0) / pages.length;
console.log(`panel Brier score ${(brier / n).toFixed(3)} (0 is perfect, 0.25 is a coin flip); page estimate off by ${mae.toFixed(1)} points on average`);
// is the 90% line honest: of pages scored >= 90, how many really are >= 90?
const hi = pages.filter((p) => p.estimate >= 90);
console.log(`pages scored >= 90: ${hi.length}, of which really >= 90: ${hi.filter((p) => p.actual >= 90).length}`);
const w = fit(dump.panels);
console.log('\nWEIGHTS (fitted on all):\n' + JSON.stringify(w.map((v) => Math.round(v * 1000) / 1000)));
