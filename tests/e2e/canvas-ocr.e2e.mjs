// End-to-end test for canvas redaction (Feature 3) in the real extension, in Chromium.
// Run: npm run test:canvas-e2e   (tests the committed extension/ and web/; after changing src/, run npm run build:ext)
//
// A mock dashboard has three chart canvases: plain 2D, 2D tainted by a cross-origin image (pixels cannot
// be read), and WebGL (reads back blank). The test triggers the redactor through the service worker, then
// reads a real screenshot of the page with Tesseract: every PII string must be readable before and
// unreadable after, while allowlisted labels stay readable. It also checks redraws, scrolling, removal,
// and that no request leaves the machine.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import Tesseract from 'tesseract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The extension as build.sh packages it (--bundle-models), in a temp folder. The test copy alone gets
// <all_urls>: the test calls the service worker directly instead of using the menu, which is what grants activeTab.
const ext = await mkdtemp(join(tmpdir(), 'vs-ext-pkg-'));
await cp(join(root, 'extension'), ext, { recursive: true });
await cp(join(root, 'web/icons'), join(ext, 'icons'), { recursive: true });
await cp(join(root, 'web'), join(ext, 'app'), { recursive: true });
const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest));

const PII = { plain: ['Kestrelmoor', 'jane.doe@kestrelmoor.com', '1,204,330'], tainted: ['Globex'], webgl: ['Initech'], redraw: ['Umbrella'] };
const LABELS = ['Revenue', 'Region'];

const page = (otherOrigin) => `<!doctype html><meta charset="utf-8"><title>Mock dashboard</title>
<style>body{margin:0;font-family:sans-serif;background:#f4f5f7}canvas{display:block;margin:24px;background:#fff}#spacer{height:900px}</style>
<canvas id="plain" width="640" height="220"></canvas>
<canvas id="tainted" width="640" height="120"></canvas>
<canvas id="webgl" width="640" height="120"></canvas>
<div id="spacer"></div>
<script>
const text = (ctx, lines) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.fillStyle = '#111';
  lines.forEach((l, i) => { ctx.font = (i ? '' : 'bold ') + '22px Arial'; ctx.fillText(l, 20, 40 + i * 44); }); };
const plain = document.getElementById('plain').getContext('2d');
text(plain, ['Revenue by Region', 'Kestrelmoor Holdings', 'jane.doe@kestrelmoor.com', '$1,204,330']);
window.redraw = () => text(plain, ['Revenue by Region', 'Umbrella Holdings', 'jane.doe@kestrelmoor.com', '$1,204,330']);

const tc = document.getElementById('tainted').getContext('2d');
const img = new Image();
img.onload = () => { text(tc, ['Region', 'Globex Corporation']); tc.drawImage(img, 600, 10, 24, 24); window.taintedReady = true; };
img.src = '${otherOrigin}icon.png'; // no CORS: drawing it taints the canvas

const glc = document.getElementById('webgl'), gl = glc.getContext('webgl'); // preserveDrawingBuffer: false
const src = document.createElement('canvas'); src.width = 640; src.height = 120; text(src.getContext('2d'), ['Region', 'Initech Systems']);
const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
const p = gl.createProgram();
gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x+1.,1.-a.y)/2.;gl_Position=vec4(a,0,1);}'));
gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}'));
gl.linkProgram(p); gl.useProgram(p);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
</script>`;

