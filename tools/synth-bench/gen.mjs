// Generates fictional dashboards with every word's position and kind known, for measuring masking (developer tool).
//   node tools/synth-bench/gen.mjs [--count 60] [--seed 1] [--out .bench/synth]
// Writes <id>.png or <id>.jpg and <id>.truth.json: { width, height, words: [{ text, x, y, w, h, kind, sensitive }],
// panels: [{ type, box }] } in the image's pixels.
//
// Independence: charts are drawn by Vega-Lite, Plotly and plain HTML, never by ECharts (which draws VaultSnip's
// replicas), and each word's kind comes from how it was generated, never from VaultSnip's classifier.
// Privacy: everything is invented and seeded. People and companies come from Faker, emails use example.com/.net/.org,
// IDs and numbers are random. Nothing is fetched: libraries and fonts load from node_modules through a local server.
// Variety: three fonts (Inter, Roboto Slab, IBM Plex Mono), light, dark and low-contrast themes, 10-16 px text, rotated
// axis labels, 1x and 2x pixel density, PNG and JPEG at several qualities.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Faker, en } from '@faker-js/faker';
import { chromium } from 'playwright';
import { ALLOW_WORDS } from '../../src/shared/allowlist.ts';
import { ROOT } from '../layout-bench/items.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const COUNT = +arg('--count', 60), SEED = +arg('--seed', 1), OUT = arg('--out', join(ROOT, '.bench', 'synth'));
const ALLOW = new Set(ALLOW_WORDS);

