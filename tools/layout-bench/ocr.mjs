// Runs VaultSnip's own review step on every benchmark image and saves what the on-device builder receives
// (developer tool): run/<id>.ocr.json = { width, height, words: [{ text, x, y, w, h, kept }], masks: [{ x, y, w, h }],
// gate, ms }. The app is served from web/ and driven in headless Chromium exactly as a user would: the image is
// dropped in, read, masked by the current policy and checked; the words and masks come from the app's layoutInput(), so
// masked words carry no text. Run fetch.mjs first.
//   node tools/layout-bench/ocr.mjs [bench dir, default .bench] [--only id,id]
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { DEFAULT_BENCH, ROOT, items } from './items.mjs';

const web = join(ROOT, 'web');
const args = process.argv.slice(2);
const bench = (args[0] && !args[0].startsWith('--')) ? args[0] : DEFAULT_BENCH;
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const todo = items(bench).filter((it) => !only || only.has(it.id));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const file = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  try { const body = await readFile(join(web, file)); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
await mkdir(join(bench, 'run'), { recursive: true });
try {
  for (const it of todo) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });   // a fresh app for every image
    await page.goto(base);
    const t0 = Date.now();
    await page.setInputFiles('#file', it.file);
    await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 300000, polling: 1000 });   // by time: animation frames can stop in a headless page
    const out = await page.evaluate(() => {
      const S = window.__DSC, input = S.test.layoutInput();
      // the check's findings by kind only: their text is what the masks should have covered
      return { width: input.image.width, height: input.image.height, words: input.words, masks: input.masks, gate: S.gate,
        findings: S.flags.map((f) => ({ type: f.type, severity: f.severity })) };
    });
    out.ms = Date.now() - t0;
    await page.close();
    await writeFile(it.ocr, JSON.stringify(out));
    console.log(`  ✓ ${it.id}: ${out.words.length} words (${out.words.filter((w) => w.kept).length} readable), ${out.masks.length} masks, check ${out.gate} (${out.findings.length} to resolve), ${(out.ms / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  server.close();
}
