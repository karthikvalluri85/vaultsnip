// Can a visual's type be chosen by DRAWING it? (developer experiment, real dashboards)
//
// The builder picks a chart type from rules over the marks it finds. This asks a different question: draw the visual
// as each type the replica engine can draw, compare each drawing with that visual's panel in the masked image
// (web/selfcheck.js, the app's own on-device check), and see whether the closest drawing is the right type. If it is,
// the app can settle a type by appearance instead of by rule, which is what "looks like the original" means.
//
//   node tools/layout-bench/typecheck.mjs [bench dir] [--json out.json] [--only id]
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { DEFAULT_BENCH, ROOT, items, truth } from './items.mjs';
import { layoutBuilder, same } from './builder.mjs';
import { fidelity } from './fidelity.mjs';

const arg = (name, d = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const bench = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : DEFAULT_BENCH;
if (arg('--json')) await rm(arg('--json'), { force: true });
const FIRST12 = new Set(['sample-it-spend_it3', 'sample-procurement_discount-analysis', 'sample-human-resources_hr-3', 'sample-procurement_spend-overview',
  'FinanceDashboard', 'ClinicPerformanceDashboard', 'KPI-Progress-Status', 'HRAnalytics', 'new-dashboard-example-2206',
  'looker-tabbed-dashboard-example', 'add-text-results-2218', 'kestrelmoor']);
// the types worth drawing: every one a panel of marks could plausibly be, kpi and text excluded (they draw no chart,
// so the comparison, which is of drawings, says nothing about them)
const CANDIDATES = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'treemap', 'scatter', 'map', 'heatmap', 'funnel', 'waterfall', 'gauge'];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.setContent('<body style="margin:0"><div id="r"></div></body>');
for (const f of ['web/lib/echarts.min.js', 'web/lib/vs-faker.js', 'web/replica.js', 'web/selfcheck.js']) await page.addScriptTag({ content: await readFile(join(ROOT, f), 'utf8') });
for (const m of ['world', 'usa', 'europe']) {
  const json = await readFile(join(ROOT, 'web/maps', m + '.json'), 'utf8').catch(() => null);
  if (json) await page.evaluate(({ name, json }) => window.DSCReplica.addMap && window.DSCReplica.addMap(name, JSON.parse(json)), { name: m, json });
}

