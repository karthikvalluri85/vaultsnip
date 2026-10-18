// Benchmark for the on-device layout builder (developer tool; images are not redistributed, see truth.json sources).
// Runs web/lib/vs-layout.js in Chromium exactly as the app does: the image decoded by the browser at the size the app
// works at, masks drawn with the app's own canvas call in its grey, masked words without text. Scores panels found,
// chart types and table structure against hand annotations.
//
//   node tools/layout-bench/run.mjs <bench dir> [--opts '{"cross":false}'] [--dump file.json]
// The bench dir holds the images (powerbi/, tableau/, looker/, reports/) and run/<id>.ocr.json from VaultSnip's own
// review step: { width, height, words: [{ text, x, y, w, h, kept }], masks: [{ x, y, w, h }] }.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const bench = process.argv[2];
if (!bench) { console.error('usage: node tools/layout-bench/run.mjs <bench dir>'); process.exit(1); }
const truth = JSON.parse(await readFile(join(here, 'truth.json'), 'utf8'));
const opts = process.argv.includes('--opts') ? JSON.parse(process.argv[process.argv.indexOf('--opts') + 1]) : {};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<body></body>');
await page.addScriptTag({ content: await readFile(join(here, '..', '..', 'web', 'lib', 'vs-layout.js'), 'utf8') });
await page.evaluate((o) => Object.assign(self.VSLayout.PANEL_OPTS, o), opts);

/** Builds the spec in the page, as app.js does: S.img at the OCR's size, maskedCanvas's fillRect, then buildSpec. */
async function build(file, ocrId) {
  const ocr = JSON.parse(await readFile(join(bench, 'run', ocrId + '.ocr.json'), 'utf8'));
  const png = (await readFile(file)).toString('base64');
  const r = await page.evaluate(async ({ png, ocr }) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + png; await im.decode();
    const c = document.createElement('canvas'); c.width = ocr.width; c.height = ocr.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
    x.fillStyle = '#787c82'; (ocr.masks || []).forEach((m) => x.fillRect(m.x, m.y, m.w, m.h));
    const d = x.getImageData(0, 0, c.width, c.height);
    const words = ocr.words.map((w) => ({ text: w.kept ? w.text : '', x: w.x, y: w.y, w: w.w, h: w.h, kept: w.kept }));
    const out = self.VSLayout.buildSpec({ image: { data: d.data, width: d.width, height: d.height, channels: 4 }, words, masks: ocr.masks || [] });
    return { ...out, fileWidth: im.width };
  }, { png, ocr });
  // panel boxes back in the original image's pixels, where the annotations are
  const k = r.fileWidth / ocr.width;
  r.panels = r.panels.map((p) => ({ ...p, box: p.box.map((v) => v * k) }));
  r.imageArea = r.fileWidth * (r.fileWidth * ocr.height / ocr.width);
  return r;
}

const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const ALIAS = { donut: 'pie', bubble: 'scatter' };
const LENIENT = { combo: ['column', 'line', 'bar'], area: ['area', 'line'], line: ['line', 'area'], waterfall: ['column'] };
const same = (got, want, lenient) => { got = ALIAS[got] || got; return got === want || (lenient && (LENIENT[want] || []).includes(got)); };
const FILES = { powerbi: 'powerbi', tableau: 'tableau', looker: 'looker', vaultsnip: 'reports' };

// --dump file.json: every panel's signals with whether it was right, and each page's true accuracy (for calibrating
// the confidence score)
const dump = { panels: [], pages: [] };
const rows = [];
let F = 0, V = 0, P = 0, TS = 0, TL = 0;
for (const d of truth.dashboards) {
  const folder = FILES[d.tool === 'Power BI' ? 'powerbi' : d.tool.toLowerCase()];
  const r = await build(join(bench, folder, d.id + '.png'), d.id);
  const counted = r.panels.filter((p) => !(d.ignore || []).some((g) => inside(center(p.box), g)));
  const truths = d.visuals.map((v) => ({ ...v, hit: null }));
  for (const p of counted) { const t = truths.find((t) => !t.hit && inside(center(p.box), t.bbox) && inside(center(t.bbox), p.box)); if (t) t.hit = p; }
  const hits = truths.filter((t) => t.hit);
  const strict = hits.filter((t) => same(t.hit.type, t.type, false)).length, len = hits.filter((t) => same(t.hit.type, t.type, true)).length;
  for (const p of counted) { const t = truths.find((t) => t.hit === p); dump.panels.push({ dashboard: d.id, type: p.type, certainty: p.certainty, features: p.features, titled: !!p.title, area: ((p.box[2] - p.box[0]) * (p.box[3] - p.box[1])) / r.imageArea, found: !!t, correct: !!t && same(p.type, t.type, true) }); }
  dump.pages.push({ dashboard: d.id, visuals: truths.length, right: len, found: hits.length, predicted: counted.length, coverage: r.coverage, confidence: r.confidence ?? null });
  F += hits.length; V += truths.length; P += counted.length; TS += strict; TL += len;
  rows.push({ dashboard: d.id.slice(0, 28), tool: d.tool, visuals: truths.length, found: hits.length, predicted: counted.length, typesLenient: len, typesStrict: strict, ms: r.ms,
    wrong: hits.filter((t) => !same(t.hit.type, t.type, true)).map((t) => `${t.type}→${t.hit.type}`).join(' '), missed: truths.filter((t) => !t.hit).map((t) => t.type).join(' ') });
}
console.table(rows);
if (process.argv.includes('--dump')) (await import('node:fs/promises')).writeFile(process.argv[process.argv.indexOf('--dump') + 1], JSON.stringify(dump, null, 1));
console.log(`DASHBOARDS: found ${F}/${V} visuals (${Math.round((F / V) * 100)}%), ${P} panels predicted, types ${TL}/${F} lenient (${Math.round((TL / Math.max(1, F)) * 100)}%), ${TS} strict`);

// reports: structure of the whole page
const REPORTS = [
  { id: 'ssrs_report-builder-expand-matrix', want: { type: 'pivot', subtotals: true, grandTotal: true, rowDims: 2, parameters: 0 } },
  { id: 'ssrs_ssrs-tutorial-basic-table-report', want: { type: 'table', subtotals: true, grandTotal: true, groupBy: 2, parameters: 0 } },
  { id: 'ssrs_param-view-report', want: { type: 'pivot', grandTotal: true, rowDims: 1, parameters: 1 } },
];
const rrows = [];
for (const t of REPORTS) {
  let r;
  try { r = await build(join(bench, 'reports', t.id + '.png'), t.id); } catch { continue; }
  const v = r.spec.rows[0]?.visuals[0] || {};
  const got = { type: v.type, subtotals: !!v.subtotals, grandTotal: !!v.grandTotal, rowDims: (v.rowDims || []).length, groupBy: (v.groupBy || []).length, parameters: (r.spec.parameters || []).length };
  const checks = Object.entries(t.want).map(([k, w]) => got[k] === w);
  rrows.push({ report: t.id.slice(5, 40), score: `${checks.filter(Boolean).length}/${checks.length}`, ...got, columns: (v.columns || []).map((c) => c.name).join('|').slice(0, 60) });
}
console.table(rrows);
await browser.close();
