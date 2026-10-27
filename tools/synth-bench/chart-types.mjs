// More chart types on generated charts (developer tool): gauges and funnels drawn by Plotly, Gantt charts and heatmaps
// by Vega-Lite (never by ECharts, which draws VaultSnip's replicas), plus column, pie and line charts as controls, each
// image one fictional chart. The on-device builder reads each as the app would after masking (numbers masked, label
// words kept) and is scored on the type it gives.
//   node tools/synth-bench/chart-types.mjs [--count 40] [--seed 1] [--out .bench/types] [--json result.json]
// Privacy: everything is invented and seeded; nothing is fetched (libraries load from node_modules, locally).
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Faker, en } from '@faker-js/faker';
import { chromium } from 'playwright';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, same } from '../layout-bench/builder.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const COUNT = +arg('--count', 40), SEED = +arg('--seed', 1), OUT = arg('--out', join(ROOT, '.bench', 'types'));
if (arg('--json')) await rm(arg('--json'), { force: true });
const pick = (f, xs) => xs[f.number.int({ min: 0, max: xs.length - 1 })];
const TYPES = ['gauge', 'funnel', 'gantt', 'heatmap', 'column', 'pie', 'line', 'gauge', 'funnel', 'gantt'];
const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Onboarded'];
const TASKS = ['Discovery', 'Design', 'Build', 'Testing', 'Launch', 'Review', 'Training'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], HOURS = ['8am', '10am', '12pm', '2pm', '4pm', '6pm'];
const CATS = ['North', 'South', 'East', 'West', 'Central'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

function chart(i) {
  const f = new Faker({ locale: [en], seed: SEED * 9001 + i });
  const type = TYPES[i % TYPES.length];
  const theme = pick(f, ['light', 'light', 'dark']);
  const width = pick(f, [420, 520, 640]);
  const d = { id: `type-${String(SEED).padStart(2, '0')}-${String(i).padStart(3, '0')}`, type, theme, width };
  if (type === 'gauge') Object.assign(d, { value: f.number.int({ min: 10, max: 95 }), title: pick(f, ['Completion', 'Utilisation', 'Target reached']) });
  if (type === 'funnel') Object.assign(d, { stages: STAGES.slice(0, f.number.int({ min: 4, max: 6 })), values: [] });
  if (type === 'funnel') { let v = 1000; for (const _ of d.stages) { d.values.push(v); v = Math.round(v * f.number.float({ min: 0.45, max: 0.85 })); } }
  if (type === 'gantt') { const n = f.number.int({ min: 4, max: 7 }); let t = 0; d.tasks = TASKS.slice(0, n).map((name) => { const s = t + f.number.int({ min: -5, max: 10 }); const e = s + f.number.int({ min: 10, max: 30 }); t = Math.max(0, s + 8); return { name, start: Math.max(0, s), end: e }; }); }
  if (type === 'heatmap') d.cells = DAYS.slice(0, f.number.int({ min: 4, max: 7 })).flatMap((day) => HOURS.map((h) => ({ day, h, v: f.number.int({ min: 0, max: 100 }) })));
  if (type === 'column' || type === 'pie') d.rows = CATS.map((c) => ({ c, v: f.number.int({ min: 20, max: 100 }) }));
  if (type === 'line') d.rows = MONTHS.map((c) => ({ c, v: f.number.int({ min: 20, max: 100 }) }));
  return d;
}

/* ---------- drawing, in the page ---------- */
async function render(d) {
  const T = d.theme === 'dark' ? { bg: '#1f2229', fg: '#e8eaed', grid: '#3a3f4a', series: ['#6ea2ff', '#ffb070', '#7ad69a', '#ff86b0', '#b39dff'] } : { bg: '#ffffff', fg: '#1f2328', grid: '#e1e4e8', series: ['#3b6fd8', '#e07b39', '#4caf72', '#c94f7c', '#7b61c9'] };
  document.body.style.cssText = `margin:0;background:${T.bg}`;
  const box = document.createElement('div'); box.id = 'chart'; box.style.cssText = `display:inline-block;padding:10px;background:${T.bg}`; document.body.appendChild(box);
  const h = Math.round(d.width * 0.6);
  const plotly = async (data, layout) => Plotly.newPlot(box, data, { width: d.width, height: h, paper_bgcolor: T.bg, plot_bgcolor: T.bg, font: { color: T.fg, size: 12 }, margin: { l: 90, r: 20, t: 30, b: 30 }, ...layout }, { staticPlot: true, displayModeBar: false });
  const vl = async (spec) => new vega.View(vega.parse(vegaLite.compile({ $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width: d.width, height: h, background: T.bg,
    config: { font: 'sans-serif', axis: { labelColor: T.fg, gridColor: T.grid, domainColor: T.grid, labelFontSize: 12, titleColor: T.fg }, legend: { labelColor: T.fg }, view: { stroke: null } }, ...spec }).spec), { renderer: 'svg', container: box }).runAsync();
  if (d.type === 'gauge') await plotly([{ type: 'indicator', mode: 'gauge+number', value: d.value, title: { text: d.title }, gauge: { axis: { range: [0, 100], visible: false }, bar: { color: T.series[0] }, bgcolor: T.grid, borderwidth: 0 } }], { margin: { l: 30, r: 30, t: 50, b: 10 } });
  if (d.type === 'funnel') await plotly([{ type: 'funnel', y: d.stages, x: d.values, marker: { color: T.series[0] }, textinfo: 'value' }], {});
  if (d.type === 'gantt') await vl({ data: { values: d.tasks }, mark: { type: 'bar', color: T.series[0], cornerRadius: 3 }, encoding: { y: { field: 'name', type: 'nominal', sort: null, title: null }, x: { field: 'start', type: 'quantitative', title: 'Week' }, x2: { field: 'end' } } });
  if (d.type === 'heatmap') await vl({ data: { values: d.cells }, mark: 'rect', encoding: { y: { field: 'day', type: 'nominal', sort: null, title: null }, x: { field: 'h', type: 'nominal', sort: null, title: null }, color: { field: 'v', type: 'quantitative', legend: null, scale: { scheme: d.theme === 'dark' ? 'tealblues' : 'blues' } } } });
  if (d.type === 'column') await vl({ data: { values: d.rows }, mark: { type: 'bar', color: T.series[0] }, encoding: { x: { field: 'c', type: 'nominal', sort: null, title: null }, y: { field: 'v', type: 'quantitative', title: null } } });
  if (d.type === 'line') await vl({ data: { values: d.rows }, mark: { type: 'line', color: T.series[0], strokeWidth: 2 }, encoding: { x: { field: 'c', type: 'nominal', sort: null, title: null }, y: { field: 'v', type: 'quantitative', title: null } } });
  if (d.type === 'pie') await plotly([{ type: 'pie', labels: d.rows.map((r) => r.c), values: d.rows.map((r) => r.v), marker: { colors: T.series }, textinfo: 'percent', sort: false }], { showlegend: true });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const R = box.getBoundingClientRect(), words = [];
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (n.parentElement.closest('title')) continue;
    for (const m of n.textContent.matchAll(/\S+/g)) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect();
      if (b.width < 2) continue;
      words.push({ text: m[0], x: b.left - R.left, y: b.top - R.top, w: b.width, h: b.height });
    }
  }
  return { width: R.width, height: R.height, words };
}

