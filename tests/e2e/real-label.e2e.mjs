// The private labeller (tools/real-bench/label.mjs): boxes drawn on a screenshot are saved beside it in the masking
// benchmark's format, and the server reads and writes nothing outside its folder.
//   node tests/e2e/real-label.e2e.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) { failures++; if (process.env.GITHUB_ACTIONS) console.log(`::error title=Labeller::${msg}`); } };

const dir = await mkdtemp(join(tmpdir(), 'vs-real-'));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
// a plain 400×200 picture to label
const pic = await (await browser.newPage()).evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 200); x.fillStyle = '#000'; x.font = '20px sans-serif'; x.fillText('Jane Doe 4,200', 20, 60); return c.toDataURL('image/png').split(',')[1]; });
await writeFile(join(dir, 'shot one.png'), Buffer.from(pic, 'base64'));
const port = 8700 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, [join(ROOT, 'tools/real-bench/label.mjs'), '--dir', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.once('data', r));
const base = `http://127.0.0.1:${port}/`;
try {
  console.log('Labeller');
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('cv').width === 400);
  const r = await page.locator('#cv').boundingBox(), k = r.width / 400;
  const box = async (x0, y0, x1, y1) => { await page.mouse.move(r.x + x0 * k, r.y + y0 * k); await page.mouse.down(); await page.mouse.move(r.x + x1 * k, r.y + y1 * k, { steps: 4 }); await page.mouse.up(); };
  await page.keyboard.press('1'); await box(18, 40, 110, 66);          // a person's name
  await page.keyboard.press('3'); await box(112, 40, 170, 66);         // a number
  await page.keyboard.press('9'); await box(200, 120, 260, 140);       // a safe label
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /3 boxes saved/.test(document.getElementById('msg').textContent));
  const t = JSON.parse(await readFile(join(dir, 'shot one.truth.json'), 'utf8'));
  check(t.file === 'shot one.png' && t.width === 400 && t.words.length === 3, `the boxes are saved beside the screenshot (${t.words.length})`);
  check(t.words[0].kind === 'name' && t.words[0].sensitive && t.words[1].kind === 'number' && t.words[2].sensitive === false,
    `each box keeps its kind; a safe label is marked not sensitive (${t.words.map(w => w.kind + (w.sensitive ? '*' : '')).join(', ')})`);
  check(Math.abs(t.words[0].x - 18) <= 2 && Math.abs(t.words[0].w - 92) <= 3, `boxes are in the screenshot's own pixels (${t.words[0].x}, ${t.words[0].w})`);
  // nothing outside the folder
  const escape = await fetch(base + 'img/..%2F..%2Fetc%2Fpasswd').then(r => r.status);
  const write = await fetch(base + 'api/save', { method: 'POST', body: JSON.stringify({ file: '../evil.png', width: 1, height: 1, words: [] }) }).then(r => r.status);
  check(escape === 404 && write === 400, `the server reads and writes only inside its folder (${escape}, ${write})`);
  const other = await fetch(`http://127.0.0.1:${port}/api/list`).then(r => r.json());
  check(other.length === 1 && other[0].boxes === 3, 'the list shows the labelled screenshot');
} catch (e) { failures++; console.log('  ✗ ' + e.message); }
finally { await browser.close(); server.kill(); await rm(dir, { recursive: true, force: true }); }
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll labeller checks passed.');
process.exit(failures ? 1 : 0);
