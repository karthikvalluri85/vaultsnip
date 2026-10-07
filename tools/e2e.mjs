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

  check(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
} catch (e) {
  failures++; console.log('  ✗ ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll end-to-end checks passed.');
process.exit(failures ? 1 : 0);
