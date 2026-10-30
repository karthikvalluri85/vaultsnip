// End-to-end test of the in-place replica: serves web/, runs the bundled sample in headless Chromium, builds the replica on
// the device and with a mocked AI provider, and checks that it is the original picture except inside the replaced boxes.
// Usage: node tests/e2e/inplace.e2e.mjs   (set PW_CHROMIUM to use a preinstalled browser; SHOT=path saves a screenshot)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css' };
const HEADERS = Object.fromEntries((await readFile(join(web, '_headers'), 'utf8')).split(/\r?\n/).filter(l => /^\s+[\w-]+:/.test(l)).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
const server = createServer(async (req, res) => {
  const file = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  try { const body = await readFile(join(web, file)); res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
const cspBlocked = []; page.on('console', m => { if (/Content Security Policy|Refused to (load|connect|execute|create|apply)/i.test(m.text())) cspBlocked.push(m.text().slice(0, 200)); });

// Compares the replica with the original, pixel by pixel: every pixel outside the replaced boxes must be unchanged.
const compare = () => page.evaluate(() => {
  const S = window.__DSC, W = S.img.width, H = S.img.height;
  const a = S.img.getContext('2d').getImageData(0, 0, W, H).data, b = S.fid.canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const inBox = new Uint8Array(W * H);
  S.fid.patches.forEach(p => { for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(H, Math.ceil(p.y + p.h)); y++) for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(W, Math.ceil(p.x + p.w)); x++) inBox[y * W + x] = 1; });
  let outside = 0, changed = 0, grey = 0, boxPx = 0;
  for (let i = 0; i < W * H; i++) {
    const d = a[i * 4] !== b[i * 4] || a[i * 4 + 1] !== b[i * 4 + 1] || a[i * 4 + 2] !== b[i * 4 + 2];
    if (!inBox[i]) { if (d) outside++; continue; }
    boxPx++; if (d) changed++;
    if (b[i * 4] === 120 && b[i * 4 + 1] === 124 && b[i * 4 + 2] === 130) grey++;    // the old solid-grey mask colour
  }
  return { size: S.fid.canvas.width === W && S.fid.canvas.height === H, outside, changed, boxPx, grey, patches: S.fid.patches.length };
});

try {
  await page.goto(base);
  check(await page.evaluate(() => !window.echarts && !window.DSCReplica && !!window.VSInpaint && !!window.VSSynth), 'the app loads the in-place engine and no chart-rebuilding code');

  console.log('Sample: masks, then the in-place replica built on this device');
  await page.click('#btn-try');
  await page.locator('#samples .sample button').nth(0).click();
  await page.waitForFunction(() => { const g = document.querySelector('.gate'); return g && /Blocked|Review|Pass/.test(g.textContent) && !/Checking/.test(g.textContent); }, null, { timeout: 180000 });
  await page.evaluate(() => { const T = window.__DSC.test; T.hideUncertain(); });
  await page.evaluate(() => document.getElementById('btn-send').onclick());
  check(await page.locator('#btn-local').isDisabled(), 'nothing is built before "I have looked over the masked image" is ticked');
  await page.check('#pf-ok');
  await page.click('#btn-local');
  await page.waitForFunction(() => !document.getElementById('s-replica').hidden && document.querySelector('#replica canvas.ip-canvas'));
  const c1 = await compare();
  check(c1.size, 'the replica is the size of the original');
  check(c1.outside === 0, `zero distortion: every pixel outside the replaced boxes is the original's (${c1.outside} differ)`);
  check(c1.patches > 20 && c1.changed > 0, `${c1.patches} boxes replaced in place`);
  check(c1.grey === 0, 'no solid-grey redaction blocks');
  check(await page.evaluate(() => document.querySelectorAll('#replica .rp-chart, #replica [_echarts_instance_], #replica .rp-grid').length) === 0, 'no chart or grid is rebuilt over the picture');
  const synth = await page.evaluate(() => window.__DSC.fid.patches.filter(p => p.kind === 'number' && p.synthetic).map(p => [p.original, p.synthetic]));
  // across many seeds, no number is ever left as it was
  const kept = await page.evaluate(() => { const S = window.__DSC, out = []; for (let seed = 1000; seed < 1300; seed++) { const t = VSSynth.tokens(S.masks.filter(m => m.on), S.words), f = VSSynth.local(t, { fakeValue: S.test.fakeValue, axisFactors: S.test.axisFactors }, seed); t.forEach(x => { if (x.kind === 'number' && f.get(x.id).synthetic === x.original) out.push(x.original); }); } return out; });
  check(kept.length === 0, `no number keeps its real value, over 300 seeds${kept.length ? ' (' + kept.slice(0, 5).join(', ') + ')' : ''}`);
  check(synth.length > 5 && synth.every(([o, s]) => o !== s), `numbers become different synthetic values (${synth.slice(0, 3).map(x => x[1]).join(', ')}…)`);

  // axes stay on one even scale: a stray figure beside a tick, a tick kept apart by its odd size, and a zero
  const axis = await page.evaluate(() => {
    const T = window.__DSC.test, M = [['800,000-', 52, 503, 69, 21], ['600,000-', 52, 547, 69, 21], ['2 400,000-', 32, 581, 91, 34.6], ['200,000-', 52, 634, 69, 20], ['0-', 101, 678, 21, 18], ['2', 111, 733, 21, 19]]
      .map(([text, x, y, w, h]) => ({ text, x, y, w, h })), a = T.axisFactors(M);
    return { v: M.map(m => a.get(m)), zero: T.fakeValue('0-', 9, 0) };
  });
  const [v8, v6, v4, v2, v0, stray] = axis.v;
  check(v8 > 0 && Math.abs((v8 - v6) - (v6 - v4)) <= 2 && Math.abs((v4 - v2) - (v2 - v0)) <= 2 && v0 === 0 && stray === undefined && v8 !== 800000,
    `an axis keeps one even scale, its zero and a tick with a stray digit beside it (${axis.v.join(', ')})`);
  check(axis.zero === '0-', 'an axis zero stays 0');

  console.log('Overlay');
  const spots = await page.evaluate(() => document.querySelectorAll('#replica .ip-spot').length);
  check(spots === c1.patches, `one hotspot per replaced box (${spots})`);
  // each hotspot sits on its box at the displayed size
  const align = await page.evaluate(() => {
    const S = window.__DSC, cv = document.querySelector('#replica canvas').getBoundingClientRect(), k = cv.width / S.img.width;
    return Math.max(...[...document.querySelectorAll('#replica .ip-spot')].map(el => {
      const r = el.getBoundingClientRect(), p = S.fid.patches[+el.dataset.i];
      return Math.max(Math.abs(r.left - cv.left - p.x * k), Math.abs(r.top - cv.top - p.y * k), Math.abs(r.width - p.w * k));
    }));
  });
  check(align < 1.5, `hotspots line up with their pixels (worst ${align.toFixed(2)} px)`);
  await page.setViewportSize({ width: 700, height: 900 });
  const align2 = await page.evaluate(() => {
    const S = window.__DSC, cv = document.querySelector('#replica canvas').getBoundingClientRect(), k = cv.width / S.img.width;
    const el = document.querySelector('#replica .ip-spot'), r = el.getBoundingClientRect(), p = S.fid.patches[+el.dataset.i];
    return { off: Math.abs(r.left - cv.left - p.x * k) + Math.abs(r.top - cv.top - p.y * k), ratio: cv.width / cv.height, want: S.img.width / S.img.height, wide: document.documentElement.scrollWidth <= 700 };
  });
  check(align2.off < 2 && Math.abs(align2.ratio - align2.want) < 0.01 && align2.wide, 'at phone width the picture scales without distortion and the hotspots follow');
  await page.setViewportSize({ width: 1400, height: 1000 });
  const num = await page.evaluate(() => window.__DSC.fid.patches.findIndex(p => p.kind === 'number' && p.synthetic));
  await page.hover(`#replica .ip-spot[data-i="${num}"]`);
  const tip = await page.evaluate(i => ({ text: document.querySelector('#replica .ip-tip').textContent, shown: !document.querySelector('#replica .ip-tip').hidden, p: window.__DSC.fid.patches[i] }), num);
  check(tip.shown && tip.text.includes(tip.p.synthetic) && /made on this device/.test(tip.text), `hovering a replaced value explains it ("${tip.text.slice(0, 60)}…")`);
  check(!tip.text.includes(tip.p.original), 'the tooltip never shows the hidden text');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  console.log('Download');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-replica')]);
  check(dl.suggestedFilename() === 'sample-replica-synthetic.png', `the replica downloads as a PNG (${dl.suggestedFilename()})`);

  console.log('AI-written replacements (mocked Claude)');
  const seen = {};
  await page.route('https://api.anthropic.com/v1/messages', r => {
    const body = r.request().postDataJSON(); seen.body = body;
    const req = JSON.parse(body.messages[0].content.find(c => c.type === 'text').text);
    // a well-behaved answer: the same shape with other digits; a name for everything else
    const replacements = req.tokens.map(t => ({ id: t.id, synthetic: t.kind === 'number' ? t.shape.replace(/9/g, '4') : 'Northwind', note: 'mock' }));
    return r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ replacements }) }] } });
  });
  await page.evaluate(() => { const S = window.__DSC; S.sample = null; S.key = 'sk-ant-TESTKEY000000000000'; S.provider = 'anthropic'; document.getElementById('btn-send').onclick(); document.getElementById('pf-ok').click(); });
  await page.click('#btn-confirm');
  await page.waitForFunction(() => !document.getElementById('dlg-send').open && window.__DSC.fid && window.__DSC.fid.ai);
  // what is sent beside the image is exactly what the send dialog showed
  const text = seen.body ? seen.body.messages[0].content.find(c => c.type === 'text').text : '';
  const shown = await page.evaluate(() => document.getElementById('pf-req-json').textContent);
  check(!!seen.body && JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(shown)), 'the request is exactly the JSON shown in the send dialog');
  check(!!seen.body && seen.body.messages.length === 1 && seen.body.messages[0].content.length === 2, 'only the approved image and that JSON are sent');
  // no hidden text in it: an original may appear only where the same words are visible in the approved image
  const leak = await page.evaluate(sentText => {
    const S = window.__DSC, on = S.masks.filter(m => m.on);
    const covered = w => on.some(m => w.x + w.w / 2 > m.x && w.x + w.w / 2 < m.x + m.w && w.y + w.h / 2 > m.y && w.y + w.h / 2 < m.y + m.h);
    const visible = S.words.filter(w => !covered(w)).map(w => w.text).join(' ');
    const originals = on.map(m => (m.text || '').trim()).filter(o => o.length >= 3 && o !== '(table column)');
    return { n: originals.length, leaked: originals.filter(o => sentText.includes(o) && !visible.includes(o)) };
  }, text);
  check(!!seen.body && leak.n > 20 && leak.leaked.length === 0, `the request carries no hidden text (${leak.n} hidden texts checked${leak.leaked.length ? '; leaked: ' + leak.leaked.slice(0, 3).join(', ') : ''})`);
  check(!!seen.body && JSON.parse(text).tokens.every(t => t.kind === 'number' ? !('chars' in t) && /^[^A-Za-z]*9[\s\S]*$/.test(t.shape) : !('shape' in t) && Number.isInteger(t.chars)), 'names and labels go as a length only; numbers as a pattern of 9s');
  check(!!seen.body && /contextual data generator/i.test(seen.body.system), 'the provider is asked as a contextual data generator');
  const ai = await page.evaluate(() => window.__DSC.fid.patches.filter(p => p.source === 'ai').length);
  check(ai > 5, `AI answers that fit the shape are used (${ai})`);
  const c2 = await compare();
  check(c2.outside === 0, 'with AI text too, nothing outside the replaced boxes changes');

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
  check(cspBlocked.length === 0, `nothing blocked by the Content-Security-Policy${cspBlocked.length ? ': ' + cspBlocked.join(' | ') : ''}`);
} catch (e) {
  failures++; console.log('  ✗ ' + (e.message || e).split('\n')[0] + (pageErrors.length ? ' | page errors: ' + pageErrors.join(' | ') : ''));
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll in-place checks passed.');
process.exit(failures ? 1 : 0);
