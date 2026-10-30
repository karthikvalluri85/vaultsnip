// End-to-end smoke test: serves web/ locally and drives the app in headless Chromium.
// The in-place replica itself is tested in tests/e2e/inplace.e2e.mjs.
// Usage: node tools/e2e.mjs        (first time: npx playwright install chromium)
// Set PW_CHROMIUM to a Chromium binary to use a preinstalled browser.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css', '.mjs': 'text/javascript', '.pdf': 'application/pdf' };
// the site's security headers (web/_headers, as Cloudflare Pages serves them), so every check runs under the real policy
const HEADERS = Object.fromEntries((await readFile(join(web, '_headers'), 'utf8')).split(/\r?\n/).filter(l => /^\s+[\w-]+:/.test(l)).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = path || 'index.html';
  try { const body = await readFile(join(web, file)); res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
// anything the site's Content-Security-Policy blocks is a bug: the app must work entirely within it
const cspBlocked = []; page.on('console', m => { if (/Content Security Policy|Refused to (load|connect|execute|create|apply)/i.test(m.text())) cspBlocked.push(m.text().slice(0, 200)); });
// Zero-network promise, checked over the whole run: the app only talks to its own site.
const offsite = []; page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob|about):/.test(u)) offsite.push(u); });
const wait = ms => page.waitForTimeout(ms);

