// Series layout and reference lines on generated charts (developer tool): each image is one fictional chart drawn by
// Vega-Lite (never by ECharts, which draws VaultSnip's replicas), with known truth: column, bar or line; one series,
// clustered, stacked or 100% stacked; and no reference line, or a solid or dashed one, labelled or not. The on-device
// builder reads each image as the app would after masking (axis numbers masked, label words kept) and is scored on the
// chart's type, how its series sit, whether it finds the reference line, and where it puts it.
//   node tools/synth-bench/chart-variants.mjs [--count 48] [--seed 1] [--out .bench/variants] [--json result.json]
// Privacy: everything is invented and seeded; nothing is fetched (libraries load from node_modules, locally).
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Faker, en } from '@faker-js/faker';
import { chromium } from 'playwright';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, seriesLayout } from '../layout-bench/builder.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const COUNT = +arg('--count', 48), SEED = +arg('--seed', 1), OUT = arg('--out', join(ROOT, '.bench', 'variants'));
if (arg('--json')) await rm(arg('--json'), { force: true });
const pick = (f, xs) => xs[f.number.int({ min: 0, max: xs.length - 1 })];
const CATS = ['North', 'South', 'East', 'West', 'Central', 'Online', 'Retail', 'Partner'];
const SERIES = ['Actual', 'Plan', 'Prior year'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One chart's specification and truth; every fourth kind in turn, so each combination is drawn. */
function chart(i) {
  const f = new Faker({ locale: [en], seed: SEED * 7001 + i });
  const type = ['column', 'bar', 'line'][i % 3];
  const variant = type === 'line' ? 'none' : ['none', 'clustered', 'stacked', 'percent'][Math.floor(i / 3) % 4];
  const ref = variant === 'percent' ? 'none' : ['none', 'solid', 'dashed'][Math.floor(i / 12) % 3];
  const nS = variant === 'none' ? (type === 'line' ? f.number.int({ min: 1, max: 2 }) : 1) : f.number.int({ min: 2, max: 3 });
  const cats = type === 'line' ? MONTHS.slice(0, f.number.int({ min: 6, max: 12 })) : CATS.slice(0, f.number.int({ min: 3, max: 6 }));
  const rows = cats.flatMap((cat) => SERIES.slice(0, nS).map((s) => ({ cat, s, v: f.number.int({ min: 20, max: 100 }) })));
  // the chart's largest value on its own scale (a stack's total when stacked), and the line's value on it
  const totals = cats.map((c) => rows.filter((r) => r.cat === c).reduce((a, r) => a + (variant === 'stacked' ? r.v : 0), 0));
  const peak = variant === 'stacked' ? Math.max(...totals) : Math.max(...rows.map((r) => r.v));
  const refAt = ref === 'none' ? null : Math.round(peak * f.number.float({ min: 0.35, max: 0.85 }));
  const label = ref === 'none' ? null : pick(f, ['Target', 'Average', 'Goal', null]);
  const theme = pick(f, ['light', 'light', 'dark']);
  return { id: `variant-${String(SEED).padStart(2, '0')}-${String(i).padStart(3, '0')}`, type, variant, ref, refAt, peak, label, theme, cats, nS, rows,
    width: pick(f, [420, 520, 640]), refColor: pick(f, ['#d03030', '#333333', '#e0a020']) };
}

/* ---------- drawing, in the page ---------- */
async function render(d) {
  const T = d.theme === 'dark' ? { bg: '#1f2229', fg: '#e8eaed', grid: '#3a3f4a', series: ['#6ea2ff', '#ffb070', '#7ad69a'] } : { bg: '#ffffff', fg: '#1f2328', grid: '#e1e4e8', series: ['#3b6fd8', '#e07b39', '#4caf72'] };
  const refColor = d.theme === 'dark' && d.refColor === '#333333' ? '#dddddd' : d.refColor;
  document.body.style.cssText = `margin:0;background:${T.bg}`;
  const box = document.createElement('div'); box.id = 'chart'; box.style.cssText = `display:inline-block;padding:10px;background:${T.bg}`; document.body.appendChild(box);
  const horizontal = d.type === 'bar', valueEnc = { field: 'v', type: 'quantitative', title: null, ...(d.variant === 'stacked' ? { stack: 'zero' } : d.variant === 'percent' ? { stack: 'normalize' } : { stack: null }) };
  const catEnc = { field: 'cat', type: 'nominal', sort: null, title: null };
  const color = { field: 's', type: 'nominal', sort: null, scale: { range: T.series }, legend: d.nS > 1 ? { orient: 'top', title: null } : null };
  const enc = d.type === 'line' ? { x: catEnc, y: valueEnc, color }
    : horizontal ? { y: catEnc, x: valueEnc, color, ...(d.variant === 'clustered' ? { yOffset: { field: 's', sort: null } } : {}) }
    : { x: catEnc, y: valueEnc, color, ...(d.variant === 'clustered' ? { xOffset: { field: 's', sort: null } } : {}) };
  const layers = [{ mark: d.type === 'line' ? { type: 'line', strokeWidth: 2 } : { type: 'bar' }, encoding: enc }];
  if (d.refAt != null) {
    const rule = { mark: { type: 'rule', color: refColor, strokeWidth: 2, ...(d.ref === 'dashed' ? { strokeDash: [6, 4] } : {}) }, data: { values: [{ r: d.refAt }] },
      encoding: horizontal ? { x: { field: 'r', type: 'quantitative' } } : { y: { field: 'r', type: 'quantitative' } } };
    layers.push(rule);
    if (d.label) layers.push({ mark: { type: 'text', color: refColor, align: horizontal ? 'left' : 'right', baseline: 'bottom', dx: horizontal ? 3 : 0, dy: -3, fontSize: 12 }, data: { values: [{ r: d.refAt, t: d.label }] },
      encoding: horizontal ? { x: { field: 'r', type: 'quantitative' }, y: { value: 0 }, text: { field: 't' } } : { y: { field: 'r', type: 'quantitative' }, x: { value: d.width - 4 }, text: { field: 't' } } });
  }
  const spec = { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width: d.width, height: Math.round(d.width * 0.55), background: T.bg, data: { values: d.rows },
    layer: layers, resolve: { scale: { color: 'independent' } },
    config: { font: 'sans-serif', axis: { labelColor: T.fg, gridColor: T.grid, domainColor: T.grid, labelFontSize: 12 }, legend: { labelColor: T.fg, labelFontSize: 12 }, view: { stroke: null } } };
  await new vega.View(vega.parse(vegaLite.compile(spec).spec), { renderer: 'svg', container: box }).runAsync();
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
const ROUTES = { '/vega.js': 'vega/build/vega.min.js', '/vega-lite.js': 'vega-lite/build/vega-lite.min.js' };
const PAGE = '<!doctype html><meta charset="utf-8"><script src="/vega.js"></script><script src="/vega-lite.js"></script><body></body>';
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
    const page = await browser.newPage({ viewport: { width: d.width + 200, height: 700 } });
    const offsite = [];
    await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : (offsite.push(r.request().url()), r.abort())));
    await page.goto(base);
    const t = await page.evaluate(render, d);
    const file = join(OUT, d.id + '.png');
    await page.locator('#chart').screenshot({ path: file });
    await page.close();
    if (offsite.length) throw new Error('the page tried to reach ' + offsite.join(', '));
    // as the app leaves it: numbers masked (grey boxes, no text), words kept
    const isNum = (s) => /\d/.test(s);
    const review = { width: Math.round(t.width), height: Math.round(t.height),
      words: t.words.map((w) => ({ ...w, kept: !isNum(w.text), text: isNum(w.text) ? '' : w.text })),
      masks: t.words.filter((w) => isNum(w.text)).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })) };
    const r = await builder.build(file, review);
    const visuals = r.spec.rows.flatMap((x) => x.visuals);
    const v = visuals.find((x) => ['column', 'bar', 'line', 'combo', 'area'].includes(x.type)) || visuals[0] || {};
    const typeOk = v.type === d.type || (d.type === 'line' && v.type === 'area');
    const layout = seriesLayout(v), want = d.variant;
    const refs = Array.isArray(v.refLines) ? v.refLines : [];
    // where it put the line, on the series' 0-100 scale (columns and bars: the largest single bar is 100)
    const wantShape = d.refAt == null || d.variant === 'stacked' || d.type === 'line' ? null : Math.round((d.refAt / d.peak) * 100);
    const shapeErr = refs.length && wantShape != null ? Math.abs(refs[0].shape - wantShape) : null;
    rows.push({ id: d.id, type: d.type, variant: want, ref: d.ref, label: d.label || '', got: v.type, typeOk, layout, layoutOk: d.type === 'line' || layout === want,
      refOk: (d.ref !== 'none') === (refs.length > 0), refName: refs[0]?.name || '', shapeErr });
  }
} finally {
  await builder.close(); await browser.close(); server.close();
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const typed = rows.filter((x) => x.typeOk), bars = typed.filter((x) => x.type !== 'line');
const withRef = typed.filter((x) => x.ref !== 'none'), noRef = typed.filter((x) => x.ref === 'none');
const named = withRef.filter((x) => x.label && x.refName === x.label).length, labelled = withRef.filter((x) => x.label).length;
const errs = typed.map((x) => x.shapeErr).filter((e) => e != null);
const result = { chartVariants: { charts: rows.length, typesRightPct: pct(typed.length, rows.length),
  seriesLayout: { checked: bars.length, right: bars.filter((x) => x.layoutOk).length, rightPct: pct(bars.filter((x) => x.layoutOk).length, bars.length),
    byVariant: Object.fromEntries(['none', 'clustered', 'stacked', 'percent'].map((k) => { const b = bars.filter((x) => x.variant === k); return [k, `${b.filter((x) => x.layoutOk).length}/${b.length}`]; })) },
  refLines: { withLine: withRef.length, found: withRef.filter((x) => x.refOk).length, foundPct: pct(withRef.filter((x) => x.refOk).length, withRef.length),
    solid: `${withRef.filter((x) => x.ref === 'solid' && x.refOk).length}/${withRef.filter((x) => x.ref === 'solid').length}`, dashed: `${withRef.filter((x) => x.ref === 'dashed' && x.refOk).length}/${withRef.filter((x) => x.ref === 'dashed').length}`,
    withoutLine: noRef.length, addedWhereNone: noRef.filter((x) => !x.refOk).length, namedFromLabel: `${named}/${labelled}`,
    medianPositionError: errs.length ? [...errs].sort((a, b) => a - b)[errs.length >> 1] : null } } };
console.table(rows.map(({ id, ...x }) => ({ id: id.slice(-3), ...x })));
console.log(JSON.stringify(result, null, 1));
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify(result, null, 1) + '\n');
