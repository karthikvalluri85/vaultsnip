// Collects candidate dashboard screenshots for the real benchmark (developer tool).
//
// Reads a list of documentation pages, pulls out the screenshots they show, and writes a candidates file in the shape
// fetch.mjs expects: { id, tool, source, terms }. Nothing is downloaded here and nothing is redistributed: the list
// records where each picture lives and under what terms, and fetch.mjs pulls them into the developer's own .bench.
//
//   node tools/layout-bench/collect.mjs [--out .bench/new2/candidates.json] [--max 80]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from './items.mjs';
import { truth } from './items.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const out = arg('--out', join(ROOT, '.bench', 'new2', 'candidates.json'));
const MAX = +arg('--max', 80);

// Power BI's own sample reports, documented on Microsoft Learn. Each page shows the report's pages as screenshots.
// The data in every one is fictitious (obviEnce ©), which is why they suit a masking tool's benchmark.
const PBI = ['sample-retail-analysis', 'sample-it-spend', 'sample-opportunity-analysis', 'sample-procurement',
  'sample-sales-and-marketing', 'sample-supplier-quality', 'sample-human-resources', 'sample-customer-profitability',
  'sample-corporate-spend', 'sample-competitive-marketing-analysis', 'sample-regional-sales', 'sample-store-sales',
  'sample-revenue-opportunities', 'sample-employee-hiring-history', 'sample-artificial-intelligence',
  'sample-sales-returns', 'sample-covid-19-us', 'sample-datasets'];
const BASE = 'https://learn.microsoft.com/en-us/power-bi/create-reports/';
const TERMS = 'Microsoft Learn documentation, CC BY 4.0; sample data obviEnce ©';

const seen = new Set(Object.values(truth).flat().map((d) => d && d.source).filter(Boolean));
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 48);
const found = [];

for (const page of PBI) {
  const url = BASE + page;
  let html = '';
  try { const r = await fetch(url); if (!r.ok) { console.error(`  ${page}: HTTP ${r.status}`); continue; } html = await r.text(); }
  catch (e) { console.error(`  ${page}: ${e.message}`); continue; }
  // the screenshots a page shows, as absolute URLs, in the order they appear
  // Learn wraps each screenshot in a lightbox link, so the full-size picture is the href, not the img src
  const srcs = [...html.matchAll(/(?:href|src)="([^"]*media\/[^"]+\.(?:png|jpe?g))(?:#lightbox)?"/gi)].map((m) => m[1]);
  const abs = [...new Set(srcs.map((s) => (s.startsWith('http') ? s : new URL(s, url).href)))]
    // icons, buttons and diagrams are not dashboards
    .filter((s) => !/icon|button|logo|diagram|flow|architecture|screenshot-of-the-(ribbon|menu)/i.test(s));
  let n = 0;
  for (const s of abs) {
    if (seen.has(s) || found.some((f) => f.source === s)) continue;
    found.push({ id: `${page.replace(/^sample-/, 'pbi2-')}_${slug(s.split('/').pop().replace(/\.[^.]+$/, ''))}`, tool: 'Power BI', source: s, terms: TERMS });
    if (++n >= 8) break;   // a few pages from each report, so no one report dominates the set
  }
  console.error(`  ${page}: ${n} new of ${abs.length}`);
  if (found.length >= MAX) break;
}

const list = found.slice(0, MAX);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(list, null, 1) + '\n');
console.log(`${list.length} candidates -> ${out}`);

// --fetch: pull each picture into the same folder, for labelling on this machine. Nothing is redistributed; the
// folder is a developer's scratch area and the terms travel with each entry in the candidates file.
if (process.argv.includes('--fetch')) {
  const size = (b) => {
    if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    for (let i = 2; i + 9 < b.length; i += 2 + b.readUInt16BE(i + 2)) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
    return [0, 0];
  };
  let n = 0;
  for (const [i, c] of list.entries()) {
    const ext = /\.jpe?g$/i.test(c.source) ? '.jpg' : '.png';
    const file = join(dirname(out), String(i + 1).padStart(2, '0') + '_' + c.id + ext);
    try {
      const r = await fetch(c.source);
      if (!r.ok) { console.error(`  ${c.id}: HTTP ${r.status}`); continue; }
      const b = Buffer.from(await r.arrayBuffer());
      await writeFile(file, b);
      c.size = size(b); c.file = file;
      n++;
    } catch (e) { console.error(`  ${c.id}: ${e.message}`); }
  }
  // a picture too small to be a dashboard page is a close-up of one visual, not a page to label
  const big = list.filter((c) => c.size && c.size[0] >= 900 && c.size[1] >= 500);
  await writeFile(out, JSON.stringify(big, null, 1) + '\n');
  console.log(`fetched ${n}; ${big.length} are full pages (>= 900x500) and stay in the list`);
}
