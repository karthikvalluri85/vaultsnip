// A side-by-side gallery (developer tool): for some generated (fictional) dashboards, the masked image a user approves,
// the replica built on the device and the AI's replica (tools/ai-bench answers), drawn live by VaultSnip's own engine,
// with each path's visuals typed right. One self-contained HTML page, to judge resemblance by eye.
//   node tools/synth-bench/gallery.mjs --out gallery.html [--dir .bench/synth] [--ids 000,003,010]
// Only generated dashboards (synth-*) can be used: their data is invented. Run tools/synth-bench/run.mjs and
// tools/ai-bench/run.mjs on the same set first.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../layout-bench/items.mjs';
import { layoutBuilder, same, scorePage } from '../layout-bench/builder.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth')), OUT = arg('--out');
if (!OUT) { console.error('usage: node tools/synth-bench/gallery.mjs --out gallery.html [--dir .bench/synth] [--ids 000,003]'); process.exit(2); }
const IDS = arg('--ids', '000,003,010,016,023,033,039,045,050,057').split(',').map((n) => 'synth-01-' + n.trim());
const TYPE = { hbar: 'bar' };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<body></body>');
const builder = await layoutBuilder();
const items = [];
const maps = new Set();
for (const id of IDS) {
  const truth = JSON.parse(await readFile(join(DIR, id + '.truth.json'), 'utf8'));
  const review = JSON.parse(await readFile(join(DIR, id + '.review.json'), 'utf8'));
  const rec = JSON.parse(await readFile(join(DIR, id + '.ai.json'), 'utf8'));
  const img = (await readFile(join(DIR, truth.file))).toString('base64');
  // the masked image, as the user approves it (solid grey boxes), scaled to at most 1100 px wide
  const masked = await page.evaluate(async ({ img, mime, review }) => {
    const im = new Image(); im.src = `data:${mime};base64,` + img; await im.decode();
    const c = document.createElement('canvas'); c.width = review.width; c.height = review.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
    x.fillStyle = '#787c82'; review.masks.forEach((m) => x.fillRect(m.x, m.y, m.w, m.h));
    const k = Math.min(1, 1100 / c.width), d = document.createElement('canvas');
    d.width = Math.round(c.width * k); d.height = Math.round(c.height * k);
    d.getContext('2d').drawImage(c, 0, 0, d.width, d.height);
    return { url: d.toDataURL('image/jpeg', 0.74), w: d.width, h: d.height };
  }, { img, mime: /jpe?g$/.test(truth.file) ? 'image/jpeg' : 'image/png', review });
  const local = await builder.build(join(DIR, truth.file), review);
  const want = truth.panels.map((p) => TYPE[p.type] || p.type);
  const s = scorePage(local.panels, want.map((type, i) => ({ type, bbox: truth.panels[i].box })));
  const aiTypes = rec.spec.rows.flatMap((r) => r.visuals.map((v) => v.type)), left = [...aiTypes];
  let aiRight = 0;
  for (const t of want) { const i = left.findIndex((g) => same(g, t, true)); if (i >= 0) { left.splice(i, 1); aiRight++; } }
  [local.spec, rec.spec].forEach((sp) => sp.rows.forEach((r) => r.visuals.forEach((v) => { if (v.type === 'map' && v.basemap) maps.add(v.basemap); })));
  items.push({ id, title: truth.panels.map((p) => p.title).filter(Boolean).slice(0, 2).join(' · '), theme: truth.style?.theme || 'light', width: truth.width,
    masked, local: local.spec, ai: rec.spec, visuals: want.length, localRight: s.lenient, aiRight, aiExtra: Math.max(0, aiTypes.length - want.length),
    localExtra: s.counted.length - s.hits.length, aiMs: rec.ms, aiTokens: (rec.usage?.input || 0) + (rec.usage?.output || 0) });
  console.log(id, want.length, 'visuals; on device', s.lenient, '; Claude', aiRight);
}
await builder.close(); await browser.close();

const mapData = {};
for (const m of maps) mapData[m] = JSON.parse(await readFile(join(ROOT, 'web/maps', m + '.json'), 'utf8'));
const tpl = await readFile(join(ROOT, 'tools/synth-bench/gallery-page.html'), 'utf8');
const replica = await readFile(join(ROOT, 'web/replica.js'), 'utf8'), faker = await readFile(join(ROOT, 'web/lib/vs-faker.js'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const html = tpl
  .replace('/*FAKER*/', () => safe(faker))
  .replace('/*REPLICA*/', () => safe(replica))
  .replace('/*DATA*/', () => safe(`window.GALLERY = ${JSON.stringify(items)}; window.GALLERY_MAPS = ${JSON.stringify(mapData)};`));
await writeFile(OUT, html);
console.log('wrote', OUT, Math.round(html.length / 1024), 'KB; maps', [...maps].join(', '));