const byId = Object.fromEntries(items(bench).map((it) => [it.id, it]));
const builder = await layoutBuilder();
const rows = [];
try {
  for (const d of truth.dashboards.filter((x) => (arg('--only') ? x.id === arg('--only') : !FIRST12.has(x.id)))) {
    const it = byId[d.id];
    const review = JSON.parse(await readFile(it.ocr, 'utf8'));
    const r = await builder.build(it.file, review);
    const f = fidelity(r.panels, d.visuals);
    const vis = Object.fromEntries(r.spec.rows.flatMap((row) => row.visuals).map((v) => [v.id, v]));
    const k = review.width / r.fileWidth;
    const img = (await readFile(it.file)).toString('base64');
    const jobs = f.found.filter((t) => vis[t.hit.vid] && CANDIDATES.includes(t.hit.type) || CANDIDATES.includes(t.type))
      .map((t) => ({ vid: t.hit.vid, truth: t.type, got: t.hit.type, box: t.hit.box.map((v) => v * k) }))
      .filter((j) => vis[j.vid]);
    if (!jobs.length) continue;
    const sims = await page.evaluate(async ({ img, mime, review, jobs, vis, cands }) => {
      const im = new Image(); im.src = `data:${mime};base64,` + img; await im.decode();
      const c = document.createElement('canvas'); c.width = review.width; c.height = review.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
      x.fillStyle = '#787c82'; review.masks.forEach((m) => x.fillRect(m.x, m.y, m.w, m.h));
      const root = document.getElementById('r');
      const out = {};
      for (const j of jobs) {
        const [x0, y0, x1, y1] = j.box.map(Math.round), w = Math.max(40, x1 - x0), h = Math.max(40, y1 - y0);
        out[j.vid] = {};
        for (const t of cands) {
          root.style.width = w + 'px';
          // a typical instance of each type, so the comparison asks "what kind of picture is this panel", not
          // "do these invented numbers match" (the replica's values are generated either way)
          const dim = (n) => ({ name: 'Category', members: Array.from({ length: n }, (_, i) => 'Item ' + (i + 1)) });
          const shape = (n) => Array.from({ length: n }, (_, i) => 30 + ((i * 37) % 71));
          const measure = (vis[j.vid] && vis[j.vid].measure) || { name: 'Value', format: 'number' };
          const base = { id: 'v1', span: 12, title: '', type: t, measure };
          const v = t === 'pie' || t === 'donut' || t === 'treemap' || t === 'funnel'
            ? Object.assign(base, { dimension: dim(5), series: [{ name: 'A', shape: shape(5) }] })
            : t === 'scatter' ? Object.assign(base, { xMeasure: measure, yMeasure: measure, points: shape(10).map((s, i) => [s, (s * 7 + i * 11) % 100]) })
              : t === 'heatmap' ? Object.assign(base, { rows: dim(4), columns: dim(6), matrix: Array.from({ length: 4 }, (_, r) => shape(6).map((s) => (s + r * 13) % 100)) })
                : t === 'gauge' ? Object.assign(base, { shapeValue: 65 })
                  : t === 'map' ? Object.assign(base, { basemap: 'world', mapKind: 'filled', dimension: { name: 'Country', members: ['United States', 'Brazil', 'Germany', 'India', 'Japan'] }, series: [{ name: 'A', shape: shape(5) }] })
                    : t === 'waterfall' ? Object.assign(base, { dimension: dim(5), series: [{ name: 'A', shape: [100, -40, 25, -15, 0] }] })
                      : Object.assign(base, { dimension: dim(8), series: [{ name: 'A', shape: shape(8) }], ...(t === 'bar' ? { horizontal: true } : {}) });
          try {
            window.DSCReplica.render(root, { title: '', rows: [{ height: 'm', visuals: [v] }] }, { mode: 'shape', seed: 7, realistic: true, quiet: true });
            // charts grow in: compare the finished picture, not the first frame of the animation
            await Promise.all((root._charts || []).map((ch) => new Promise((res) => { ch.on('finished', res); setTimeout(res, 1200); })));
            const card = root.querySelector('[data-vid]');
            const got = card ? await window.VSSelfCheck.compare(root, c, { [card.dataset.vid]: j.box }, review.words) : {};
            const s = card ? got[card.dataset.vid] : undefined;
            const sv=card&&card.querySelector(".rp-chart svg"); const rr=sv?sv.getBoundingClientRect():null;
            if(!out._dbg)out._dbg=[]; if(out._dbg.length<6)out._dbg.push(t+" card="+!!card+" svg="+!!sv+" rect="+(rr?Math.round(rr.width)+"x"+Math.round(rr.height):"-")+" kids="+(sv?sv.childElementCount:0)+" sim="+s);
            if (s != null) out[j.vid][t] = s;
          } catch (e) { /* a type this visual's fields cannot draw */ }
        }
      }
      return out;
    }, { img, mime: /\.jpe?g$/i.test(it.file) ? 'image/jpeg' : 'image/png', review, jobs, vis, cands: CANDIDATES });
    if (sims._dbg) console.log(sims._dbg.join('\n'));
    for (const j of jobs) {
      const s = sims[j.vid] || {};
      const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
      if (!ranked.length) continue;
      rows.push({ id: d.id, vid: j.vid, truth: j.truth, got: j.got, best: ranked[0][0], bestSim: ranked[0][1],
        gotSim: s[j.got] ?? null, truthSim: s[j.truth] ?? null, ranked: ranked.slice(0, 4).map(([t, v]) => `${t}:${v}`) });
    }
  }
} finally { await builder.close(); await browser.close(); }

const n = rows.length;
const ruleRight = rows.filter((x) => same(x.got, x.truth, true)).length;
const drawRight = rows.filter((x) => same(x.best, x.truth, true)).length;
const wrong = rows.filter((x) => !same(x.got, x.truth, true));
const recovered = wrong.filter((x) => same(x.best, x.truth, true)).length;
const right = rows.filter((x) => same(x.got, x.truth, true));
const broken = right.filter((x) => !same(x.best, x.truth, true)).length;
const beats = wrong.filter((x) => x.truthSim != null && x.gotSim != null && x.truthSim > x.gotSim).length;
console.log(`visuals compared: ${n}`);
console.log(`  rule picks the right type:    ${ruleRight} (${Math.round(ruleRight / n * 100)}%)`);
console.log(`  closest drawing is the right type: ${drawRight} (${Math.round(drawRight / n * 100)}%)`);
console.log(`  of ${wrong.length} the rule gets wrong, drawing recovers ${recovered}`);
console.log(`  of ${right.length} the rule gets right, drawing would break ${broken}`);
console.log(`  where the rule is wrong, the true type draws closer than the rule's: ${beats}/${wrong.length}`);
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify({ n, ruleRight, drawRight, recovered, broken, beats, rows }, null, 1) + '\n');
else console.log(rows.slice(0, 20).map((x) => `  ${x.id.slice(0, 18)} ${x.truth}->${x.got} best=${x.best} [${x.ranked.join(' ')}]`).join('\n'));
