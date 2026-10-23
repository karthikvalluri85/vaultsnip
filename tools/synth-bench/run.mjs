// Masking benchmark on the generated dashboards (developer tool): reviews each image with VaultSnip's own review step
// and scores the result against the truth gen.mjs wrote.
//   node tools/synth-bench/run.mjs [--dir .bench/synth] [--reuse | --resume] [--json result.json]
// --reuse scores existing <id>.review.json files instead of reading the images again; --resume reads only the images
// that have none yet (to finish an interrupted run).
//
// What is scored (definitions in ACCURACY.md):
//   exposed     a sensitive word with more than EXPOSED of its box not covered (measured by sampling points in the box)
//   first pass  covered by the masks alone; residual: covered by the masks or the pre-flight check's findings, which
//               the user must resolve before sending. Residual exposure is what would leak.
//   over-masked a safe word with more than half its box covered by a mask
//   false alarm a check finding that touches no sensitive word the first pass left exposed
// Rates carry a 95% Wilson interval: with a few thousand words, a difference smaller than the interval is noise.
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../layout-bench/items.mjs';
import { reviewer } from '../layout-bench/review.mjs';
import { EXPOSED, covered, overlap, wilson } from './metrics.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth'));
const reuse = process.argv.includes('--reuse'), resume = process.argv.includes('--resume');
// a run that stops early must not leave an older result behind for the gate to read
if (arg('--json')) await rm(arg('--json'), { force: true });

const files = (await readdir(DIR)).filter((f) => f.endsWith('.truth.json')).sort();
if (!files.length) { console.error(`no generated dashboards in ${DIR}: run tools/synth-bench/gen.mjs first`); process.exit(1); }
const app = reuse ? null : await reviewer();
const per = [];
const kinds = {};
let sens = 0, firstExposed = 0, residual = 0, residualRotated = 0, sensArea = 0, firstArea = 0, residualArea = 0, safe = 0, over = 0, findings = 0, falseAlarms = 0, unknown = 0;
const times = [];
try {
  for (const f of files) {
    const truth = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    const reviewFile = join(DIR, truth.id + '.review.json');
    let r;
    const saved = (reuse || resume) ? await readFile(reviewFile, 'utf8').then(JSON.parse, () => null) : null;
    if (saved) r = saved;
    else if (reuse) throw new Error(`${reviewFile} is missing: run without --reuse`);
    else { r = await app.read(join(DIR, truth.file)); await writeFile(reviewFile, JSON.stringify(r)); }
    times.push(r.ms / 1000);
    const k = r.width / truth.width;                                   // truth is in file pixels, the review in the app's
    const words = truth.words.map((w) => ({ ...w, x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k }));
    const both = r.masks.concat(r.findings);
    let pSens = 0, pFirst = 0, pRes = 0, pOver = 0, pSafe = 0;
    const exposedFirst = [];
    for (const w of words) {
      if (w.kind === 'unknown') { unknown++; continue; }
      if (w.kind === 'punctuation') continue;
      const a = w.w * w.h;
      if (w.sensitive) {
        const c1 = covered(w, r.masks), c2 = covered(w, both);
        const K = kinds[w.kind] ||= { words: 0, firstExposed: 0, residual: 0 };
        sens++; pSens++; K.words++; if (!w.rotated) { sensArea += a; firstArea += a * (1 - c1); residualArea += a * (1 - c2); }   // a rotated word's upright box is mostly background
        if (1 - c1 > EXPOSED) { firstExposed++; pFirst++; K.firstExposed++; exposedFirst.push(w); }
        if (1 - c2 > EXPOSED) { residual++; pRes++; K.residual++; if (w.rotated) residualRotated++; }
      } else {
        safe++; pSafe++;
        if (covered(w, r.masks) > 0.5) { over++; pOver++; }
      }
    }
    for (const fd of r.findings) {
      findings++;
      if (!exposedFirst.some((w) => overlap(w, fd) > 0.3)) falseAlarms++;
    }
    per.push({ id: truth.id, style: `${truth.style.theme} ${truth.style.font} ${truth.style.size}px ${truth.style.dpr}x ${truth.style.format}`, sensitive: pSens, firstExposed: pFirst, residual: pRes,
      safe: pSafe, overMasked: pOver, findings: r.findings.length, gate: r.gate, s: +(r.ms / 1000).toFixed(1) });
    if (!reuse) console.log(`  ✓ ${truth.id}: ${pFirst}/${pSens} sensitive words exposed after masking, ${pRes} after the check; ${pOver}/${pSafe} safe words masked; ${r.findings.length} findings`);
  }
} finally {
  if (app) await app.close();
}
console.table(per);
times.sort((a, b) => a - b);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
const result = {
  images: files.length, sensitiveWords: sens, safeWords: safe, unknownWords: unknown,
  firstPassExposed: wilson(firstExposed, sens), residualExposed: wilson(residual, sens), residualRotated,
  firstPassLeakedAreaPct: pct(firstArea, sensArea), residualLeakedAreaPct: pct(residualArea, sensArea),   // upright words only
  overMasked: wilson(over, safe), falseAlarms: wilson(falseAlarms, findings),
  byKind: Object.fromEntries(Object.entries(kinds).map(([kk, v]) => [kk, { words: v.words, firstPassExposedPct: pct(v.firstExposed, v.words), residualExposedPct: pct(v.residual, v.words) }])),
  medianSeconds: times[Math.floor(times.length / 2)],
};
console.log(`MASKING on ${result.images} generated dashboards (${sens} sensitive words):`);
console.log(`  exposed after masking   ${result.firstPassExposed.pct}% [${result.firstPassExposed.lo}–${result.firstPassExposed.hi}] (${firstExposed} words), area ${result.firstPassLeakedAreaPct}%`);
console.log(`  exposed after the check ${result.residualExposed.pct}% [${result.residualExposed.lo}–${result.residualExposed.hi}] (${residual} words, ${residualRotated} rotated), area ${result.residualLeakedAreaPct}%`);
console.log(`  safe words masked       ${result.overMasked.pct}% [${result.overMasked.lo}–${result.overMasked.hi}] of ${safe}`);
console.log(`  check false alarms      ${result.falseAlarms.pct}% [${result.falseAlarms.lo}–${result.falseAlarms.hi}] of ${findings} findings`);
console.log(`  by kind ${JSON.stringify(result.byKind)}`);
if (unknown) console.log(`  ${unknown} words of unknown kind were left out of the scores`);
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify({ measured: new Date().toISOString().slice(0, 10), version: JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version, ...result }, null, 1) + '\n');
