// Browser test for the contextual fallback (Feature 2): runs the built ML worker in headless Chromium.
// Needs: npm run fetch:model && npm run build:ml   Run: npm run test:ml-e2e
// Set PW_CHROMIUM to a Chromium binary to use a preinstalled browser.
//
// Checks that (1) every request the page and worker make stays on the local origin and none carries the
// PII being scanned, (2) the model answers correctly inside a real Worker under the extension's CSP, and
// (3) the main thread is never blocked for 50 ms or more while the model loads and runs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
// Same policy as extension_pages in extension/manifest.json.
const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
const PII = ['May Chen', 'Max Weber', 'Target Corporation', 'Kestrelmoor'];
// Same lines as tests/unit/ner-model.test.ts, so the browser (WASM) and Node (native) runtimes are held to the same results.
const LINES = ['Owner: May Chen', 'Max Weber approved the budget', 'Customer Target Corporation', 'Kestrelmoor renewal at risk'];

const PAGE = `<!doctype html><meta charset="utf-8"><title>ML worker test</title><script type="module" src="/__test.js"></script>`;
const SCRIPT = `
const lines = ${JSON.stringify(LINES.map((l) => l.split(' ')))};
// Main-thread watchdog: the longest gap between timer ticks while the worker loads and runs.
let last = performance.now(), maxGap = 0;
const tick = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 5);
const longTasks = [];
new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration))).observe({ type: 'longtask' });
const worker = new Worker('/ml/ml-worker.js', { type: 'module' });
const ask = (msg) => new Promise((res, rej) => {
  worker.onmessage = (e) => (e.data.ok ? res(e.data) : rej(new Error(e.data.error)));
  worker.onerror = (e) => rej(new Error(e.message || 'worker error'));
  worker.postMessage(msg);
});
const t0 = performance.now();
try {
  await ask({ id: 1, type: 'warmup' });
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const r = await ask({ id: 2, type: 'score', lines });
  window.__result = { ok: true, scores: r.scores, loadMs, scoreMs: performance.now() - t1, maxGap, longTasks };
} catch (e) {
  window.__result = { ok: false, error: String(e && e.message || e) };
}
clearInterval(tick);
`;

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '').replace(/\\/g, '/');
  const headers = { 'content-security-policy': CSP };
  if (path === '' || path === 'index.html') { res.writeHead(200, { ...headers, 'content-type': 'text/html' }); return res.end(PAGE); }
  if (path === '__test.js') { res.writeHead(200, { ...headers, 'content-type': 'text/javascript' }); return res.end(SCRIPT); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { ...headers, 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const context = await browser.newContext();
const requests = [];
const offOrigin = [];
// Anything not on the local origin is recorded and aborted, so a leak fails the test without leaving the machine.
await context.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(base) || u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
  offOrigin.push(u);
  return route.abort();
});
context.on('request', (r) => requests.push({ url: r.url(), body: r.postData() || '' }));
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(e.message));

try {
  await page.goto(base);
  await page.waitForFunction(() => window.__result, null, { timeout: 120_000 });
  const r = await page.evaluate(() => window.__result);
  console.log('ML worker in Chromium (extension CSP)');
  check(r.ok, `model loads and answers in a Web Worker${r.ok ? ` (load ${r.loadMs.toFixed(0)} ms, ${PII.length} lines scored in ${r.scoreMs.toFixed(0)} ms)` : `: ${r.error}`}`);
  if (r.ok) {
    const ent = (line, word) => r.scores[line][word][0] + r.scores[line][word][1];
    check(ent(0, 1) > 0.8 && ent(1, 0) > 0.8 && ent(2, 1) > 0.8,
      `"May", "Max" and "Target" read as names, as in Node (${[ent(0, 1), ent(1, 0), ent(2, 1)].map((v) => v.toFixed(2)).join(', ')})`);
    check(r.maxGap < 50, `main thread never blocked for 50 ms or more (longest gap ${r.maxGap.toFixed(0)} ms)`);
    check(r.longTasks.length === 0, `no long tasks on the main thread (${r.longTasks.length})`);
  }
  console.log('Zero network');
  const [worker] = page.workers();
  const guard = await worker.evaluate(async () => {
    try { await fetch('https://huggingface.co/api/models?search=May%20Chen'); return 'sent'; } catch (e) { return e.name; }
  });
  check(guard === 'BlockedRequestError', `the worker's network guard refuses huggingface.co before any request is made (${guard})`);
  check(offOrigin.length === 0, `no request left the local origin${offOrigin.length ? ': ' + offOrigin.join(', ') : ''}`);
  const leaked = requests.filter((q) => PII.some((p) => decodeURIComponent(q.url).includes(p) || q.body.includes(p)));
  check(leaked.length === 0, `no request carries the scanned text (${requests.length} requests checked)`);
  check(requests.some((q) => q.url.endsWith('.onnx')) && requests.some((q) => q.url.endsWith('.wasm')), 'model and runtime came from the local server');
  check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll ML worker checks passed.');