const serve = (handler) => new Promise((r) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const icon = await readFile(join(root, 'web/icons/icon32.png'));
const other = await serve((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(icon); });
const otherOrigin = `http://127.0.0.1:${other.address().port}/`;
const main = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(otherOrigin)); });
const base = `http://127.0.0.1:${main.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };

const ocr = await Tesseract.createWorker('eng', 1, { langPath: join(root, 'web/lang'), gzip: true, cachePath: await mkdtemp(join(tmpdir(), 'vs-tess-')) });
await ocr.setParameters({ tessedit_pageseg_mode: '11' });
const readable = async (png) => (await ocr.recognize(png)).data.text.replace(/\s+/g, ' ');
const has = (text, s) => text.toLowerCase().includes(s.toLowerCase());

const profile = await mkdtemp(join(tmpdir(), 'vs-ext-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1000, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const offOrigin = [];
const requests = [];
const local = (u) => u.startsWith('http://127.0.0.1:') || /^(chrome-extension|data|blob):/.test(u);
await context.route('**/*', (route) => { const u = route.request().url(); if (local(u)) return route.continue(); offOrigin.push(u); return route.abort(); });
context.on('request', (r) => requests.push(r.url()));

try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const tab = await context.newPage();
  const pageErrors = [];
  tab.on('pageerror', (e) => pageErrors.push(e.message));
  await tab.goto(base);
  await tab.waitForFunction(() => window.taintedReady);
  const trigger = () => sw.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url: url + '*' });
    await chrome.tabs.update(t.id, { active: true });
    await globalThis.vaultsnip.redactCanvases(t.id);
  }, base);

  console.log('Before redaction (sanity: the test can read the PII)');
  // VS_SHOTS=<folder> keeps the before/after screenshots, to look at or to use as visual baselines.
  const shot = (name) => tab.screenshot(process.env.VS_SHOTS ? { path: join(process.env.VS_SHOTS, `canvas-${name}.png`) } : {});
  const before = await readable(await shot('before'));
  for (const s of Object.values(PII).flat().filter((s) => s !== 'Umbrella')) check(has(before, s), `"${s}" is readable`);

  console.log('Redaction');
  const t0 = Date.now();
  await trigger();
  await tab.waitForSelector('vaultsnip-redactions[data-state]', { state: 'attached', timeout: 120_000 });
  const state = await tab.$eval('vaultsnip-redactions', (h) => ({ ...h.dataset }));
  check(state.state === 'done', `redactor finished (${state.state}${state.error ? ': ' + state.error : ''}, ${state.masks} masks, ${state.verifyAdded} added by the re-check, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const after = await readable(await shot('after'));
  for (const [kind, list] of Object.entries(PII)) for (const s of list) if (kind !== 'redraw') check(!has(after, s), `${kind} canvas: "${s}" is no longer readable`);
  for (const s of LABELS) check(has(after, s), `allowlisted label "${s}" stays readable`);

  console.log('Redraw and scroll');
  await tab.evaluate(() => window.redraw());
  await tab.waitForTimeout(8000); // watcher interval + OCR
  const redrawn = await readable(await tab.screenshot());
  check(!has(redrawn, 'Umbrella'), 'text drawn after redaction ("Umbrella") is blurred too');
  check(!has(redrawn, 'Kestrelmoor'), 'redrawn chart: earlier PII stays hidden');
  await tab.mouse.wheel(0, 120);
  await tab.waitForTimeout(400);
  const scrolled = await readable(await tab.screenshot());
  check(!Object.values(PII).flat().some((s) => has(scrolled, s)), 'after scrolling, overlays still cover the PII');

  console.log('Removal');
  await trigger();
  await tab.waitForTimeout(500);
  check(await tab.$('vaultsnip-redactions') === null, 'running it again removes the overlays');
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

  console.log('Toolbar snip (existing behaviour, same service worker)');
  const appPage = await context.newPage();
  await appPage.goto(new URL('app/privacy.html', sw.url()).href);
  const reply = await appPage.evaluate(() => chrome.runtime.sendMessage({ type: 'dsc-get-snip' }));
  check(reply && 'dataUrl' in reply, 'the app can still ask the service worker for a toolbar snip');
  await appPage.close();

  console.log('Zero network');
  check(offOrigin.length === 0, `nothing requested outside this machine${offOrigin.length ? ': ' + offOrigin.join(', ') : ''}`);
  check(!requests.some((u) => Object.values(PII).flat().some((s) => decodeURIComponent(u).includes(s))), `no request URL carries the PII (${requests.length} requests)`);
} finally {
  await context.close();
  await ocr.terminate();
  main.close(); other.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(ext, { recursive: true, force: true }).catch(() => {});
}
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll canvas redaction checks passed.');
