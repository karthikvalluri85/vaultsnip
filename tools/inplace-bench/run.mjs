// Measures the in-place replica on generated dashboards (developer tool, no network).
//   node tools/inplace-bench/run.mjs [--dir .bench/inplace] [--json out.json] [--shots dir]
// Each image (from tools/synth-bench/gen.mjs, with every word's position and kind known) goes through the real app in a
// fresh page: OCR, masks, the check, "Hide everything uncertain", then the replica built on this device. Per image:
//   distortion   pixels changed outside the replaced boxes (must be 0)
//   ghost        replaced boxes where text pixels are left after clearing (before the new text is drawn)
//   squeezed     replacements that had to shrink below 70% of the original size to fit their box
//   unchanged    replacements identical to the hidden text
//   kept         boxes left as they were: chart shapes the reader took for text
//   exposed      sensitive words (by the generator's truth) not under any replaced box, so still readable
// --shots saves each replica PNG, for looking at the worst cases.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'inplace')), JSON_OUT = arg('--json'), SHOTS = arg('--shots');
const web = join(ROOT, 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const file = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  try { const body = await readFile(join(web, file)); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const files = (await readdir(DIR)).filter(f => /\.(png|jpg)$/.test(f)).sort();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const results = [];
for (const f of files) {
  const truth = JSON.parse(await readFile(join(DIR, f.replace(/\.(png|jpg)$/, '.truth.json')), 'utf8'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const t0 = Date.now();
  try {
    await page.goto(base);
    await page.setInputFiles('#file', join(DIR, f));
    await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 240000, polling: 1000 });
    await page.evaluate(() => window.__DSC.test.hideUncertain());
    await page.evaluate(() => window.__DSC.test.buildInPlace(false));
    const r = await page.evaluate(([truth, shot]) => {
      const S = window.__DSC, full = S.img.full || S.img, W = full.width, H = full.height, P = S.fid.patches;
      if (S.fid.canvas.width !== W || S.fid.canvas.height !== H) throw new Error('the replica is not the size of the picture');
      const src = full.getContext('2d').getImageData(0, 0, W, H).data, out = S.fid.canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const inBox = new Uint8Array(W * H);
      P.forEach(p => { for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(H, Math.ceil(p.y + p.h)); y++) for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(W, Math.ceil(p.x + p.w)); x++) inBox[y * W + x] = 1; });
      let distortion = 0;
      for (let i = 0; i < W * H; i++) if (!inBox[i] && (src[i * 4] !== out[i * 4] || src[i * 4 + 1] !== out[i * 4 + 1] || src[i * 4 + 2] !== out[i * 4 + 2])) distortion++;
      // the boxes cleared but not yet written: leftover text pixels are those far from both the colour above and below
      const blank = VSInpaint.patch(full, P.map(p => Object.assign({}, p, { synthetic: '' }))).canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const d = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
      const ghosts = [];
      P.filter(p => !p.keep).forEach(p => {
        const x0 = Math.max(0, Math.floor(p.x)), y0 = Math.max(0, Math.floor(p.y)), x1 = Math.min(W, Math.ceil(p.x + p.w)), y1 = Math.min(H, Math.ceil(p.y + p.h));
        let left = 0, n = 0;
        for (let x = x0; x < x1; x++) {
          const t = (Math.max(0, y0 - 1) * W + x) * 4, b = (Math.min(H - 1, y1) * W + x) * 4;
          for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; n++; if (d(blank, i, src, t) > 60 && d(blank, i, src, b) > 60) left++; }
        }
        if (n && left / n > 0.04) ghosts.push({ text: p.original, kind: p.kind, pct: Math.round(1000 * left / n) / 10, box: [p.x, p.y, p.w, p.h].map(Math.round) });
      });
      // how much each replacement had to shrink to fit its box
      const ctx = document.createElement('canvas').getContext('2d'), squeezed = [];
      P.forEach(p => {
        if (!p.synthetic) return;
        ctx.font = `${p.style.weight} ${p.style.size}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
        // the drawn size relative to the original's: text is narrowed to 75% before it is made smaller
        const room = p.style.slant ? p.style.slant.length * 1.05 : Math.max(4, p.w - 2), r = room / ctx.measureText(p.synthetic).width;
        const k = r >= 0.75 ? 1 : r / 0.75;
        if (k < 0.7) squeezed.push({ original: p.original, synthetic: p.synthetic, kind: p.kind, fit: Math.round(k * 100) / 100 });
      });
      const unchanged = P.filter(p => p.synthetic && p.original && p.synthetic === p.original).map(p => p.original);
      const covered = w => P.some(p => !p.keep && w.x + w.w / 2 > p.x && w.x + w.w / 2 < p.x + p.w && w.y + w.h / 2 > p.y && w.y + w.h / 2 < p.y + p.h);
      const k = W / truth.width, sens = truth.words.filter(w => w.sensitive).map(w => ({ text: w.text, kind: w.kind, x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k })), exposed = sens.filter(w => !covered(w)).map(w => ({ text: w.text, kind: w.kind }));
      const kept = P.filter(p => p.keep).map(p => p.original);
      return { kept, scale: Math.round(100 * S.img.width / W) / 100, fullSize: W === truth.width, patches: P.length, distortion, ghosts, squeezed, unchanged, sensitive: sens.length, exposed, png: shot ? S.fid.canvas.toDataURL('image/png') : null };
    }, [truth, !!SHOTS]);
    if (SHOTS && r.png) await writeFile(join(SHOTS, f.replace(/\.(png|jpg)$/, '-replica.png')), Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
    results.push(Object.assign({ file: f, ms: Date.now() - t0, errors }, r));
    console.log(`  ${r.distortion || errors.length ? '✗' : '✓'} ${f}: ${r.patches} boxes, distortion ${r.distortion}, ghosts ${r.ghosts.length}, squeezed ${r.squeezed.length}, unchanged ${r.unchanged.length}, exposed ${r.exposed.length}/${r.sensitive}${errors.length ? ', errors: ' + errors.join(' | ') : ''}`);
  } catch (e) {
    results.push({ file: f, failed: String(e.message || e).split('\n')[0], errors });
    console.log(`  ✗ ${f}: ${String(e.message || e).split('\n')[0]}`);
  } finally { await page.close(); }
}
await browser.close(); server.close();

const ok = results.filter(r => !r.failed), sum = k => ok.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k] || 0), 0);
const summary = {
  images: results.length, failed: results.length - ok.length, withErrors: results.filter(r => r.errors.length).length,
  boxes: sum('patches'), distortedImages: ok.filter(r => r.distortion).length,
  keptShapes: sum('kept'), ghostBoxes: sum('ghosts'), squeezed: sum('squeezed'), unchanged: sum('unchanged'),
  sensitive: sum('sensitive'), exposed: sum('exposed'), exposedPct: Math.round(1000 * sum('exposed') / Math.max(1, sum('sensitive'))) / 10
};
console.log('\n' + JSON.stringify(summary, null, 1));
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify({ summary, results }, null, 1));