/* ---------- vocabulary: safe words come only from VaultSnip's allowlist, so "safe" means safe by its policy ---------- */
const allowed = (s) => s.split(/\s+/).every((w) => ALLOW.has(w.toLowerCase()));
const pick = (f, xs) => xs[f.number.int({ min: 0, max: xs.length - 1 })];
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const MEASURES = ['revenue', 'sales', 'profit', 'cost', 'orders', 'customers', 'sessions', 'clicks', 'leads', 'units', 'margin', 'spend', 'budget', 'bookings', 'visits'].filter(allowed);
const DIMS = { name: ['customer', 'client', 'employee', 'user'], org: ['account', 'client', 'customer'], place: ['city', 'region', 'country', 'territory', 'store'], product: ['product', 'segment'] };
for (const k of Object.keys(DIMS)) DIMS[k] = DIMS[k].filter(allowed);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One fictional dashboard: panels with their data, plus the kind of every word the generator wrote. */
function dashboard(i) {
  const f = new Faker({ locale: [en], seed: SEED * 100003 + i });
  const kinds = new Map();                                     // word (normalised) → kind; sensitive kinds win
  const SENSITIVE = new Set(['name', 'org', 'email', 'id', 'place', 'product', 'number']);
  const note = (text, kind) => {
    for (const w of String(text).split(/\s+/)) {
      const k = norm(w); if (!k) continue;
      // a person's every name part is sensitive; in other names, words the policy calls safe ("and", "group") are not
      const kk = kind !== 'name' && SENSITIVE.has(kind) && ALLOW.has(k) && !/\d/.test(k) ? 'label' : kind;
      if (!kinds.has(k) || SENSITIVE.has(kk)) kinds.set(k, kk);
    }
    return text;
  };
  const entity = (kind) => {
    if (kind === 'name') return note(f.person.fullName(), 'name');
    if (kind === 'org') return note(f.company.name(), 'org');
    if (kind === 'place') return note(f.location.city(), 'place');
    if (kind === 'product') return note(cap(f.commerce.productName()), 'product');
    if (kind === 'email') return note(f.internet.email({ provider: pick(f, ['example.com', 'example.net', 'example.org']) }).toLowerCase(), 'email');
    return note(`${f.string.alpha({ length: 3, casing: 'upper' })}-${f.string.numeric(5)}`, 'id');
  };
  const money = () => note(pick(f, [`$${f.number.float({ min: 1, max: 99, fractionDigits: 1 })}M`, `$${f.number.int({ min: 1000, max: 999999 }).toLocaleString('en-US')}`,
    `€${f.number.int({ min: 100, max: 99999 }).toLocaleString('en-US')}`, `${f.number.float({ min: 1, max: 99, fractionDigits: 1 })}K`]), 'number');
  const pct = () => note(`${f.number.float({ min: 0.5, max: 99, fractionDigits: 1 })}%`, 'number');
  const delta = () => note(`${pick(f, ['+', '−'])}${f.number.float({ min: 0.1, max: 30, fractionDigits: 1 })}%`, 'number');
  const label = (s) => note(s, 'label');

  const measure = () => pick(f, MEASURES);
  const dimKind = () => pick(f, ['name', 'org', 'place', 'product']);
  const title = (m, d) => label(cap(d ? `${m} by ${d}` : `${pick(f, ['total', 'average', 'net', 'gross'].filter(allowed))} ${m}`));
  const panels = [];
  const n = f.number.int({ min: 4, max: 9 });
  for (let p = 0; p < n; p++) {
    const type = pick(f, ['kpi', 'kpi', 'table', 'bar', 'column', 'line', 'pie', 'hbar']);
    const m = measure();
    if (type === 'kpi') { panels.push({ type, title: title(m), value: pick(f, [money, pct])(), delta: f.datatype.boolean() ? delta() : null }); continue; }
    if (type === 'table') {
      const cols = f.helpers.arrayElements(['name', 'org', 'email', 'id', 'place', 'money', 'pct'], { min: 3, max: 5 });
      const head = { name: pick(f, DIMS.name), org: pick(f, DIMS.org), email: 'email', id: pick(f, ['code', 'id', 'number'].filter(allowed)), place: pick(f, DIMS.place), money: m, pct: pick(f, ['share', 'rate', 'growth', 'margin'].filter(allowed)) };
      const rows = Array.from({ length: f.number.int({ min: 3, max: 8 }) }, () => cols.map((c) => (c === 'money' ? money() : c === 'pct' ? pct() : entity(c))));
      panels.push({ type, title: title(m, cap(head[cols[0]])), head: cols.map((c) => label(cap(head[c]))), rows }); continue;
    }
    const dk = dimKind();
    const k = type === 'line' ? 'month' : dk;
    const cats = type === 'line' ? MONTHS.slice(0, f.number.int({ min: 5, max: 12 })).map((x) => note(x, ALLOW.has(x.toLowerCase()) ? 'label' : 'period'))
      : Array.from({ length: f.number.int({ min: 3, max: type === 'pie' ? 5 : 7 }) }, () => entity(dk));
    const values = cats.map(() => f.number.int({ min: 5, max: 950 }) * pick(f, [1, 10, 1000]));
    panels.push({ type, title: title(m, cap(type === 'line' ? 'month' : pick(f, DIMS[k] || DIMS.place))), cats, values, measure: label(cap(m)), rotate: f.datatype.boolean() ? -45 : 0 });
  }
  const style = {
    font: pick(f, ['Inter', 'Roboto Slab', 'IBM Plex Mono']),
    size: f.number.int({ min: 10, max: 16 }),
    theme: pick(f, ['light', 'light', 'dark', 'low']),
    cols: f.number.int({ min: 2, max: 4 }),
    width: pick(f, [1000, 1280, 1440, 1600, 1920]),
    dpr: pick(f, [1, 1, 2]),
    format: pick(f, ['png', 'png', 'jpeg']),
    quality: pick(f, [60, 75, 90]),
  };
  return { id: `synth-${String(SEED).padStart(2, '0')}-${String(i).padStart(3, '0')}`, panels, style, kinds: Object.fromEntries(kinds) };
}
/** The form a word is looked up by: no surrounding punctuation, lower case. Shared with the page. */
function norm(w) { return String(w).replace(/^[^\w€$£¥₹%#@+−-]+|[^\w€$£¥₹%]+$/g, '').toLowerCase(); }

/* ---------- drawing, in the page ---------- */
async function render(d) {
  const T = { light: { bg: '#ffffff', panel: '#ffffff', fg: '#1f2328', muted: '#57606a', line: '#d0d7de', series: ['#3b6fd8', '#e07b39', '#4caf72', '#c94f7c', '#7b61c9', '#2aa6a0', '#b38b2e'] },
    dark: { bg: '#15171c', panel: '#1f2229', fg: '#e8eaed', muted: '#a3a9b3', line: '#3a3f4a', series: ['#6ea2ff', '#ffb070', '#7ad69a', '#ff86b0', '#b39dff', '#5ed6cf', '#e6c25c'] },
    low: { bg: '#f6f7f9', panel: '#fbfbfc', fg: '#8a9099', muted: '#a8adb4', line: '#e3e5e8', series: ['#9fb8e8', '#efbf9c', '#a8d8b9', '#e5a9bf', '#bdb0e5', '#9fd6d2', '#dcc89a'] } }[d.style.theme];
  const s = d.style, FONT = `'${s.font}', sans-serif`;
  document.body.style.cssText = `margin:0;background:${T.bg}`;
  const dash = document.createElement('div'); dash.id = 'dash';
  dash.style.cssText = `width:${s.width}px;padding:16px;box-sizing:border-box;display:grid;grid-template-columns:repeat(${s.cols},1fr);gap:14px;background:${T.bg};font:${s.size}px ${FONT};color:${T.fg}`;
  document.body.appendChild(dash);
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const card = (p, span) => {
    // cards clip what does not fit, as BI tools do; the truth keeps only what stays visible
    const c = el('div', `background:${T.panel};border:1px solid ${T.line};border-radius:6px;padding:12px;min-width:0;overflow:hidden;grid-column:span ${span}`);
    c.dataset.type = p.type;
    c.appendChild(el('div', `font-weight:600;margin-bottom:8px;color:${T.fg}`, p.title));
    dash.appendChild(c); return c;
  };
  const W = (s.width - 32 - 14 * (s.cols - 1)) / s.cols;
  for (const p of d.panels) {
    if (p.type === 'kpi') {
      const c = card(p, 1);
      c.appendChild(el('div', `font-size:${Math.round(s.size * 2.2)}px;font-weight:700`, p.value));
      if (p.delta) c.appendChild(el('div', `color:${p.delta.startsWith('+') ? '#2e9e5b' : '#d04545'};margin-top:4px`, p.delta));
      continue;
    }
    const span = Math.min(s.cols, p.type === 'table' ? 2 : 1 + (p.cats.length > 5 ? 1 : 0));
    const c = card(p, span), w = W * span + 14 * (span - 1) - 26;
    if (p.type === 'table') {
      const t = el('table', `border-collapse:collapse;width:100%;font-size:${s.size}px`);
      const tr = el('tr'); p.head.forEach((h) => tr.appendChild(el('th', `text-align:left;padding:4px 6px;border-bottom:1px solid ${T.line};color:${T.muted}`, h))); t.appendChild(tr);
      p.rows.forEach((r) => { const row = el('tr'); r.forEach((v) => row.appendChild(el('td', `padding:4px 6px;border-bottom:1px solid ${T.line};white-space:nowrap`, v))); t.appendChild(row); });
      c.appendChild(t); continue;
    }
    const box = el('div'); c.appendChild(box);
    const h = Math.round(w * 0.55);
    if (p.type === 'pie' || p.type === 'hbar') {
      const data = p.type === 'pie' ? [{ type: 'pie', labels: p.cats, values: p.values, textinfo: 'percent', sort: false, marker: { colors: T.series } }]
        : [{ type: 'bar', orientation: 'h', y: p.cats, x: p.values, marker: { color: T.series[0] } }];
      await Plotly.newPlot(box, data, { width: w, height: h, margin: { l: p.type === 'hbar' ? 150 : 10, r: 10, t: 10, b: 30 }, paper_bgcolor: T.panel, plot_bgcolor: T.panel,
        font: { family: FONT, size: s.size, color: T.fg }, showlegend: p.type === 'pie', xaxis: { gridcolor: T.line }, yaxis: { automargin: true } }, { staticPlot: true, displayModeBar: false });
      continue;
    }
    const vl = {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width: w, height: h, autosize: { type: 'fit', contains: 'padding' }, background: T.panel,
      data: { values: p.cats.map((cat, i) => ({ cat, v: p.values[i] })) },
      mark: p.type === 'line' ? { type: 'line', point: true, color: T.series[0] } : { type: 'bar', color: T.series[0] },
      encoding: p.type === 'bar'
        ? { y: { field: 'cat', type: 'nominal', sort: null, title: null }, x: { field: 'v', type: 'quantitative', title: p.measure } }
        : { x: { field: 'cat', type: 'nominal', sort: null, title: null, axis: { labelAngle: p.rotate } }, y: { field: 'v', type: 'quantitative', title: p.measure } },
      config: { font: FONT, axis: { labelLimit: 140, labelColor: T.fg, titleColor: T.muted, gridColor: T.line, domainColor: T.line, labelFontSize: s.size, titleFontSize: s.size }, view: { stroke: null } },
    };
    const view = new vega.View(vega.parse(vegaLite.compile(vl).spec), { renderer: 'svg', container: box });
    await view.runAsync();
  }
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // every visible word with its box, from the text nodes themselves (HTML and SVG alike)
  const R = dash.getBoundingClientRect(), words = [], panels = [];
  const walker = document.createTreeWalker(dash, NodeFilter.SHOW_TEXT);
  const norm = (w) => w.replace(/^[^\w€$£¥₹%#@+−-]+|[^\w€$£¥₹%]+$/g, '').toLowerCase();
  for (let n; (n = walker.nextNode());) {
    const pe = n.parentElement, cs = getComputedStyle(pe);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || pe.closest('defs,clipPath,title')) continue;
    for (const m of n.textContent.matchAll(/\S+/g)) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect();
      // only the part inside its card (cards clip) and inside the image is visible
      const C = (pe.closest('#dash > div') || dash).getBoundingClientRect();
      const x0 = Math.max(b.left, C.left, R.left), y0 = Math.max(b.top, C.top, R.top), x1 = Math.min(b.right, C.right, R.right), y1 = Math.min(b.bottom, C.bottom, R.bottom);
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;
      const k = norm(m[0]);
      const kind = d.kinds[k] || (/\d/.test(k) ? 'number' : k ? 'unknown' : 'punctuation');
      // rotated text gets its upright bounding box, which also holds background; such words are marked
      // chart libraries wrap every label in a transform, often rotate(0): only a real angle counts
      let rotated = false;
      for (let a = pe; a && a !== dash; a = a.parentElement) {
        const m = /rotate\(\s*(-?[\d.]+)/.exec(a.getAttribute('transform') || '');
        if (m && Math.abs(parseFloat(m[1])) % 180 > 1) { rotated = true; break; }
      }
      words.push({ text: m[0], x: x0 - R.left, y: y0 - R.top, w: x1 - x0, h: y1 - y0, kind, clipped: x1 - x0 < b.width - 1 || y1 - y0 < b.height - 1, rotated });
    }
  }
  for (const c of dash.children) { const b = c.getBoundingClientRect(); panels.push({ type: c.dataset.type, box: [b.left - R.left, b.top - R.top, b.right - R.left, b.bottom - R.top] }); }
  return { words, panels, width: R.width, height: R.height };
}

/** Each word's box shrunk to its ink in the saved image: a text box holds the whole line height, a mask covers letters.
 *  The background is the commonest colour on the box's edge; ink is any pixel clearly different from it (JPEG noise
 *  stays under the threshold). Rotated words keep their upright box. In the page, on the screenshot itself. */
async function ink({ src, boxes }) {
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const r1 = (v) => Math.round(v * 10) / 10;
  return boxes.map((b) => {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), x1 = Math.min(c.width, Math.ceil(b.x + b.w)), y1 = Math.min(c.height, Math.ceil(b.y + b.h));
    const out = { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h), ink: false };
    if (b.skip || x1 - x0 < 2 || y1 - y0 < 2) return out;
    const d = x.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0, H = y1 - y0;
    const at = (i, j) => (j * W + i) * 4;
    const count = new Map();
    for (let i = 0; i < W; i++) for (const j of [0, H - 1]) { const p = at(i, j), key = (d[p] >> 4) << 8 | (d[p + 1] >> 4) << 4 | (d[p + 2] >> 4); count.set(key, (count.get(key) || 0) + 1); }
    for (let j = 0; j < H; j++) for (const i of [0, W - 1]) { const p = at(i, j), key = (d[p] >> 4) << 8 | (d[p + 1] >> 4) << 4 | (d[p + 2] >> 4); count.set(key, (count.get(key) || 0) + 1); }
    const bgKey = [...count].sort((a, b2) => b2[1] - a[1])[0][0];
    const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];
    let ix0 = W, iy0 = H, ix1 = -1, iy1 = -1, n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = at(i, j);
      if (Math.max(Math.abs(d[p] - bg[0]), Math.abs(d[p + 1] - bg[1]), Math.abs(d[p + 2] - bg[2])) > 48) { n++; if (i < ix0) ix0 = i; if (i > ix1) ix1 = i; if (j < iy0) iy0 = j; if (j > iy1) iy1 = j; }
    }
    if (n < 3) return out;
    return { x: x0 + ix0, y: y0 + iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1, ink: true };
  });
}

