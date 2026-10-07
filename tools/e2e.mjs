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

  console.log('Tooltips and AI-shaped specs (regressions)');
  // Issue #7: hovering a waterfall or an empty map region threw "v.toFixed is not a function".
  const hoverAll = async () => {
    const cards = page.locator('#replica .rp-chart');
    for (let i = 0; i < await cards.count(); i++) {
      const c = cards.nth(i); await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox(); if (!b) continue;
      for (const fy of [0.3, 0.5, 0.7]) for (const fx of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
    }
  };
  const errsBefore = pageErrors.length;
  await hoverAll();
  await page.goto(base); await page.click('#btn-try'); await page.locator('#samples .sample button').nth(2).click();
  await page.waitForFunction(() => document.querySelectorAll('#replica .rp-chart').length >= 9); await wait(2500);
  await hoverAll();
  check(pageErrors.length === errsBefore, 'hovering every chart in both samples raises no errors (#7)' + (pageErrors.length > errsBefore ? ': ' + pageErrors.slice(errsBefore).join(' | ') : ''));
  const shaped = await page.evaluate(() => {
    const root = document.getElementById('replica');
    DSCReplica.render(root, { title: 't', rows: [{ height: 'm', visuals: [
      { id: 'c', type: 'column', horizontal: true, stacked: true, span: 6, title: 'c', dimension: { name: 'Type', members: ['A', 'B'] }, series: [{ name: 'Done', shape: [80, 40] }, { name: 'To do', shape: [20, 10] }] },
      { id: 'p', type: 'placeholder', originalType: 'Gantt chart', span: 6, title: 'roadmap' },
      { id: 'g', type: 'timeline', span: 6, title: 'g', tasks: [{ name: 'Alpha', start: 0, end: 40 }, { name: 'Beta', start: '30', end: '70' }], timeLabels: ['Q1', 'Q2', 'Q3'] },
      { id: 'w', type: 'waterfall', span: 6, title: 'w', dimension: { name: 'Step', members: ['A', 'B', 'Total'] }, series: [{ name: 'x', shape: ['100', '−30', null] }] },
      { id: 'k', type: 'kpi', span: 6, title: 'k', measure: { name: 'k', format: 'currency', scaleHint: 'abc' } }] }] }, { resetSelection: true });
    const o = root._charts.map(c => c.getOption());
    return { colX: o[0].xAxis[0].type, placeholders: root.querySelectorAll('.rp-ph').length, gantts: o.filter(x => x.yAxis && x.yAxis[0] && x.yAxis[0].inverse && x.xAxis[0].max === 100).length, kpi: root.querySelector('.rp-kpi .v').textContent };
  });
  check(shaped.colX === 'category', 'a "column" is always vertical, even if the AI also says horizontal');
  check(shaped.placeholders === 0 && shaped.gantts === 2, 'Gantt, timeline and "placeholder: gantt" all render as a Gantt');
  check(!/NaN|undefined/.test(shaped.kpi), `odd numbers from the AI never show as NaN (${shaped.kpi})`);

  // #12-#14: values a product owner would believe
  const real = await page.evaluate(() => {
    const root = document.getElementById('replica');
    DSCReplica.render(root, { title: 't', rows: [{ height: 'm', visuals: [
      { id: 'k1', type: 'kpi', span: 3, title: 'Crash-free', measure: { name: 'Crash-free users', format: 'percent' }, shapeValue: 99 },
      { id: 'k2', type: 'kpi', span: 3, title: 'CSAT', measure: { name: 'CSAT', format: 'number', scaleHint: 4.5 } },
      { id: 'g', type: 'gauge', span: 3, title: 'NPS', min: -100, max: 100, measure: { name: 'NPS', format: 'number' }, shapeValue: 70 },
      { id: 'h', type: 'heatmap', span: 3, title: 'h', rows: { name: 'Day', members: ['Sun', 'Mon'] }, columns: { name: 'Hour', members: ['1', '2'] }, matrix: [[1, 2], [3, 4]] },
      { id: 't', type: 'table', span: 12, title: 't', rowCount: 4, columns: [{ name: 'Plan', kind: 'category', members: ['A', 'B', 'C', 'Total'] }, { name: 'Price / seat', kind: 'currency' }, { name: 'Discount', kind: 'percent' }, { name: 'Price change', kind: 'percent' }, { name: 'CSAT', kind: 'number' }] }] }] }, { resetSelection: true });
    const kv = [...root.querySelectorAll('.rp-kpi')].map(k => ({ v: k.querySelector('.v').textContent, d: (k.querySelector('.d') || {}).textContent || '' }));
    const o = root._charts.map(c => c.getOption());
    const gauge = o.find(x => x.series && x.series[0] && x.series[0].type === 'gauge').series[0];
    const heat = o.find(x => x.series && x.series[0] && x.series[0].type === 'heatmap');
    const rows = [...root.querySelectorAll('.rp-table tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    return { kv, gmin: gauge.min, gmax: gauge.max, gv: gauge.data[0].value, heatInverse: heat.yAxis[0].inverse, rows };
  });
  const pct = s => parseFloat(String(s).replace(/[^\d.\-−+]/g, '').replace('−', '-'));
  check(pct(real.kv[0].v) <= 100 && Math.abs(pct(real.kv[0].d)) <= 1.5, `a 99% KPI stays at or below 100% with a small delta (${real.kv[0].v}, ${real.kv[0].d})`);
  check(pct(real.kv[1].v) >= 3 && pct(real.kv[1].v) <= 5, `CSAT stays on a 1-5 scale (${real.kv[1].v})`);
  check(real.gmin === -100 && real.gmax === 100 && real.gv >= -100 && real.gv <= 100, `the gauge honours min/max (${real.gv.toFixed(1)} on −100..100)`);
  check(real.heatInverse === true, 'heatmap rows read top to bottom in the order given');
  check(real.rows.length === 4 && real.rows[3][0] === 'Total', 'table row labels keep their order with Total last');
  check(real.rows.every(r => pct(r[2]) >= 0 && pct(r[2]) <= 60 && pct(r[4]) >= 1 && pct(r[4]) <= 5 && pct(r[1]) > 0 && pct(r[1]) < 1000), `table columns get believable values (${real.rows.map(r => r.slice(1).join(' ')).join(' | ')})`);
  check(real.rows.some(r => /[−+-]/.test(r[3])), 'a "change" column can go negative or show a sign');
  const vb = await page.evaluate(() => {
    const root = document.getElementById('replica');
    const spec = { title: 't', rows: [{ height: 'l', visuals: [{ id: 'v', type: 'table', span: 4, title: 'Recent verbatims', rowCount: 2, columns: [
      { name: 'Customer', kind: 'person' }, { name: 'Company', kind: 'org' }, { name: 'Comment', kind: 'verbatim', values: ['Exports keep timing out. <b>x</b>', 'Good product, but […] hurts.'] }, { name: 'Score', kind: 'number', shape: [10, 100] }] }] }] };
    DSCReplica.render(root, spec, { resetSelection: true, mode: 'shape' });
    const shape = { quotes: [...root.querySelectorAll('.rp-fi p')].map(p => p.textContent), redact: root.querySelectorAll('.rp-redact').length, bold: root.querySelectorAll('.rp-fi p b').length, badges: [...root.querySelectorAll('.rp-badge')].map(b => b.className + ':' + b.textContent), foot: root.querySelector('.rp-foot span').textContent };
    DSCReplica.render(root, spec, { resetSelection: true, mode: 'generic' });
    return { shape, generic: [...root.querySelectorAll('.rp-fi p')].map(p => p.textContent), gfoot: root.querySelector('.rp-foot span').textContent };
  });
  check(vb.shape.quotes.length === 2 && /Exports keep timing out/.test(vb.shape.quotes[0]) && vb.shape.redact === 1 && vb.shape.bold === 0, `verbatims are quoted, hidden words show as a redaction bar, and quotes cannot inject markup (${vb.shape.quotes.join(' / ')})`);
  check(/bad/.test(vb.shape.badges[0]) && /good/.test(vb.shape.badges[1]), `score badges follow the source's colours (${vb.shape.badges.join(', ')})`);
  check(/customer comments are quoted/.test(vb.shape.foot) && vb.generic.every(q => /^Comment \d+$/.test(q)) && /no source values/.test(vb.gfoot), 'the footer says comments are quoted; Generic mode replaces them');

  console.log('Export');
  await page.goto(base); await page.click('#btn-try'); await page.locator('#samples .sample button').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('#replica .rp-chart').length >= 8); await wait(2500);
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
  const unit = await page.evaluate(() => {
    const { classify, plausible } = window.__DSC.test;
    const w = (text, h, conf, ww) => ({ text, x: 0, y: 0, w: ww || h * text.length * 0.6, h, conf });
    const kept = plausible([w('Revenue', 12, 95), w('Orders', 12, 95), w('Users', 12, 93), w('$4.2M', 30, 96), w('ffi', 180, 40), w('Il', 120, 55)]).map(x => x.text);
    return { email: classify('ana@nor'), email2: classify('@example.com'), small: classify('9'), kept };
  });
  check(unit.email === 'Email' && unit.email2 === 'Email', 'partial email addresses are still masked (#8)');
  check(unit.small === 'Number or money', 'single-digit numbers are masked (#8)');
  check(unit.kept.includes('$4.2M') && !unit.kept.includes('ffi') && !unit.kept.includes('Il'), `chart shapes read as giant "words" are dropped, big KPI numbers kept (#9: ${unit.kept.join(', ')})`);
  const cm = await page.evaluate(() => {
    const S = window.__DSC, T = S.test;
    let x = 0; const line = (y, text) => { x = 10; return text.split(' ').map(t => { const w = { text: t, x, y, w: t.length * 6, h: 11, conf: 95 }; x += t.length * 6 + 5; return w; }); };
    const words = [].concat(
      line(10, 'Rachel Whitford - Harbourline Logistics - r.whitford@harbourline.example'),
      line(30, '“Exports keep timing out on large shipments. We lose 3 days every month-end."'),
      line(60, '“Support from Priya fixed our integration issue in under an hour. Outstanding."'),
      line(90, 'Revenue by region and channel'));
    const saved = { k: S.keepComments, c: S.comments };
    S.keepComments = true; S.comments = T.findComments(words);
    const masked = T.buildMasks(words).map(m => m.type + ': ' + m.text);
    const out = { lines: S.comments.length, blocks: S.comments.blocks, masked,
      q1: T.scrubQuote('Exports keep timing out on large shipments. We lose 3 days every month-end.'),
      q2: T.scrubQuote('Support from Priya fixed our integration issue. Call Harbourline on 555 0101.') };
    S.keepComments = saved.k; S.comments = saved.c;
    return out;
  });
  check(cm.lines === 2 && cm.blocks === 2, `quoted customer comments are found, headings and name lines are not (${cm.lines})`);
  check(cm.masked.some(m => /^Name in comment: Priya/.test(m)) && cm.masked.some(m => /^Number or money: 3/.test(m)) && cm.masked.some(m => /^Email/.test(m)), `names and numbers inside kept comments stay masked (${cm.masked.join(' | ')})`);
  check(!cm.masked.some(m => /Exports|keep|timing|Outstanding|integration/.test(m)), 'ordinary comment wording is kept');
  check(cm.q1 === 'Exports keep timing out on large shipments. We lose […] days every month-end.' && !/Priya|Harbourline|555/.test(cm.q2), `the replica can only quote words that were readable in the approved image (${cm.q2})`);

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
