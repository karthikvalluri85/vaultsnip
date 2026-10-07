// End-to-end smoke test: serves web/ locally and drives the app in headless Chromium.
// Usage: node tools/e2e.mjs        (first time: npx playwright install chromium)
// Set PW_CHROMIUM to a Chromium binary to use a preinstalled browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = path || 'index.html';
  try { const body = await readFile(join(web, file)); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
const wait = ms => page.waitForTimeout(ms);

try {
  await page.goto(base);
  console.log('Samples and cross-filtering');
  await page.click('#btn-try');
  await page.locator('#samples .sample button').nth(1).click();          // Web analytics
  await page.waitForFunction(() => document.querySelectorAll('#replica .rp-chart').length >= 8);
  await wait(2500);                                                         // map outlines load
  check(await page.locator('#replica .rp-ph').count() === 0, 'every visual renders (no placeholders)');
  const kpi = () => page.locator('#replica .rp-kpi .v').first().textContent();
  const before = await kpi();
  await page.locator('#replica .rp-chip', { hasText: 'Paid search' }).click(); await wait(300);
  check((await kpi()) !== before, `filter chip changes KPIs (${before} → ${await kpi()})`);
  await page.locator('#replica .rp-clear').click(); await wait(300);
  check((await kpi()) === before, 'Clear all filters restores KPIs');
  const clicked = await page.evaluate(() => {
    const root = document.getElementById('replica');
    const map = root._charts.find(c => c.getOption().series[0].type === 'map');
    const d = map.getOption().series[0].data.find(x => x.member === 'India');
    map._$handlers.click.forEach(h => h.h.call(map, { data: d, name: d.name }));
    return d.name;
  });
  await wait(300);
  check((await kpi()) !== before && /country/i.test(await page.locator('#replica .rp-ribbon').textContent()), `clicking ${clicked} on the map filters the page`);

  console.log('Export');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const html = await readFile(await download.path(), 'utf8');
  check(/DSCReplica\.addMap\("world"/.test(html) && /synthetic-data/.test(html), 'export embeds maps and the synthetic-data marker');
  const p2 = await browser.newPage(); const offline = [];
  p2.on('request', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('about:')) offline.push(r.url()); });
  await p2.setContent(html); await p2.waitForTimeout(1500);
  check(await p2.locator('.rp-ph').count() === 0, 'exported file renders every visual');
  check(offline.length === 0, 'exported file makes no network requests');
  await p2.close();

  console.log('Feedback');
  await page.locator('header [data-feedback]').click();
  check(await page.locator('#dlg-fb').evaluate(d => d.open), 'header Feedback opens the dialog');
  const diag = await page.locator('#fb-diag').textContent();
  check(/VaultSnip \d+\.\d+\.\d+/.test(diag) && /Step: Replica/.test(diag), 'diagnostics include version and step');
  check(!/Website Performance|Organic|Paid search/.test(diag), 'diagnostics contain no dashboard text');
  await page.fill('#fb-text', 'Test report from e2e');
  const issue = await page.evaluate(() => VSFeedback.urlFor('bug', 'Map click is slow'));
  check(issue.includes('/issues/new?template=bug_report.yml') && issue.includes('what=Map+click+is+slow'), 'bug report prefills the GitHub issue form');
  check((await page.evaluate(() => VSFeedback.urlFor('masking', 'x'))).endsWith('/security/advisories/new'), 'masking reports go to the private route');
  check((await page.evaluate(() => VSFeedback.urlFor('idea', 'x'))).includes('/discussions/new?category=ideas'), 'ideas go to Discussions');
  check((await page.evaluate(() => VSFeedback.mailFor('bug', 'x'))).startsWith('mailto:'), 'email fallback is available');
  await page.keyboard.press('Escape');
  await page.evaluate(() => VSFeedback.problem(new Error('Simulated failure with sk-ant-abc123 and a@b.example'), 'Test'));
  check(await page.locator('.fb-toast').isVisible(), 'errors show a "Report this" prompt');
  const leaked = await page.evaluate(() => VSFeedback.context().error);
  check(!/sk-ant-abc123|a@b\.example/.test(leaked), 'keys and emails are scrubbed from error text');

  console.log('Redaction demo (on-device OCR)');
  await page.goto(base);
  await page.click('#btn-try');
  await page.locator('#samples .sample button').nth(0).click();
  await page.waitForFunction(() => { const g = document.querySelector('.gate'); return g && /Blocked|Review|Pass/.test(g.textContent) && !/Checking/.test(g.textContent); }, null, { timeout: 120000 });
  const gate = (await page.locator('.gate').textContent()).replace(/\s+/g, ' ').trim();
  check(/Blocked|Review/.test(gate), `pre-flight check catches readable text (${gate.slice(0, 40)}…)`);
  check(await page.evaluate(() => (window.__DSC.masks || []).length > 20), 'sensitive text is masked');

  console.log('AI providers (mocked Claude and OpenAI endpoints)');
  const spec = await page.evaluate(() => JSON.stringify(window.DSC_SAMPLES[1].spec));
  const seen = {};
  await page.route('https://api.openai.com/v1/models', r => r.fulfill({ json: { data: [{ id: 'gpt-4o' }, { id: 'gpt-6-astra' }, { id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }, { id: 'gpt-image-2' }] } }));
  await page.route('https://api.openai.com/v1/chat/completions', r => { seen.openai = { headers: r.request().headers(), body: r.request().postDataJSON() }; return r.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: spec } }] } }); });
  await page.route('https://api.anthropic.com/v1/models?limit=100', r => r.fulfill({ json: { data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] } }));
  await page.route('https://api.anthropic.com/v1/messages', r => { seen.anthropic = { headers: r.request().headers(), body: r.request().postDataJSON() }; return r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: spec }] } }); });
  const openSend = () => page.evaluate(() => { window.__DSC.sample = null; document.getElementById('btn-send').onclick(); });

  // OpenAI, entered in the send dialog
  await openSend();
  check(await page.locator('#keybox').isVisible(), 'without a key, the send dialog asks for one');
  await page.fill('#kps-k', 'sk-proj-TESTKEY000000000000');
  check(await page.inputValue('#kps-p') === 'openai', 'an OpenAI key switches the provider to OpenAI');
  await page.click('#kps-c'); await page.waitForFunction(() => /Key works/.test(document.getElementById('kps-s').textContent));
  check(await page.inputValue('#kps-m') === 'gpt-6-astra', 'Check key lists models and picks the recommended one');
  const offered = await page.evaluate(() => [...document.querySelectorAll('#kps-ml option')].map(o => o.value));
  check(offered.includes('gpt-6-astra') && !offered.some(v => /embedding|image/.test(v)), `non-chat models are filtered out (${offered.join(', ')})`);
  await page.click('#btn-confirm');
  await page.waitForFunction(() => !document.getElementById('s-replica').hidden && document.querySelectorAll('#replica .rp-card').length > 5);
  const payload = await page.evaluate(() => window.__DSC.payload);
  const ob = seen.openai && seen.openai.body;
  check(!!ob && seen.openai.headers.authorization === 'Bearer sk-proj-TESTKEY000000000000' && !seen.openai.headers['x-api-key'], 'OpenAI receives the key as a Bearer token only');
  check(!!ob && ob.model === 'gpt-6-astra' && ob.response_format.type === 'json_object' && ob.messages[1].content.find(c => c.type === 'image_url').image_url.url === payload, 'OpenAI receives exactly the approved masked image');
  check(!!ob && ob.messages.length === 2 && ob.messages[1].content.length === 2, 'nothing else is sent to OpenAI');
  check(!(await page.evaluate(() => { try { return localStorage.getItem('dsc-key'); } catch (e) { return null; } })), 'the key is not stored unless "remember" is ticked');

  // Claude, entered in the header key dialog
  await page.click('#btn-key');
  await page.fill('#kpd-k', 'sk-ant-TESTKEY000000000000');
  check(await page.inputValue('#kpd-p') === 'anthropic', 'a Claude key switches the provider to Claude');
  await page.click('#kpd-c'); await page.waitForFunction(() => /Key works/.test(document.getElementById('kpd-s').textContent));
  check(await page.inputValue('#kpd-m') === 'claude-sonnet-5-5', 'Claude model picked from the key\'s list');
  await page.click('#key-save');
  await openSend(); await page.click('#btn-confirm');
  await page.waitForFunction(() => document.getElementById('dlg-send') && !document.getElementById('dlg-send').open);
  const ab = seen.anthropic && seen.anthropic.body;
  check(!!ab && seen.anthropic.headers['x-api-key'] === 'sk-ant-TESTKEY000000000000' && !seen.anthropic.headers.authorization, 'Claude receives the key in its own header only');
  check(!!ab && ab.messages[0].content.find(c => c.type === 'image').source.data === payload.split(',')[1], 'Claude receives exactly the approved masked image');

  // A rejected key
  await page.unroute('https://api.openai.com/v1/chat/completions');
  await page.route('https://api.openai.com/v1/chat/completions', r => r.fulfill({ status: 401, json: { error: { message: 'Incorrect API key provided' } } }));
  await page.evaluate(() => { const S = window.__DSC; S.provider = 'openai'; S.key = 'sk-proj-BAD000000000000000'; S.model = 'gpt-6-astra'; });
  await openSend(); await page.click('#btn-confirm');
  await page.waitForFunction(() => !document.getElementById('send-err').hidden);
  check(/OpenAI rejected the key/.test(await page.locator('#send-err').textContent()) && await page.locator('#keybox').isVisible(), 'a rejected key shows a clear message and asks again');
  check(!/BAD000/.test(await page.evaluate(() => VSFeedback.context().error)), 'the rejected key never appears in a feedback report');
  await page.keyboard.press('Escape');

  check(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
} catch (e) {
  failures++; console.log('  ✗ ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll end-to-end checks passed.');
process.exit(failures ? 1 : 0);
