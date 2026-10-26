// Fails when a benchmark figure gets worse than its committed baseline by more than its tolerance (developer tool, CI).
//   node tools/bench-gate.mjs <result.json> <baseline.json>
// Works for every benchmark: masking (tools/synth-bench/run.mjs --json), layout (tools/layout-bench/run.mjs and
// tools/synth-bench/layout.mjs --json), chart variants and types (tools/synth-bench/chart-variants.mjs, chart-types.mjs --json) and resemblance (tools/synth-bench/resemble.mjs --json); a rule whose figure is
// missing from either file is skipped.
// Tolerances absorb the small differences between machines (text rendering, image scaling), not real regressions:
// on the smoke set one word is about 0.2 points. Raise a baseline only with a change that improves it, in the same PR.
import { readFile } from 'node:fs/promises';

const [resultFile, baselineFile] = process.argv.slice(2);
if (!baselineFile) { console.error('usage: node tools/bench-gate.mjs <result.json> <baseline.json>'); process.exit(2); }
const result = JSON.parse(await readFile(resultFile, 'utf8')), base = JSON.parse(await readFile(baselineFile, 'utf8'));
const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

// [figure, better ('lower' | 'higher'), tolerance in its own unit, what it protects]
const RULES = [
  ['residualExposed.pct', 'lower', 1.0, 'sensitive words still readable after masking and the check: what would leak'],
  ['residualLeakedAreaPct', 'lower', 0.5, 'share of sensitive text area still readable after the check'],
  ['firstPassExposed.pct', 'lower', 1.5, 'sensitive words the masks alone leave readable'],
  ['overMasked.pct', 'lower', 2.0, 'safe words masked anyway (titles and labels lost from the replica)'],
  ['falseAlarms.pct', 'lower', 10.0, 'check findings that are not real misses (work for the user)'],
  ['dashboards.foundPct', 'higher', 3.0, 'visuals the on-device build finds'],
  ['dashboards.typesRightPct', 'higher', 3.0, 'visuals found with the right chart type'],
  ['dashboards.endToEndPct', 'higher', 3.0, 'share of a dashboard that comes out right'],
  ['reports.checksRight', 'higher', 0, 'paginated report structure'],
  ['review.findings', 'lower', 25, 'items users must resolve on the real dashboards'],
  ['dashboards.seriesLayout.rightPct', 'higher', 3.0, 'bar, column and combo charts whose series sit as in the original (one, clustered, stacked, 100%)'],
  ['dashboards.refLines.addedWhereNone', 'lower', 1, 'reference lines drawn on real charts that have none'],
  ['chartVariants.seriesLayout.rightPct', 'higher', 4.0, 'generated charts whose series sit as drawn'],
  ['chartVariants.refLines.foundPct', 'higher', 6.0, 'reference lines found on generated charts'],
  ['chartVariants.refLines.addedWhereNone', 'lower', 1, 'reference lines added to generated charts that have none'],
  ['chartTypes.newTypesRightPct', 'higher', 8.0, 'generated gauges, funnels, Gantt charts and heatmaps read as such'],
  ['chartTypes.controlsRightPct', 'higher', 0, 'generated column, pie and line charts still read as such'],
  ['synthLayout.foundPct', 'higher', 3.0, 'visuals the on-device build finds on the generated dashboards'],
  ['synthLayout.typesRightPct', 'higher', 3.0, 'visuals found with the right type, generated dashboards'],
  ['synthLayout.endToEndPct', 'higher', 3.0, 'share of a generated dashboard that comes out right'],
  ['resemblance.genericLabels.left', 'lower', 0, 'placeholder labels ("Item 2", "Value", "Series 2") in rendered replicas: never allowed'],
  ['resemblance.layout.sameRowPct', 'higher', 3.0, 'visuals sharing a row in the original share one in the replica'],
  ['resemblance.shape.categoriesRightPct', 'higher', 3.0, 'charts with the right number of categories'],
  ['resemblance.text.shownPct', 'higher', 3.0, 'readable titles and labels the replica shows'],
  ['resemblance.text.labelsPct', 'higher', 3.0, 'readable category labels the replica shows'],
];

let failed = 0, checked = 0;
for (const [path, better, tol, why] of RULES) {
  const now = get(result, path), was = get(base, path);
  if (typeof now !== 'number' || typeof was !== 'number') continue;
  checked++;
  const worse = better === 'lower' ? now - was : was - now;
  const mark = worse > tol ? '✗' : worse < -tol ? '↑' : '✓';
  if (worse > tol) failed++;
  console.log(`  ${mark} ${path}: ${was} → ${now} (${better} is better, tolerance ${tol}) - ${why}`);
}
if (!checked) { console.error('no figure in common between the result and the baseline'); process.exit(2); }
if (failed) { console.error(`${failed} figure(s) got worse than the baseline allows. If the change is intended, explain why in the PR.`); process.exit(1); }
console.log(`All ${checked} figures within tolerance of the baseline (↑ = better: consider raising the baseline in this PR).`);
