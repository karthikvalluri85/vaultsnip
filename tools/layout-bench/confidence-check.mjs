// Checks the shipped confidence score (src/layout/confidence.ts) against a benchmark dump: per-panel Brier score,
// how far page estimates are from the true page accuracy, and whether the 90% line is honest (developer tool).
//   node tools/layout-bench/run.mjs <bench> --dump dump.json
//   node tools/layout-bench/confidence-check.mjs dump.json
import { readFile } from 'node:fs/promises';
import { panelConfidence, pageConfidence, swallowedVisuals, CONFIDENCE_THRESHOLD } from '../../src/layout/confidence.ts';

const dump = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rows = [];
let brier = 0, n = 0;
for (const page of dump.pages) {
  const ps = dump.panels.filter((p) => p.dashboard === page.dashboard).map((p) => ({ ...p, prob: panelConfidence(p) }));
  ps.forEach((p) => { brier += (p.prob - (p.correct ? 1 : 0)) ** 2; n++; });
  const estimate = Math.round(pageConfidence(ps.map((p) => p.prob), page.coverage, swallowedVisuals(ps.map((p) => p.area), ps.map((p) => p.type))) * 100);
  const actual = Math.round((page.right / (page.visuals + page.predicted - page.found)) * 100);
  rows.push({ dashboard: page.dashboard.slice(0, 28), estimate, actual, gap: estimate - actual });
}
console.table(rows);
const line = Math.round(CONFIDENCE_THRESHOLD * 100), hi = rows.filter((r) => r.estimate >= line);
console.log(`panel Brier ${(brier / n).toFixed(3)} (0 perfect, 0.25 coin flip); page estimates off by ${(rows.reduce((a, r) => a + Math.abs(r.gap), 0) / rows.length).toFixed(1)} points on average; ` +
  `over-estimates by more than 15 points: ${rows.filter((r) => r.gap > 15).length}; pages scored >= ${line}: ${hi.length}, really >= ${line}: ${hi.filter((r) => r.actual >= line).length}`);