try {
  const first = await page.goto(base);
  const csp = first.headers()['content-security-policy'] || '';
  check(/connect-src 'self' data: blob:;/.test(csp) && /script-src 'self' 'wasm-unsafe-eval';/.test(csp),
    'the page is served with its Content-Security-Policy: scripts from this site only, and it can reach only this site');
  await page.goto(base);
  console.log('Feedback');
  await page.locator('header [data-feedback]').click();
  check(await page.locator('#dlg-fb').evaluate(d => d.open), 'header Feedback opens the dialog');
  const diag = await page.locator('#fb-diag').textContent();
  check(/VaultSnip \d+\.\d+\.\d+/.test(diag) && /Step: Start screen/.test(diag), 'diagnostics include version and step');
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
  // record every progress figure shown while the demo is read and checked
  await page.evaluate(() => {
    window.__progress = [];
    new MutationObserver(() => { const m = /(\d+)%/.exec(document.getElementById('status-text').textContent); if (m) window.__progress.push(+m[1]); })
      .observe(document.getElementById('status-text'), { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#samples .sample button').nth(0).click();
  await page.waitForFunction(() => { const g = document.querySelector('.gate'); return g && /Blocked|Review|Pass/.test(g.textContent) && !/Checking/.test(g.textContent); }, null, { timeout: 120000 });
  const prog = await page.evaluate(() => window.__progress);
  const drops = prog.filter((v, i) => i > 0 && v < prog[i - 1]).length;
  check(prog.length > 5 && drops === 0 && Math.max(...prog) >= 90, `reading and checking show one progress figure that only climbs (${prog.length} updates, ${prog[0]}% → ${prog[prog.length - 1]}%, ${drops} restarts)`);
  const gate = (await page.locator('.gate').textContent()).replace(/\s+/g, ' ').trim();
  check(/Blocked|Review/.test(gate), `pre-flight check catches readable text (${gate.slice(0, 40)}…)`);
  check(await page.evaluate(() => (window.__DSC.masks || []).length > 20), 'sensitive text is masked');
  check(await page.evaluate(() => window.__DSC.ctx.state) === 'ready', `on-device name check ran on the demo (${await page.evaluate(() => window.__DSC.ctx.state)})`);
  const ctx = await page.evaluate(async () => {
    const S = window.__DSC, T = S.test, saved = S.words;
    const line = (y, text) => { let x = 10; return text.split(' ').map(t => { const w = { text: t, x, y, w: t.length * 7, h: 12, conf: 95 }; x += t.length * 7 + 6; return w; }); };
    S.words = [].concat(line(10, 'Owner: May Chen'), line(40, 'Revenue by Month'));
    await T.scoreContext();
    const masked = T.contextMasks().map(m => m.text);
    // a word the user marked "Safe to keep" is never masked by the name check (regression: a lost \w in the lookup)
    S.sessionAllow.add('may');
    const afterSafe = T.contextMasks().map(m => m.text);
    S.sessionAllow.delete('may');
    S.words = saved; await T.scoreContext();
    return { masked, afterSafe };
  });
  check(ctx.masked.includes('May') && !ctx.masked.includes('Month') && !ctx.masked.includes('Revenue'), `a safe word used as a name is masked in context, labels are not (${ctx.masked.join(', ') || 'none'})`);
  check(!ctx.afterSafe.includes('May'), 'a word marked "Safe to keep" is not masked by the name check');
  const unit = await page.evaluate(() => {
    const { classify, plausible } = window.__DSC.test;
    const w = (text, h, conf, ww) => ({ text, x: 0, y: 0, w: ww || h * text.length * 0.6, h, conf });
    const kept = plausible([w('Revenue', 12, 95), w('Orders', 12, 95), w('Users', 12, 93), w('$4.2M', 30, 96), w('ffi', 180, 40), w('Il', 120, 55)]).map(x => x.text);
    return { email: classify('ana@nor'), email2: classify('@example.com'), small: classify('9'), kept };
  });
  check(unit.email === 'Email' && unit.email2 === 'Email', 'partial email addresses are still masked (#8)');
  check(unit.small === 'Number or money', 'single-digit numbers are masked (#8)');
  check(unit.kept.includes('$4.2M') && !unit.kept.includes('ffi') && !unit.kept.includes('Il'), `chart shapes read as giant "words" are dropped, big KPI numbers kept (#9: ${unit.kept.join(', ')})`);
  console.log('Numbers replaced with invented values of the same size');
  const fk = await page.evaluate(() => {
    const T = window.__DSC.test, bad = [];
    const digitsBefore = t => (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(r => r.split('.')[0].replace(/,/g, '').length + '.' + (r.split('.')[1] || '').length).join(' ');
    const shape = t => t.replace(/\d/g, '9');
    const cases = ['€48.6M', '62.4%', '312', '+11.2%', '-0.9', '21 °C', '1,284', '$4,210,000', '4.5 / 5', '100%', '8%', '£0.75', '98.6°F', '7'];
    for (const c of cases) for (let seed = 1; seed <= 40; seed++) {
      const f = T.fakeValue(c, seed);
      if (f === c) bad.push('same: ' + c);
      if (c !== '100%' && digitsBefore(f) !== digitsBefore(c)) bad.push(`digits: ${c} -> ${f}`);   // 100% can only go down to 9x%
      if (shape(f).replace(/9/g, '') !== shape(c).replace(/9/g, '')) bad.push(`symbols: ${c} -> ${f}`);
      if (/%/.test(c) && parseFloat(f.replace(/[^\d.]/g, '')) > 100) bad.push(`over 100%: ${f}`);
    }
    const kept = [T.fakeValue('2026', 3), T.fakeValue('FY 2026', 3)];
    const date = T.fakeValue('30-Sep-2026', 5), time = T.fakeValue('12:45', 5);
    const ratings = Array.from({ length: 30 }, (_, i) => T.fakeValue('4.5 / 5', i + 1));
    const ratingOk = ratings.every(t => /^\d\.\d \/ 5$/.test(t) && parseFloat(t) <= 5 && t !== '4.5 / 5');
    return { bad: bad.slice(0, 5), n: bad.length, kept, date, time, ratingOk, rating: ratings[0], sample: cases.map(c => c + ' → ' + T.fakeValue(c, 11)).join(', ') };
  });
  check(fk.n === 0, `invented numbers always differ from the real ones and keep their size, decimals, symbols and units (${fk.sample})` + (fk.n ? ': ' + fk.bad.join(' | ') : ''));
  check(fk.ratingOk, `a rating keeps its scale and stays within it (4.5 / 5 → ${fk.rating})`);
  check(fk.kept[0] === '2026' && /-Sep-2026$/.test(fk.date) && +fk.date.split('-')[0] <= 28 && /^\d{2}:[0-5]\d$/.test(fk.time), `years stay, dates and times stay valid (${fk.date}, ${fk.time})`);
  const img = await page.evaluate(() => {
    const S = window.__DSC, T = S.test, m = S.masks.find(q => q.on && q.type === 'Number or money' && q.w > 30 && q.h > 14 && q.text && q.text !== '(table column)');
    const c = T.maskedCanvas(1), x = c.getContext('2d'), d = x.getImageData(Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h)).data;
    let grey = 0, n = 0; for (let i = 0; i < d.length; i += 4) { n++; if (Math.abs(d[i] - 120) < 4 && Math.abs(d[i + 1] - 124) < 4 && Math.abs(d[i + 2] - 130) < 4) grey++; }
    const noTag = T.maskedCanvas(1, null, { tag: false });
    S.fakeNumbers = false; const off = T.maskedCanvas(1).getContext('2d').getImageData(Math.round(m.x + m.w / 2), Math.round(m.y + m.h / 2), 1, 1).data; S.fakeNumbers = true;
    const axis = [0, 1, 2, 3, 4].map(i => ({ type: 'Number or money', text: '€' + (8 - i) + 'M', x: 800, y: 340 + i * 52, w: 34, h: 17, on: true }));
    const ax = T.axisFactors(axis), vals = axis.map(a => ax.get(a)), steps = vals.slice(1).map((v, i) => v - vals[i]);
    return { greyShare: grey / n, tall: c.height > S.img.height, noTag: noTag.height === S.img.height, off: Array.from(off.slice(0, 3)).join(), vals, even: steps.every(s => s === steps[0] && s < 0), note: document.getElementById('fake-on').checked };
  });
  check(img.note && img.greyShare < 0.2, `numbers in the masked image are drawn as invented values, not grey boxes (${Math.round(img.greyShare * 100)}% grey at a number)`);
  check(img.tall && img.noTag, 'the image carries a note below it that its numbers are made up (left out for the on-device builder)');
  check(img.vals.every(v => typeof v === 'number') && img.even && img.vals[0] !== 8, `an axis is rebuilt as an even scale in the same order (€8M…€4M → ${img.vals.map(v => '€' + v + 'M').join(', ')})`);
  check(img.off === '120,124,130', 'unticking "Replace numbers with invented values" brings back grey boxes');
  await page.locator('#v-mask').click();
  check(await page.locator('#fake-note').isVisible(), 'the masked view says in the page that its numbers are made up');
  await page.locator('#v-orig').click();

  console.log('Numbers in context: labels, not data (issue: "Top 5 performers")');
  const ctxNums = await page.evaluate(() => {
    const { buildMasks } = window.__DSC.test;
    let y = 0;
    const masked = text => { y += 30; let x = 10; const ws = text.split(' ').map(t => { const w = { text: t, x, y, w: t.length * 7, h: 12, conf: 95 }; x += t.length * 7 + 6; return w; }); return buildMasks(ws).map(m => m.text); };
    return {
      top: masked('Top 5 performers'), last: masked('Last 30 days'), week: masked('Week 34'), page: masked('Page 1 of 3'), step: masked('Step 2 Review'),
      hyph: masked('Top-10 stores'), bottom: masked('Bottom 10 regions'),
      periods: [masked('L12M Revenue'), masked('R12M'), masked('Q1-Q3 2026'), masked('FY25-26'), masked('2025-26'), masked('#1 Product')],
      value: masked('Revenue 5'), dur: masked('Avg resolution 3 days'), bare: masked('5 performers'), money: masked('Top 5 $1.2M'), pct: masked('Margin 5%'), big: masked('Top 12500')
    };
  });
  // (only the numbers matter here: a word such as "performers" may be masked because it is not on the safe list)
  check(![ctxNums.top, ctxNums.last, ctxNums.week, ctxNums.page, ctxNums.step, ctxNums.hyph, ctxNums.bottom].some(l => l.some(t => /\d/.test(t))), `counts that label a visual stay readable: Top 5, Last 30 days, Week 34, Page 1 of 3, Step 2, Top-10, Bottom 10 (${JSON.stringify([ctxNums.top, ctxNums.last, ctxNums.week, ctxNums.page])})`);
  check(ctxNums.value.includes('5') && ctxNums.dur.includes('3') && ctxNums.bare.includes('5') && ctxNums.pct.some(t => /5%/.test(t)) && ctxNums.big.includes('12500'),
    'numbers standing as values stay masked: "Revenue 5", "Avg resolution 3 days", "5 performers", "Margin 5%", "Top 12500"');
  check(ctxNums.periods.every(l => !l.some(t => /\d/.test(t))), `period and rank labels stay readable: L12M, R12M, Q1-Q3, FY25-26, 2025-26, #1 (${JSON.stringify(ctxNums.periods)})`);
  check(ctxNums.money.some(t => /1\.2M/.test(t)) && !ctxNums.money.includes('5'), 'in "Top 5 $1.2M" the count stays readable and the money is masked');
  check(!(await page.evaluate(() => window.__DSC.masks.some(m => m.on && m.text === '5' && m.y > 600 && m.y < 670))), 'the demo\'s "Top 5 Accounts" title keeps its 5');
  // switching a number's mask off is remembered: the check does not re-flag it, and re-applying the policy keeps it off
  const userOff = await page.evaluate(async () => {
    const S = window.__DSC, m = S.masks.find(q => q.on && q.src === 'auto' && q.type === 'Number or money' && q.w < 120 && q.y < 300);
    const canvas = document.getElementById('review-canvas'), r = canvas.getBoundingClientRect();
    const at = { clientX: r.left + (m.x + m.w / 2) * r.width / canvas.width, clientY: r.top + (m.y + m.h / 2) * r.height / canvas.height, pointerId: 1, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', at)); canvas.dispatchEvent(new PointerEvent('pointerup', at));
    return { text: m.text, box: { x: m.x, y: m.y, w: m.w, h: m.h }, off: !m.on, userOff: !!m.userOff };
  });
  check(userOff.off && userOff.userOff, `clicking a number's mask switches it off and records that you chose to show it ("${userOff.text}")`);
  await page.click('#btn-recheck');
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('.gate').textContent), null, { timeout: 120000 });
  const reflag = await page.evaluate(b => window.__DSC.flags.some(f => { const cx = f.x + f.w / 2, cy = f.y + f.h / 2; return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; }), userOff.box);
  check(!reflag, 'the check does not re-flag a number you chose to show (no dead end)');
  await page.click('#btn-reapply');
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('.gate').textContent), null, { timeout: 120000 });
  check(await page.evaluate(b => window.__DSC.masks.some(m => m.src === 'auto' && !m.on && m.userOff && Math.abs(m.x - b.x) < 4 && Math.abs(m.y - b.y) < 4), userOff.box), '"Re-apply policy" keeps a mask you switched off, off');
  // a box you drew over an automatic one: one click clears the spot (both switch off together)
  // (real mouse clicks, as a user makes them)
  await page.evaluate(() => document.getElementById('review-canvas').scrollIntoView({ block: 'center' }));
  const spot = await page.evaluate(() => {
    // (below the top of the image, which the page's sticky header can cover after scrolling)
    const S = window.__DSC, m = S.masks.find(q => q.on && q.src === 'auto' && q.w < 200 && q.y > S.img.height * 0.25);
    S.masks.push({ x: m.x - 4, y: m.y - 4, w: m.w + 8, h: m.h + 8, type: 'Added by you', text: '(drawn box)', on: true, src: 'manual' });
    const canvas = document.getElementById('review-canvas'), r = canvas.getBoundingClientRect();
    return { cx: m.x + m.w / 2, cy: m.y + m.h / 2, x: r.left + (m.x + m.w / 2) * r.width / canvas.width, y: r.top + (m.y + m.h / 2) * r.height / canvas.height };
  });
  const atSpot = () => page.evaluate(s => window.__DSC.masks.filter(q => q.x <= s.cx && q.x + q.w >= s.cx && q.y <= s.cy && q.y + q.h >= s.cy).map(q => q.on), spot);
  await page.mouse.click(spot.x, spot.y);
  const click1 = await atSpot();
  await page.mouse.click(spot.x, spot.y);
  const click2 = await atSpot();
  const both = { n: click1.length, off: click1.every(v => !v), backOn: click2.every(v => v), states: click2.join(' ') };
  check(both.n >= 2 && both.off && both.backOn, `one click switches every mask at a spot off together, and back on (${both.n} masks; after: ${both.states}; off first: ${both.off})`);
  // a blocking finding that is not sensitive can be kept, at that spot only
  await page.evaluate(() => {
    const S = window.__DSC;
    S.flags = [{ x: 40, y: 40, w: 30, h: 20, text: '5', type: 'Number or money', severity: 'block', resolved: false }];
    S.test.updateGate();
  });
  const keepBtn = page.locator('#flags button', { hasText: 'Not sensitive, keep it' });
  check(await keepBtn.count() === 1 && /Blocked/.test(await page.locator('.gate').textContent()), 'a blocking finding offers "Not sensitive, keep it" next to "Mask it"');
  await keepBtn.click();
  const afterKeep = await page.evaluate(() => ({ gate: document.querySelector('.gate').textContent, kept: window.__DSC.masks.filter(m => m.type === 'Kept by you' && !m.on && m.userOff).length }));
  check(/Pass/.test(afterKeep.gate) && afterKeep.kept === 1, `keeping it resolves the finding and records the spot as yours (${afterKeep.gate.trim().slice(0, 20)})`);
  // "Hide everything uncertain": one click masks every open finding, numbers and unlisted words alike
  const hu0 = await page.evaluate(() => window.__DSC.masks.length);
  await page.evaluate(() => {
    const S = window.__DSC;
    S.flags = [{ x: 60, y: 60, w: 30, h: 20, text: '42', type: 'Number or money', severity: 'block', resolved: false },
      { x: 120, y: 60, w: 60, h: 20, text: 'Zorblat', type: 'Text not on allowlist', severity: 'review', resolved: false }];
    S.test.updateGate();
  });
  const huBtn = page.locator('#btn-hide-unsure');
  check(await huBtn.isVisible() && /\(2\)/.test(await huBtn.textContent()), `"Hide everything uncertain" appears with the number of open findings (${(await huBtn.textContent()).trim()})`);
  await huBtn.click();
  const hu = await page.evaluate(() => ({ gate: document.querySelector('.gate').textContent, added: window.__DSC.masks.slice(-2).map(m => m.on && m.src === 'check' && m.type === 'Added after check'), n: window.__DSC.masks.length }));
  check(/Pass/.test(hu.gate) && hu.n === hu0 + 2 && hu.added.every(Boolean) && await huBtn.isHidden(), 'one click hides both, counts them as your decisions, and the gate passes');
  await page.evaluate(() => { const S = window.__DSC; S.masks.splice(-2, 2); S.flags = []; S.test.updateGate(); });
  // the review summary: plain numbers that add up, your decisions counted, and a clear next step
  const sum = await page.evaluate(() => {
    const S = window.__DSC, words = S.words.filter(w => !w.ghost);
    const n = id => +document.getElementById(id).textContent;
    return { hidden: n('k-hidden'), kept: n('k-kept'), you: n('k-you'), words: words.length, next: document.getElementById('next-step').textContent,
      yoursExpected: S.masks.filter(m => m.userOff || ['manual', 'check', 'user'].includes(m.src)).length + S.sessionAllow.size,
      types: [...document.querySelectorAll('#types div span:nth-child(2)')].map(s => s.textContent) };
  });
  check(sum.hidden + sum.kept === sum.words && sum.hidden > 20 && sum.kept > 10, `the summary counts every word read: ${sum.hidden} hidden + ${sum.kept} kept readable = ${sum.words}`);
  check(sum.you === sum.yoursExpected && sum.you >= 2, `"Changed by you" counts your decisions (${sum.you})`);
  check(/^Ready: /.test(sum.next) && /decisions? of yours/.test(sum.next), `the next step says plainly what to do ("${sum.next.slice(0, 70)}…")`);
  check(sum.types.some(t => /^Numbers/.test(t)) && !sum.types.some(t => /Number or money|allowlist/.test(t)), `categories use plain words (${sum.types.join(', ')})`);
  await page.evaluate(() => { document.getElementById('mask-list').open = true; });
  await page.locator('#mask-filter button[data-f="yours"]').click();
  const yoursList = await page.evaluate(() => ({ rows: document.querySelectorAll('#mask-items label').length, badges: document.querySelectorAll('#mask-items .badge').length }));
  check(yoursList.rows === sum.you - (await page.evaluate(() => window.__DSC.sessionAllow.size)) && yoursList.badges === yoursList.rows, `"Your choices" lists exactly your decisions, each marked (${yoursList.rows})`);
  await page.locator('#mask-filter button[data-f="all"]').click();
  await page.evaluate(() => { document.getElementById('mask-list').open = false; });
  const ui = await page.evaluate(() => ({ list: document.querySelectorAll('#mask-items input').length, masks: window.__DSC.masks.length, kept: +document.getElementById('kept-n').textContent }));
  check(ui.list === ui.masks, `every mask can be switched with the keyboard (${ui.list} checkboxes)`);
  check(ui.kept > 3, `words kept as safe are listed so a name like "Target" can be masked (${ui.kept})`);
  await page.locator('#mask-list summary').click(); await page.locator('#mask-items input').first().press('Space');
  check(/Masks changed/.test(await page.locator('.gate').textContent()) && await page.locator('#btn-send').isDisabled(), 'switching a mask off from the list blocks sending until the check runs again');
  await page.fill('#client-names', 'Kestrelmoor, Acme');
  check(/Policy changed/.test(await page.locator('.gate').textContent()) && await page.locator('#btn-send').isDisabled(), 'typing a new name to mask blocks sending until it is applied');

  console.log('Mask-only download');
  await page.evaluate(() => document.getElementById('btn-send').onclick());
  check(await page.locator('#btn-dl-masked').isDisabled() && await page.locator('#btn-confirm').isDisabled(), 'nothing can be downloaded or built before "I have looked over the masked image" is ticked');
  await page.check('#pf-ok');
  const [dlM] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-masked')]).catch(async e => {
    // say why, if the file never comes (an error while painting the image, say)
    throw new Error(e.message.split('\n')[0] + ' | page errors: ' + pageErrors.join(' | ') + ' | dialog: ' + await page.locator('#send-err').textContent());
  });
  const png = (await readFile(await dlM.path())).toString('base64');
  const px = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const S = window.__DSC, m = S.masks.find(q => q.on && q.w > 20);
    const at = (px, py) => Array.from(x.getImageData(Math.round(px), Math.round(py), 1, 1).data.slice(0, 3));
    // full width; the footer strip that says numbers are made up sits below the picture
    return { same: img.width === S.img.width && img.height > S.img.height && img.height < S.img.height * 1.1, foot: at(4, img.height - 4), mask: at(m.x + m.w / 2, m.y + m.h / 2), tag: at(img.width - 12, img.height - 12) };
  }, png);
  check(dlM.suggestedFilename() === 'sample-masked.png' && px.same && px.foot.every(c => c < 60), `the masked PNG is full size, with the made-up-numbers note below it (${dlM.suggestedFilename()})`);
  check(px.mask.join() === '120,124,130', 'masks in the PNG are solid grey');
  check(px.tag.every(c => c < 110), 'the PNG carries a small "masked with VaultSnip" tag unless unticked');
  await page.keyboard.press('Escape');

  console.log('Hide everything uncertain, copy, and the safe-to-share receipt');
  // the policy typed above, applied: the check runs again, and one click settles whatever it leaves open
  await page.click('#btn-reapply');
  await page.waitForFunction(() => /Blocked|Review|Pass/.test(document.querySelector('.gate').textContent) && !/Checking/.test(document.querySelector('.gate').textContent), null, { timeout: 180000 });
  if (await page.locator('#btn-hide-unsure').isVisible()) await page.click('#btn-hide-unsure');
  check(/Pass/.test(await page.locator('.gate').textContent()) && await page.locator('#btn-send').isEnabled(), 'after "Hide everything uncertain" the check passes and the masked image can be previewed');
  await page.click('#btn-send');
  check(await page.locator('#btn-copy-masked').isDisabled() && await page.locator('#btn-receipt-png').isDisabled(), 'copying and the receipt wait for "I have looked over the masked image", like downloading');
  await page.check('#pf-ok');
  const [dlM2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-masked')]);
  const fileM = await readFile(await dlM2.path()), shaM = createHash('sha256').update(fileM).digest('hex');
  // "Copy masked image": the clipboard gets the downloaded picture, pixel for pixel (browsers re-encode clipboard images)
  await page.click('#btn-copy-masked');
  await page.waitForFunction(() => /Copied|does not work/.test(document.getElementById('send-err').textContent), null, { timeout: 10000 });
  const clipSame = await page.evaluate(async b64 => {
    const pix = async src => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const it = (await navigator.clipboard.read())[0], a = await pix(URL.createObjectURL(await it.getType('image/png'))), b = await pix('data:image/png;base64,' + b64);
    if (a.width !== b.width || a.height !== b.height) return `${a.width}×${a.height} vs ${b.width}×${b.height}`;
    let diff = 0; for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
    return diff;
  }, fileM.toString('base64'));
  check(clipSame === 0, `"Copy masked image" copies exactly the downloaded picture (${clipSame} values differ)`);
  // the safe-to-share receipt: counts and kinds, the check, where it was made, and the file's SHA-256; never hidden text
  const rf = await page.evaluate(async () => { const f = await window.__DSC.test.receiptFacts(); return { sha: f.sha, text: f.rows.map(r => r.join(' ')).join('\n') + f.subtitle + f.note }; });
  const hiddenWords = await page.evaluate(() => { const S = window.__DSC, on = S.masks.filter(m => m.on); return [...new Set(S.words.filter(w => on.some(m => w.x + w.w / 2 >= m.x && w.x + w.w / 2 <= m.x + m.w && w.y + w.h / 2 >= m.y && w.y + w.h / 2 <= m.y + m.h)).map(w => w.text.replace(/[^\p{L}\p{N}]/gu, '')).filter(t => t.length >= 4))]; });
  check(rf.sha === shaM, `the receipt names the downloaded file by its SHA-256 (${shaM.slice(0, 12)}…)`);
  check(/Passed/.test(rf.text) && /On this device/.test(rf.text) && /Numbers/.test(rf.text) && /VaultSnip 0\.\d+\.\d+/.test(rf.text), 'the receipt says the check passed, that it was made on this device, and what kinds were hidden');
  const leakedR = hiddenWords.filter(t => rf.text.includes(t));
  check(hiddenWords.length > 10 && !leakedR.length, `the receipt never contains hidden text (${hiddenWords.length} hidden words checked${leakedR.length ? '; found: ' + leakedR.slice(0, 5).join(', ') : ''})`);
  const [dlRcpt] = await Promise.all([page.waitForEvent('download'), page.click('#btn-receipt-png')]);
  const rcPng = await readFile(await dlRcpt.path());
  check(dlRcpt.suggestedFilename() === 'sample-masked-receipt.png' && rcPng.readUInt32BE(16) === 1000 && rcPng.readUInt32BE(20) > 600, `the receipt downloads as a PNG (${dlRcpt.suggestedFilename()}, ${rcPng.readUInt32BE(16)} × ${rcPng.readUInt32BE(20)})`);
  const [dlRcP] = await Promise.all([page.waitForEvent('download'), page.click('#btn-receipt-pdf')]);
  const rcPdf = (await readFile(await dlRcP.path())).toString('latin1');
  const sx = +(/startxref\n(\d+)/.exec(rcPdf) || [])[1], offs = [...rcPdf.slice(sx).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  check(/^%PDF-1\.4/.test(rcPdf) && rcPdf.slice(sx, sx + 4) === 'xref' && offs.length === 6 && offs.every((o, i) => rcPdf.startsWith(`${i + 1} 0 obj`, o)) && /DCTDecode/.test(rcPdf) && rcPdf.includes(shaM), 'the PDF receipt is a well-formed one-page PDF that carries the SHA-256 in its properties');
  await page.keyboard.press('Escape');

  console.log('Paste and copy everywhere');
  const pasteOn = async () => page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#14181e'; x.font = '28px sans-serif'; x.fillText('Revenue 4,210', 40, 80);
    const b = await new Promise(r => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([b], 'image.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  let asked = 0; const onDlg = d => { asked++; d.accept(); }; page.on('dialog', onDlg);
  await pasteOn();
  await page.waitForFunction(() => !document.getElementById('s-review').hidden && window.__DSC.img && window.__DSC.img.width === 640, null, { timeout: 30000 }).catch(() => {});
  check(asked === 1 && await page.evaluate(() => window.__DSC.img && window.__DSC.img.width === 640), 'pasting a screenshot on the review screen asks first, then starts again with it');
  page.off('dialog', onDlg);
  await page.evaluate(() => document.getElementById('btn-restart').click());
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 500; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 300); const b = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); });
  await page.click('#btn-paste');
  await page.waitForFunction(() => window.__DSC.img && window.__DSC.img.width === 500, null, { timeout: 30000 }).catch(() => {});
  check(await page.evaluate(() => window.__DSC.img && window.__DSC.img.width === 500 && !document.getElementById('s-review').hidden), '"Paste a screenshot" on the start screen reads the clipboard after a click');

  console.log('No AI service, no key');
  {
    // the app has no key setting, no AI code, and its policy would block a call to an AI service even if one were made
    const gone = await page.evaluate(() => ({ llm: typeof window.VSLLM, key: !!document.getElementById('btn-key'), stored: (() => { try { return Object.keys(localStorage).filter(k => /key|model|provider/i.test(k)); } catch (e) { return []; } })() }));
    check(gone.llm === 'undefined' && !gone.key && gone.stored.length === 0, 'there is no AI key setting and no AI code, and nothing about a key is stored');
    const blocked = await page.evaluate(async () => { try { await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' }); return false; } catch (e) { return true; } });
    check(blocked, 'the Content-Security-Policy blocks a request to an AI service');
    cspBlocked.length = 0;   // the blocked request above is the point of the check, not a bug
  }

  console.log('Reader watchdog');
  // the reader can stop answering on a busy machine: the app must restart it, and say so if it happens twice
  {
    await page.goto(base);
    const small = await page.screenshot({ clip: { x: 0, y: 0, width: 360, height: 140 } });
    const warnings = []; const onWarn = m => { if (m.type() === 'warning') warnings.push(m.text()); };
    page.on('console', onWarn);
    await page.evaluate(() => { window.__DSC.test.stalls = 1; window.__DSC.test.stallMs = 2000; });
    await page.setInputFiles('#file', { name: 'stall-once.png', mimeType: 'image/png', buffer: small });
    const ok = await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
    check(ok && warnings.some(w => /stopped responding; restarting/.test(w)), 'a reader that stops answering is restarted and the reading finishes');
    await page.goto(base);
    warnings.length = 0;
    await page.evaluate(() => { window.__DSC.test.spins = 1; window.__DSC.test.stallMs = 2000; });
    await page.setInputFiles('#file', { name: 'spin-once.png', mimeType: 'image/png', buffer: small });
    const spun = await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
    check(spun && warnings.some(w => /stopped responding; restarting/.test(w)), 'a reader stuck repeating the same progress figure is restarted too');
    await page.goto(base);
    await page.evaluate(() => { window.__DSC.test.stalls = 2; window.__DSC.test.stallMs = 2000; });
    await page.setInputFiles('#file', { name: 'stall-twice.png', mimeType: 'image/png', buffer: small });
    const told = await page.waitForFunction(() => /could not finish: it stopped responding twice/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
    check(told, 'a reader that stops answering twice gives a clear message instead of a frozen progress figure');
    page.off('console', onWarn);
  }

  console.log('Two screenshots in quick succession');
  // The first screenshot is still being read when the second arrives: its late results must not land on the second.
  await page.goto(base);
  const small = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 120 } });
  await page.setInputFiles('#file', join(web, 'samples', 'kestrelmoor.png'));
  await wait(300);
  await page.setInputFiles('#file', { name: 'second.png', mimeType: 'image/png', buffer: small });
  await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 180000 });
  await wait(1500);
  const race = await page.evaluate(() => {
    const S = window.__DSC, W = S.img.width, H = S.img.height;
    const inside = b => b.x >= -8 && b.y >= -8 && b.x + b.w <= W + 8 && b.y + b.h <= H + 8;
    return { W, H, words: S.words.length, outWords: S.words.filter(w => !inside(w)).length, outMasks: S.masks.filter(m => !inside(m)).length };
  });
  check(race.W === 320 && race.outWords === 0 && race.outMasks === 0, `only the second screenshot's words and masks remain (${race.W}×${race.H}, ${race.words} words, ${race.outWords + race.outMasks} out of bounds)`);

  console.log('PDF input and batch masking');
  {
    // fixtures made here, from invented content: a plain image with no text, one with a coloured logo in a corner,
    // and a two-page PDF
    const aux = await browser.newPage();
    const pngOf = async (draw) => Buffer.from((await aux.evaluate(draw)).split(',')[1], 'base64');
    const blank = await pngOf(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 360); x.fillStyle = '#d0d4da'; x.fillRect(60, 120, 480, 4); return c.toDataURL('image/png'); });
    await aux.setContent(`<style>@page{size:600px 400px;margin:0}body{margin:0;font:28px sans-serif}div{height:400px;padding:40px;box-sizing:border-box;break-after:page}</style><div>Quarterly sales overview</div><div>Halvorsen Freight 48,213</div>`);
    const pdf = await aux.pdf({ width: '600px', height: '400px', printBackground: true });
    await aux.close();

    await page.goto(base);
    const onDialog = d => d.accept('2'); page.on('dialog', onDialog);
    await page.setInputFiles('#file', { name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: pdf });
    const pdfOk = await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 120000, polling: 500 }).then(() => true, () => false);
    const pdfRead = await page.evaluate(() => ({ w: window.__DSC.img && window.__DSC.img.width, words: (window.__DSC.words || []).map(w => w.text).join(' ') }));
    page.off('dialog', onDialog);
    check(pdfOk && pdfRead.w > 500 && /48|Halvorsen/i.test(pdfRead.words), `a PDF opens with the bundled reader, the chosen page is read and checked (${pdfRead.w} px wide)`);
    check(pdfRead.w > 0 && !/Quarterly/.test(pdfRead.words), 'the page asked for is the one read (page 2, not page 1)');

    await page.goto(base);
    await page.click('#btn-batch');
    await page.setInputFiles('#batch-file', [
      { name: 'blank.png', mimeType: 'image/png', buffer: blank },
      { name: 'kestrelmoor.png', mimeType: 'image/png', buffer: await readFile(join(web, 'samples', 'kestrelmoor.png')) },
      { name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: '<img src=x>.png', mimeType: 'image/png', buffer: blank },
    ]);
    check(await page.locator('#batch-queue img').count() === 0, 'file names in the batch queue are shown as text, not HTML');
    await page.click('#btn-batch-run');
    await page.waitForFunction(() => /^Done\./.test(document.getElementById('batch-status').textContent), null, { timeout: 400000, polling: 1000 });
    const st = await page.evaluate(() => ({ status: document.getElementById('batch-status').textContent, queue: document.getElementById('batch-queue').textContent, held: [...document.querySelectorAll('#batch-held button')].map(b => b.textContent) }));
    check(st.held.some(t => /kestrelmoor/.test(t)) && !st.held.some(t => /^Review blank/.test(t)), `batch runs the six-pass check on every image and holds back the ones that do not pass (${st.held.length} held)`);
    check(/2 pages/.test(st.queue), 'batch masking reads every page of a PDF, not only the first');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-batch-dl')]);
    const zip = await readFile(await dl.path());
    // read the ZIP's central directory and check each entry's CRC: a well-formed archive any unzip tool accepts
    const { crc32 } = await import('node:zlib');
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const n = zip.readUInt16LE(eocd + 10); let off = zip.readUInt32LE(eocd + 16); const names = []; let crcOk = true;
    for (let i = 0; i < n; i++) {
      const nl = zip.readUInt16LE(off + 28), lo = zip.readUInt32LE(off + 42), crc = zip.readUInt32LE(off + 16), size = zip.readUInt32LE(off + 24);
      names.push(zip.subarray(off + 46, off + 46 + nl).toString());
      const lnl = zip.readUInt16LE(lo + 26), data = zip.subarray(lo + 30 + lnl, lo + 30 + lnl + size);
      if (crc32(data) >>> 0 !== crc) crcOk = false;
      off += 46 + nl;
    }
    check(eocd > 0 && n === names.length && crcOk && names.every(x => x.endsWith('.png')), `the batch ZIP is well formed (${n} entries, checksums match), made in the browser`);
    check(names.includes('blank-masked.png') && names.includes('blank-masked-receipt.png'), 'an image that passed is in the ZIP with its receipt');
    check(!names.some(x => /kestrelmoor/.test(x)), 'an image held back by the check is not in the ZIP');
    const pdfEntries = names.filter(x => /^two-pages-p\d-masked\.png$/.test(x)).length + st.held.filter(t => /two-pages-p\d/.test(t)).length;
    check(pdfEntries === 2, `both PDF pages are accounted for, in the ZIP or held back (${pdfEntries})`);
    // the receipt made in batch mode says no person looked it over
    const batchNote = await page.evaluate(async () => { window.__DSC.batch = true; try { return (await window.__DSC.test.receiptFacts()).rows.find(r => r[0] === 'Reviewed')[1]; } finally { window.__DSC.batch = false; } });
    check(/batch mode/.test(batchNote) && /no person/.test(batchNote), 'a batch receipt says no person looked the image over');
    await page.keyboard.press('Escape');
  }

  console.log('Visual fingerprint warning');
  {
    await page.goto(base);
    const fp = await page.evaluate(() => {
      const S = window.__DSC, run = draw => {
        const c = document.createElement('canvas'); c.width = 1200; c.height = 700; const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 700); draw(x);
        S.img = c; S.words = []; S.masks = []; return S.test.detectFingerprint();
      };
      const charts = run(x => { const hues = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728']; for (let i = 0; i < 24; i++) { x.fillStyle = hues[i % 4]; x.fillRect(40 + i * 46, 260 + (i * 37) % 300, 34, 700); } });
      const logo = run(x => { x.fillStyle = '#c8102e'; x.beginPath(); x.arc(70, 45, 30, 0, Math.PI * 2); x.fill(); });
      const header = run(x => { x.fillStyle = '#0a5c36'; x.fillRect(0, 0, 1200, 70); });
      S.img = null; return { charts, logo, header };
    });
    check(fp.charts.length === 0, `colourful charts below the header do not raise the warning (${fp.charts.join(', ') || 'none'})`);
    check(fp.logo.some(t => /logo/.test(t)), 'a coloured logo left in a top corner raises the warning');
    check(fp.header.some(t => /brand colours/.test(t)), 'a header in a strong brand colour raises the warning');
    check(await page.locator('#shape-note').count() === 1, 'the review screen says chart shapes are not hidden');
  }

  console.log('Start screen');
  await page.goto(base);
  await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  check(await page.locator('#drop-err').isVisible() && /PNG, JPG or WebP/.test(await page.locator('#drop-err').textContent()), 'a file that is not an image gets an inline message, not a pop-up');
  check(/image\/webp/.test(await page.getAttribute('#file', 'accept')), 'WebP screenshots are accepted');
  await page.evaluate(() => { window.__DSC.sessionAllow.add('kestrelmoor'); });
  await page.click('#btn-try'); await page.locator('#samples .sample button').nth(0).click();
  await page.waitForFunction(() => !document.getElementById('s-review').hidden);
  check(await page.evaluate(() => window.__DSC.sessionAllow.size === 0), '"Safe to keep" choices do not carry over to the next screenshot');
  await page.setViewportSize({ width: 375, height: 800 });
  check(await page.locator('header .pill').isHidden(), 'the header stays on one line on a phone');

  check(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
  check(cspBlocked.length === 0, 'the app runs within its Content-Security-Policy (nothing blocked)' + (cspBlocked.length ? ': ' + cspBlocked.slice(0, 3).join(' | ') : ''));
  const unexpected = offsite.filter(u => !/^https:\/\/api\.anthropic\.com\/v1\/messages$/.test(u));   // only the blocked attempt above
  check(unexpected.length === 0, `across the whole run the app requested nothing outside its own site, ${unexpected.length ? ': ' + [...new Set(unexpected)].slice(0, 5).join(', ') : ''}`);
} catch (e) {
  failures++; console.log('  ✗ ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll end-to-end checks passed.');
process.exit(failures ? 1 : 0);
