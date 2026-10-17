// End-to-end test for masked session replay (Feature 4) in the packaged extension, in Chromium.
// Run: npm run test:replay-e2e   (tests the committed extension/ and web/; after changing src/, rebuild them)
//
// Records a mock dashboard full of PII (text, links, attributes, inputs, a mutation, CSS), with clicks, hovers,
// typing and scrolling. Then checks the replay page: the audit passes, no PII string is anywhere in the recording,
// the interactions are there, a screenshot of the replayed page read by OCR shows no PII, the downloaded
// standalone player works offline, and nothing touched the network.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import Tesseract from 'tesseract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PII = ['Kestrelmoor', 'jane.doe@kestrelmoor.com', '1,204,330', 'Jane Doe', 'INV-20931', 'hunter2', 'Umbrella', 'evil.example', 'customers/88231'];

const PAGE = `<!doctype html><meta charset="utf-8"><title>Kestrelmoor CRM</title>
<style>body{font:18px Arial,sans-serif;margin:24px;background:#fff}.card{border:1px solid #ccc;padding:16px;margin:12px 0;width:600px}
.hero{height:40px;background:url(https://evil.example/avatar.png)} .who::after{content:" Jane Doe"} #spacer{height:1200px}</style>
<h1 title="Kestrelmoor Holdings">Revenue by Region</h1>
<div class="card" data-user="Jane Doe"><p class="who">Account owner</p>
<p id="acct">Kestrelmoor Holdings owes $1,204,330 (INV-20931)</p>
<p><a href="mailto:jane.doe@kestrelmoor.com">jane.doe@kestrelmoor.com</a> · <a href="https://crm.example/customers/88231">Open</a></p>
<img src="https://evil.example/avatar.png" alt="Jane Doe" width="40" height="40">
<input id="pw" type="password" placeholder="Jane Doe"> <button id="go" title="Jane Doe">Sign</button></div>
<div class="hero"></div><div id="spacer"></div>
<script>document.getElementById('go').onclick = () => { document.getElementById('acct').textContent = 'Umbrella Corp signed for $88,400';
  const d = document.createElement('div'); d.className = 'card'; d.title = 'Umbrella'; d.textContent = 'Jane Doe approved'; document.body.insertBefore(d, document.getElementById('spacer')); };</script>`;

const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const has = (text, s) => text.toLowerCase().includes(s.toLowerCase());

// The extension as build.sh packages it; the test copy alone gets <all_urls> (no menu click to grant activeTab).
const ext = await mkdtemp(join(tmpdir(), 'vs-ext-pkg-'));
await cp(join(root, 'extension'), ext, { recursive: true });
await cp(join(root, 'web/icons'), join(ext, 'icons'), { recursive: true });
await cp(join(root, 'web'), join(ext, 'app'), { recursive: true });
const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest));

const ocr = await Tesseract.createWorker('eng', 1, { langPath: join(root, 'web/lang'), gzip: true, cachePath: await mkdtemp(join(tmpdir(), 'vs-tess-')) });
await ocr.setParameters({ tessedit_pageseg_mode: '11' });
const read = async (png) => (await ocr.recognize(png)).data.text.replace(/\s+/g, ' ');

