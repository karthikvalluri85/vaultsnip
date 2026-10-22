// Drives VaultSnip's own review step in headless Chromium, as a user would (developer tool, shared by the benchmarks):
// the app is served from web/, an image is dropped in, read on the device, masked by the current policy and checked.
// Returns what the on-device builder receives (the app's layoutInput(): masked words carry no text), the masks, and the
// pre-flight check's findings as kind, severity and box, without their text: that text is what the masks should have
// covered. Boxes are in the app's working pixels: width × height, which may be smaller than the file.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './items.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.css': 'text/css' };

/** Starts the app and a browser; read(file) reviews one image in a fresh page; close() stops both. */
export async function reviewer() {
  const web = join(ROOT, 'web');
  const server = createServer(async (req, res) => {
    const file = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
    try { const body = await readFile(join(web, file)); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  async function read(file) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });   // a fresh app for every image
    try {
      await page.goto(base);
      const t0 = Date.now();
      await page.setInputFiles('#file', file);
      // polled by time: animation frames can stop in a headless page
      await page.waitForFunction(() => /Check (passed|found)/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 300000, polling: 1000 });
      const out = await page.evaluate(() => {
        const S = window.__DSC, input = S.test.layoutInput();
        return { width: input.image.width, height: input.image.height, words: input.words, masks: input.masks, gate: S.gate,
          findings: S.flags.map((f) => ({ type: f.type, severity: f.severity, x: f.x, y: f.y, w: f.w, h: f.h })) };
      });
      out.ms = Date.now() - t0;
      return out;
    } finally {
      await page.close();
    }
  }
  return { read, close: async () => { await browser.close(); server.close(); } };
}
