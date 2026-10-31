// End-to-end test of the in-place replica: serves web/, runs the bundled sample in headless Chromium, builds the replica on
// the device, and checks that it is the original picture except inside the replaced boxes, and that nothing is sent.
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
const offsite = []; page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob|about):/.test(u)) offsite.push(u); });
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
  check(await page.locator('#btn-confirm').isDisabled(), 'nothing is built before "I have looked over the masked image" is ticked');
  await page.check('#pf-ok');
  await page.click('#btn-confirm');
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
  // an axis from 0 to 9,000, left-aligned, some ticks read with their tick mark (wider): one even scale for all of it
  const wide = await page.evaluate(() => {
    const T = window.__DSC.test, vals = [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 0];
    const M = vals.map((v, i) => { const t = v.toLocaleString('en-US') + (i % 3 === 0 ? '-' : ''); return { text: t, x: 48, y: 800 + i * 35, w: t.length * 7, h: i % 3 === 0 ? 22 : 16 }; });
    const a = T.axisFactors(M);
    return M.map(m => a.get(m));
  });
  const wsteps = wide.slice(1).map((v, i) => wide[i] - v);
  check(wide.every(v => typeof v === 'number') && wide[9] === 0 && wsteps.every(d => d === wsteps[0] && d > 0) && wide[0] !== 9000, `an axis from 0 to 9,000 with ticks of mixed widths keeps one even scale (${wide.join(', ')})`);
  // ticks the reader joined into one box stay one even scale starting at 0
  const joined = await page.evaluate(() => window.__DSC.test.fakeValue('0 20 40 60 80 100 120 140 160 180 200', 11).split(' ').map(Number));
  const step = joined[1] - joined[0];
  const long = await page.evaluate(() => [window.__DSC.test.fakeValue('6000000000000000000000000', 3), window.__DSC.test.fakeValue('0 100000000000000000 200000000000000000 300000000000000000', 4)]);
  check(long.every(v => !/e[+-]\d/.test(v)) && long[0].length === 25, `very long numbers get new digits, never exponent notation (${long[0]})`);
  check(joined.length === 11 && joined[0] === 0 && step > 0 && step !== 20 && joined.every((v, i) => v === i * step), `joined axis ticks stay one even scale (${joined.join(' ')})`);

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

  console.log('Blurred chart');
  // an area the user blurs is the one other place the replica may differ from the original
  {
    await page.evaluate(() => { const S = window.__DSC; S.blurs = [{ x: 40, y: 340, w: 720, h: 270 }]; S.test.buildInPlace(false); });
    const cb = await compare();
    const inBlur = await page.evaluate(() => {
      const S = window.__DSC, b = S.blurs[0], p = S.fid.patches.find(q => q.kind === 'blur');
      const d = S.fid.canvas.getContext('2d').getImageData(b.x, b.y, b.w, b.h).data; let lo = 765, hi = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return { patch: !!p, range: hi - lo, under: S.fid.patches.filter(q => q.kind !== 'blur' && q.x + q.w / 2 > b.x && q.x + q.w / 2 < b.x + b.w && q.y + q.h / 2 > b.y && q.y + q.h / 2 < b.y + b.h).length };
    });
    check(cb.outside === 0, `with a chart blurred, every pixel outside the replaced boxes and the blurred area is the original's (${cb.outside} differ)`);
    check(inBlur.patch && inBlur.range < 120, `the blurred area keeps no readable shape (light-to-dark range ${inBlur.range})`);
    check(inBlur.under === 0, 'no synthetic text is drawn over a blurred area');
    await page.evaluate(() => { window.__DSC.blurs = []; window.__DSC.test.buildInPlace(false); });
    // "Blur all charts": the replica differs only in the replaced boxes and the areas it found
    const nAll = await page.evaluate(() => { const S = window.__DSC; S.blurs = []; const n = S.test.blurAllCharts(); S.test.buildInPlace(false); return n; });
    const ca = await compare();
    check(nAll >= 1 && ca.outside === 0, `with every chart blurred (${nAll}), every pixel outside the replaced boxes and the blurred areas is the original's (${ca.outside} differ)`);
    await page.evaluate(() => { window.__DSC.blurs = []; window.__DSC.test.buildInPlace(false); });
  }

  console.log('Download');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-replica')]);
  check(dl.suggestedFilename() === 'sample-replica-synthetic.png', `the replica downloads as a PNG (${dl.suggestedFilename()})`);

  console.log('Nothing leaves the device');
  check(offsite.length === 0, `no request went anywhere but this page's own site${offsite.length ? ': ' + offsite.slice(0, 3).join(', ') : ''}`);
  check(await page.evaluate(() => typeof window.VSLLM === 'undefined' && !document.getElementById('btn-key')), 'there is no AI key setting and no AI code');

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
  check(cspBlocked.length === 0, `nothing blocked by the Content-Security-Policy${cspBlocked.length ? ': ' + cspBlocked.join(' | ') : ''}`);
} catch (e) {
  failures++; console.log('  ✗ ' + (e.message || e).split('\n')[0] + (pageErrors.length ? ' | page errors: ' + pageErrors.join(' | ') : ''));
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll in-place checks passed.');
process.exit(failures ? 1 : 0);