const profile = await mkdtemp(join(tmpdir(), 'vs-ext-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1000, height: 800 }, acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
// Off-machine requests are aborted. The recorded site's own loads (its avatar, before and during recording) are
// the site's business; what must make none are VaultSnip's pages: the replay, the downloaded player, the extension.
const offOrigin = [];
let site = null;
const local = (u) => u.startsWith(base) || /^(chrome-extension|data|blob|file):/.test(u);
await context.route('**/*', (route) => {
  const req = route.request(), u = req.url();
  if (local(u)) return route.continue();
  let page = null; try { page = req.frame().page(); } catch { /* service worker or offscreen */ }
  if (!site || page !== site) offOrigin.push(u);
  return route.abort();
});

try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const tab = site = await context.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.goto(base);
  const toggle = () => sw.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url: url + '*' });
    await chrome.tabs.update(t.id, { active: true });
    await globalThis.vaultsnip.recordTab(t.id);
  }, base);

  console.log('Recording');
  await toggle();
  await tab.waitForSelector('vaultsnip-recorder', { state: 'attached' });
  check(true, 'recording badge is shown while recording');
  await tab.hover('h1'); await tab.waitForTimeout(200);
  await tab.hover('#go'); await tab.waitForTimeout(200);
  await tab.click('#pw'); await tab.keyboard.type('hunter2', { delay: 40 });
  await tab.click('#go'); await tab.waitForTimeout(300);
  await tab.mouse.wheel(0, 300); await tab.waitForTimeout(400);
  await tab.mouse.wheel(0, -300); await tab.waitForTimeout(400);
  const replayP = context.waitForEvent('page', { predicate: (p) => p.url().includes('replay.html') });
  await toggle();
  const replay = await replayP;
  replay.on('pageerror', (e) => errors.push(e.message));
  await replay.waitForFunction(() => window.__VSREPLAY && (window.__VSREPLAY.player || window.__VSREPLAY.findings.length), null, { timeout: 30000 });
  const r = await replay.evaluate(() => ({ findings: window.__VSREPLAY.findings, json: JSON.stringify(window.__VSREPLAY.events) }));

  console.log('Recording contents');
  check(r.findings.length === 0, `privacy audit passed on the replay page (${r.findings.length} findings)`);
  for (const s of PII) check(!r.json.includes(s), `"${s}" is nowhere in the recording`);
  check(!/https?:\/\/(?!www\.w3\.org)/.test(r.json), 'no URL in the recording');
  check(r.json.includes('Revenue by Region'), 'allowlisted labels are kept');
  const events = JSON.parse(r.json);
  const src = (n) => events.filter((e) => e.type === 3 && e.data.source === n).length;
  check(src(2) > 0 && src(1) > 0 && src(3) > 0 && src(5) > 0 && src(0) > 0, `clicks ${src(2)}, mouse moves ${src(1)}, scrolls ${src(3)}, inputs ${src(5)}, DOM changes ${src(0)} recorded`);
  check(!r.json.includes('Recording, text masked'), 'the recording badge itself is not in the recording');

  console.log('Playback');
  await replay.evaluate(() => new Promise((done) => { const p = window.__VSREPLAY.player; p.onFinish(done); p.setSpeed(4); p.play(); }));
  await replay.waitForTimeout(300);
  const stage = await replay.locator('#stage').screenshot();
  if (process.env.VS_SHOTS) await writeFile(join(process.env.VS_SHOTS, 'replay-end.png'), stage);
  const seen = await read(stage);
  check(has(seen, 'Revenue'), 'replayed page renders (label "Revenue" readable by OCR)');
  for (const s of ['Kestrelmoor', 'Umbrella', 'Jane', '1,204,330', '88,400']) check(!has(seen, s), `"${s}" is not readable in the replay`);

  console.log('Standalone player');
  const dlP = replay.waitForEvent('download');
  await replay.click('#dl-html');
  const file = join(profile, 'replay.html');
  await (await dlP).saveAs(file);
  const html = await readFile(file, 'utf8');
  for (const s of PII) check(!html.includes(s), `downloaded player does not contain "${s}"`);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(file).href);
  await offline.waitForSelector('#stage iframe', { state: 'attached', timeout: 15000 });
  check(true, 'downloaded player opens from disk and builds the replay');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

  console.log('Zero network (VaultSnip pages)');
  check(offOrigin.length === 0, `nothing requested outside this machine${offOrigin.length ? ': ' + [...new Set(offOrigin)].join(', ') : ''}`);
} finally {
  await context.close();
  await ocr.terminate();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(ext, { recursive: true, force: true }).catch(() => {});
}
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll session replay checks passed.');
