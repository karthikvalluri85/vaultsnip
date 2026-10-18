// Benchmark for the on-device layout builder (developer tool; images are not redistributed, see truth.json sources).
// Runs web/lib/vs-layout.js on each image exactly as the app does: masks drawn in the app's grey, masked words
// without text. Scores panels found, chart types and table structure against hand annotations.
//
//   node tools/layout-bench/run.mjs <bench dir>
// The bench dir holds the images (powerbi/, tableau/, looker/, reports/) and run/<id>.ocr.json from VaultSnip's own
// review step: { width, height, words: [{ text, x, y, w, h, kept }], masks: [{ x, y, w, h }] }.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawImage } from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const VSLayout = new Function(await readFile(join(here, '..', '..', 'web', 'lib', 'vs-layout.js'), 'utf8') + ';return VSLayout;')();
const bench = process.argv[2];
// optional segmentation settings to compare, as JSON: --opts '{"cross":false}'
if (process.argv.includes('--opts')) Object.assign(VSLayout.PANEL_OPTS, JSON.parse(process.argv[process.argv.indexOf('--opts') + 1]));
if (!bench) { console.error('usage: node tools/layout-bench/run.mjs <bench dir>'); process.exit(1); }
const truth = JSON.parse(await readFile(join(here, 'truth.json'), 'utf8'));

const MASK = [0x78, 0x7c, 0x82];
async function load(file, ocrId) {
  const raw = await RawImage.read(file);
  const img = raw.channels === 4 ? raw : raw.channels === 3 ? raw : raw.rgb();
  const { width: W, height: H, channels: C } = img, data = new Uint8ClampedArray(img.data);
  const ocr = JSON.parse(await readFile(join(bench, 'run', ocrId + '.ocr.json'), 'utf8'));
  const k = W / ocr.width;
  for (const m of ocr.masks || []) {
    for (let y = Math.max(0, Math.floor(m.y * k)); y < Math.min(H, Math.ceil((m.y + m.h) * k)); y++) for (let x = Math.max(0, Math.floor(m.x * k)); x < Math.min(W, Math.ceil((m.x + m.w) * k)); x++) {
      const i = (y * W + x) * C; data[i] = MASK[0]; data[i + 1] = MASK[1]; data[i + 2] = MASK[2]; if (C === 4) data[i + 3] = 255;
    }
  }
  const words = ocr.words.map((w) => ({ text: w.text, kept: w.kept, x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k }));
  const masks = (ocr.masks || []).map((m) => ({ x: m.x * k, y: m.y * k, w: m.w * k, h: m.h * k }));
  return { image: { data, width: W, height: H, channels: C }, words, masks };
}

const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const ALIAS = { donut: 'pie', bubble: 'scatter' };
const LENIENT = { combo: ['column', 'line', 'bar'], area: ['area', 'line'], line: ['line', 'area'], waterfall: ['column'] };
const same = (got, want, lenient) => { got = ALIAS[got] || got; return got === want || (lenient && (LENIENT[want] || []).includes(got)); };
const FILES = { powerbi: 'powerbi', tableau: 'tableau', looker: 'looker' };

const rows = [];
let F = 0, V = 0, P = 0, TS = 0, TL = 0;
for (const d of truth.dashboards) {
  const folder = FILES[d.tool === 'Power BI' ? 'powerbi' : d.tool.toLowerCase()];
  const input = await load(join(bench, folder, d.id + '.png'), d.id);
  const r = VSLayout.buildSpec(input);
  const counted = r.panels.filter((p) => !(d.ignore || []).some((g) => inside(center(p.box), g)));
  const truths = d.visuals.map((v) => ({ ...v, hit: null }));
  for (const p of counted) { const t = truths.find((t) => !t.hit && inside(center(p.box), t.bbox) && inside(center(t.bbox), p.box)); if (t) t.hit = p; }
  const hits = truths.filter((t) => t.hit);
  const strict = hits.filter((t) => same(t.hit.type, t.type, false)).length, len = hits.filter((t) => same(t.hit.type, t.type, true)).length;
  F += hits.length; V += truths.length; P += counted.length; TS += strict; TL += len;
  rows.push({ dashboard: d.id.slice(0, 28), tool: d.tool, visuals: truths.length, found: hits.length, predicted: counted.length, typesLenient: len, typesStrict: strict, ms: r.ms,
    wrong: hits.filter((t) => !same(t.hit.type, t.type, true)).map((t) => `${t.type}→${t.hit.type}`).join(' '), missed: truths.filter((t) => !t.hit).map((t) => t.type).join(' ') });
}
console.table(rows);
console.log(`DASHBOARDS: found ${F}/${V} visuals (${Math.round((F / V) * 100)}%), ${P} panels predicted, types ${TL}/${F} lenient (${Math.round((TL / Math.max(1, F)) * 100)}%), ${TS} strict`);

// reports: structure of the whole page
const REPORTS = [
  { id: 'ssrs_report-builder-expand-matrix', want: { type: 'pivot', subtotals: true, grandTotal: true, rowDims: 2, parameters: 0 } },
  { id: 'ssrs_ssrs-tutorial-basic-table-report', want: { type: 'table', subtotals: true, grandTotal: true, groupBy: 2, parameters: 0 } },
  { id: 'ssrs_param-view-report', want: { type: 'pivot', grandTotal: true, rowDims: 1, parameters: 1 } },
];
const rrows = [];
for (const t of REPORTS) {
  let input;
  try { input = await load(join(bench, 'reports', t.id + '.png'), t.id); } catch { continue; }
  const r = VSLayout.buildSpec(input), v = r.spec.rows[0]?.visuals[0] || {};
  const got = { type: v.type, subtotals: !!v.subtotals, grandTotal: !!v.grandTotal, rowDims: (v.rowDims || []).length, groupBy: (v.groupBy || []).length, parameters: (r.spec.parameters || []).length };
  const checks = Object.entries(t.want).map(([k, w]) => got[k] === w);
  rrows.push({ report: t.id.slice(5, 40), score: `${checks.filter(Boolean).length}/${checks.length}`, ...got, columns: (v.columns || []).map((c) => c.name).join('|').slice(0, 60) });
}
console.table(rrows);