/* ---------- a local server:the page and its libraries and fonts from node_modules, nothing else ---------- */
const NM = join(ROOT, 'node_modules');
const ROUTES = { '/vega.js': 'vega/build/vega.min.js', '/vega-lite.js': 'vega-lite/build/vega-lite.min.js', '/plotly.js': 'plotly.js-dist-min/plotly.min.js' };
const FONTS = [['Inter', '@fontsource/inter/files/inter-latin-400-normal.woff2', 400], ['Inter', '@fontsource/inter/files/inter-latin-700-normal.woff2', 700],
  ['Roboto Slab', '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff2', 400], ['Roboto Slab', '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff2', 700],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 400], ['IBM Plex Mono', '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2', 700]];
const PAGE = `<!doctype html><meta charset="utf-8"><style>${FONTS.map(([f, file, w]) => `@font-face{font-family:'${f}';font-weight:${w};src:url(/fonts/${file.split('/').pop()})}`).join('')}</style>
<script src="/vega.js"></script><script src="/vega-lite.js"></script><script src="/plotly.js"></script><body></body>`;
const fontFile = Object.fromEntries(FONTS.map(([, file]) => ['/fonts/' + file.split('/').pop(), file]));
const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/\\/g, '/');
  try {
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    const rel = ROUTES[path] || fontFile[path];
    if (!rel) throw new Error('not served');
    res.writeHead(200, { 'content-type': extname(rel) === '.js' ? 'text/javascript' : 'font/woff2' });
    res.end(await readFile(join(NM, rel)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  for (let i = 0; i < COUNT; i++) {
    const d = dashboard(i);
    const page = await browser.newPage({ viewport: { width: d.style.width, height: 900 }, deviceScaleFactor: d.style.dpr });
    // nothing leaves this machine: any request outside the local server is refused and stops the run
    const offsite = [];
    await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : (offsite.push(r.request().url()), r.abort())));
    await page.goto(base);
    const t = await page.evaluate(render, d);
    const ext = d.style.format === 'jpeg' ? 'jpg' : 'png';
    const shot = await page.locator('#dash').screenshot({ path: join(OUT, `${d.id}.${ext}`), type: d.style.format, ...(d.style.format === 'jpeg' ? { quality: d.style.quality } : {}) });
    const k = d.style.dpr, px = (v) => Math.round(v * k * 10) / 10;
    const boxes = await page.evaluate(ink, { src: `data:image/${d.style.format};base64,${shot.toString('base64')}`,
      boxes: t.words.map((w) => ({ x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k, skip: w.rotated })) });
    await page.close();
    if (offsite.length) throw new Error('the page tried to reach ' + offsite.join(', '));
    const words = t.words.map((w, j) => ({ ...w, ...boxes[j], sensitive: ['name', 'org', 'email', 'id', 'place', 'product', 'number'].includes(w.kind) }));
    await writeFile(join(OUT, `${d.id}.truth.json`), JSON.stringify({ id: d.id, file: `${d.id}.${ext}`, width: Math.round(t.width * k), height: Math.round(t.height * k), style: d.style,
      words, panels: t.panels.map((p) => ({ type: p.type, box: p.box.map(px) })) }));
    const sens = words.filter((w) => w.sensitive).length, unk = words.filter((w) => w.kind === 'unknown');
    console.log(`  ✓ ${d.id} ${d.style.width * k}px ${d.style.theme} ${d.style.font} ${d.style.size}px ${ext}: ${words.length} words, ${sens} sensitive${unk.length ? `, ${unk.length} unknown (${unk.slice(0, 4).map((w) => w.text).join(' ')})` : ''}`);
  }
} finally {
  await browser.close();
  server.close();
}