const NM = join(ROOT, 'node_modules');
const ROUTES = { '/vega.js': 'vega/build/vega.min.js', '/vega-lite.js': 'vega-lite/build/vega-lite.min.js', '/plotly.js': 'plotly.js-dist-min/plotly.min.js' };
const PAGE = '<!doctype html><meta charset="utf-8"><script src="/vega.js"></script><script src="/vega-lite.js"></script><script src="/plotly.js"></script><body></body>';
const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/\\/g, '/');
  try {
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (!ROUTES[path]) throw new Error('not served');
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(join(NM, ROUTES[path])));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const builder = await layoutBuilder();
const rows = [];
try {
  for (let i = 0; i < COUNT; i++) {
    const d = chart(i);
    const page = await browser.newPage({ viewport: { width: d.width + 200, height: 900 } });
    const offsite = [];
    await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : (offsite.push(r.request().url()), r.abort())));
    await page.goto(base);
    const t = await page.evaluate(render, d);
    const file = join(OUT, d.id + '.png');
    await page.locator('#chart').screenshot({ path: file });
    await page.close();
    if (offsite.length) throw new Error('the page tried to reach ' + offsite.join(', '));
    const isNum = (s) => /\d/.test(s) && !/^\d{1,2}(am|pm)$/i.test(s);
    const review = { width: Math.round(t.width), height: Math.round(t.height),
      words: t.words.map((w) => ({ ...w, kept: !isNum(w.text), text: isNum(w.text) ? '' : w.text })),
      masks: t.words.filter((w) => isNum(w.text)).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })) };
    const r = await builder.build(file, review);
    const visuals = r.spec.rows.flatMap((x) => x.visuals);
    const main = visuals.slice().sort((a, b) => (b.span || 0) - (a.span || 0))[0] || {};
    const got = visuals.some((v) => same(v.type, d.type, true)) ? d.type : main.type;
    rows.push({ id: d.id.slice(-3), type: d.type, theme: d.theme, got, ok: got === d.type, visuals: visuals.map((v) => v.type).join(' ') });
  }
} finally {
  await builder.close(); await browser.close(); server.close();
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const by = {};
for (const x of rows) { const k = by[x.type] ||= { charts: 0, right: 0 }; k.charts++; if (x.ok) k.right++; }
const added = ['gauge', 'funnel', 'gantt', 'heatmap'], ctrl = ['column', 'pie', 'line'];
const sum = (ks) => ks.reduce((a, k) => ({ charts: a.charts + (by[k]?.charts || 0), right: a.right + (by[k]?.right || 0) }), { charts: 0, right: 0 });
const nw = sum(added), co = sum(ctrl);
const result = { chartTypes: { charts: rows.length, newTypesRightPct: pct(nw.right, nw.charts), controlsRightPct: pct(co.right, co.charts),
  byType: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v.right}/${v.charts}`])) } };
console.table(rows);
console.log(JSON.stringify(result, null, 1));
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify(result, null, 1) + '\n');
