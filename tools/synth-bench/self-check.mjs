// The on-device self-check measured (developer tool): for each generated (fictional) dashboard, the replica built on the
// device is drawn by VaultSnip's own engine and each visual compared with its panel in the masked image by
// web/selfcheck.js, exactly as the app does. A visual built right should look alike; one of the wrong type, or a panel
// that is no visual, should not. Reports how well the similarity separates the two, and what a flag threshold catches.
//   node tools/synth-bench/self-check.mjs [--dir .bench/synth] [--json result.json] [--below 0.45]
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, same, scorePage } from '../layout-bench/builder.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth')), BELOW = +arg('--below', 0.45);
if (arg('--json')) await rm(arg('--json'), { force: true });
const TYPE = { hbar: 'bar' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent('<body style="margin:0"><div id="replica"></div></body>');
for (const f of ['web/lib/echarts.min.js', 'web/lib/vs-faker.js', 'web/replica.js', 'web/selfcheck.js']) await page.addScriptTag({ content: await readFile(join(ROOT, f), 'utf8') });
for (const m of (await readdir(join(ROOT, 'web/maps'))).filter((f) => f.endsWith('.json'))) {
  const json = await readFile(join(ROOT, 'web/maps', m), 'utf8');
  await page.evaluate(({ name, json }) => window.DSCReplica.addMap && window.DSCReplica.addMap(name, JSON.parse(json)), { name: m.replace('.json', ''), json });
}
const builder = await layoutBuilder();
const rows = [];
try {
  for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.truth.json')).sort()) {
    const truth = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    const review = JSON.parse(await readFile(join(DIR, truth.id + '.review.json'), 'utf8').catch(() => 'null'));
    if (!review) continue;
    const r = await builder.build(join(DIR, truth.file), review);
    const s = scorePage(r.panels, truth.panels.map((p) => ({ type: TYPE[p.type] || p.type, bbox: p.box })));
    // panel boxes in the review's pixels (where the masked image is drawn)
    const k = review.width / r.fileWidth, boxes = Object.fromEntries(r.panels.filter((p) => p.vid).map((p) => [p.vid, p.box.map((v) => v * k)]));
    const img = (await readFile(join(DIR, truth.file))).toString('base64');
    const sims = await page.evaluate(async ({ img, mime, review, spec, boxes }) => {
      const im = new Image(); im.src = `data:${mime};base64,` + img; await im.decode();
      const c = document.createElement('canvas'); c.width = review.width; c.height = review.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height); x.fillStyle = '#787c82'; review.masks.forEach((m) => x.fillRect(m.x, m.y, m.w, m.h));
      const root = document.getElementById('replica'); root.style.width = Math.min(1400, review.width) + 'px';
      window.DSCReplica.render(root, spec, { mode: 'shape', seed: 7, realistic: true, quiet: true });
      return window.VSSelfCheck.compare(root, c, boxes, review.words);
    }, { img, mime: /jpe?g$/.test(truth.file) ? 'image/jpeg' : 'image/png', review, spec: r.spec, boxes });
    for (const p of r.panels.filter((p) => p.vid && sims[p.vid] != null)) {
      const t = s.truths.find((t) => t.hit === p);
      rows.push({ id: truth.id, vid: p.vid, type: p.type, truth: t ? t.type : null, right: !!t && same(p.type, t.type, true), sim: sims[p.vid], confidence: p.confidence });
    }
  }
} finally {
  await builder.close(); await browser.close();
}
// how well similarity ranks right visuals above wrong ones (AUC), and what flagging below a threshold catches
const right = rows.filter((x) => x.right), wrong = rows.filter((x) => !x.right);
let wins = 0; for (const a of right) for (const b of wrong) wins += a.sim > b.sim ? 1 : a.sim === b.sim ? 0.5 : 0;
const auc = right.length && wrong.length ? Math.round((wins / (right.length * wrong.length)) * 1000) / 1000 : null;
const flagged = rows.filter((x) => x.sim < BELOW);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const result = { selfCheck: { visuals: rows.length, right: right.length, wrong: wrong.length, auc, below: BELOW,
  flagged: flagged.length, wrongCaughtPct: pct(flagged.filter((x) => !x.right).length, wrong.length), flagsRightPct: pct(flagged.filter((x) => !x.right).length, flagged.length),
  medianRight: right.map((x) => x.sim).sort((a, b) => a - b)[right.length >> 1], medianWrong: wrong.map((x) => x.sim).sort((a, b) => a - b)[wrong.length >> 1] } };
console.log(JSON.stringify(result, null, 1));
for (const t of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55]) { const fl = rows.filter((x) => x.sim < t); console.log(`below ${t}: flags ${fl.length}, wrong caught ${fl.filter((x) => !x.right).length}/${wrong.length}, right flagged ${fl.filter((x) => x.right).length}/${right.length}`); }
// the builder's own confidence, alone and with the similarity, ranked the same way
const aucOf = (f) => { let w = 0; for (const a of right) for (const b of wrong) w += f(a) > f(b) ? 1 : f(a) === f(b) ? 0.5 : 0; return Math.round((w / (right.length * wrong.length)) * 1000) / 1000; };
console.log('AUC similarity', aucOf((x) => x.sim), 'confidence', aucOf((x) => x.confidence), 'mean', aucOf((x) => (x.sim + x.confidence) / 2), 'product', aucOf((x) => x.sim * x.confidence));
// the app's "Check" flag (below 0.5), on the builder's confidence alone and with the self-check averaged in
for (const [name, f] of [['confidence', (x) => x.confidence], ['with self-check', (x) => (x.sim + x.confidence) / 2]]) {
  const fl = rows.filter((x) => f(x) < 0.5);
  console.log(`Check flags, ${name}: ${fl.length}, wrong caught ${fl.filter((x) => !x.right).length}/${wrong.length}, right flagged ${fl.filter((x) => x.right).length}/${right.length}`);
}
result.selfCheck.checkFlags = Object.fromEntries([['confidence', (x) => x.confidence], ['withSelfCheck', (x) => (x.sim + x.confidence) / 2]].map(([k, f]) => { const fl = rows.filter((x) => f(x) < 0.5); return [k, { flags: fl.length, wrongCaught: fl.filter((x) => !x.right).length, rightFlagged: fl.filter((x) => x.right).length }]; }));
for (const t of [0.2, 0.25, 0.3, 0.35]) {
  const fl = rows.filter((x) => x.confidence < 0.5 || x.sim < t);
  console.log(`Check flags, confidence or similarity below ${t}: ${fl.length}, wrong caught ${fl.filter((x) => !x.right).length}/${wrong.length}, right flagged ${fl.filter((x) => x.right).length}/${right.length}`);
}
result.selfCheck.aucConfidence =aucOf((x) => x.confidence); result.selfCheck.aucWithSelfCheck = aucOf((x) => (x.sim + x.confidence) / 2);
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify(result, null, 1) + '\n');
