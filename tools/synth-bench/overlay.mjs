// Draws a generated dashboard's truth over its image, to check it by eye (developer tool): red = sensitive word,
// green = safe word, blue = panel; with its <id>.review.json beside it, also VaultSnip's masks (yellow fill) and the
// pre-flight check's findings (magenta).
//   node tools/synth-bench/overlay.mjs <dir>/<id>.truth.json [out.png]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const file = process.argv[2], truth = JSON.parse(await readFile(file, 'utf8'));
const img = (await readFile(join(dirname(file), truth.file))).toString('base64');
const review = await readFile(file.replace(/\.truth\.json$/, '.review.json'), 'utf8').then(JSON.parse, () => null);
const out = process.argv[3] || file.replace(/\.truth\.json$/, '.overlay.png');
const browser = await chromium.launch();
const page = await browser.newPage();
const png = await page.evaluate(async ({ img, truth, review, mime }) => {
  const im = new Image(); im.src = `data:${mime};base64,` + img; await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0); x.lineWidth = 2;
  if (review) {
    const k = truth.width / review.width;                       // the review is in the app's working pixels
    x.fillStyle = 'rgba(255, 210, 0, 0.45)'; review.masks.forEach((m) => x.fillRect(m.x * k, m.y * k, m.w * k, m.h * k));
    x.strokeStyle = '#ff00ff'; review.findings.forEach((m) => x.strokeRect(m.x * k, m.y * k, m.w * k, m.h * k));
  }
  truth.panels.forEach((p) => { x.strokeStyle = '#2f6fff'; x.strokeRect(p.box[0], p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]); });
  truth.words.forEach((w) => { x.strokeStyle = w.sensitive ? '#ff2020' : '#10b040'; x.strokeRect(w.x, w.y, w.w, w.h); });
  return c.toDataURL('image/png').split(',')[1];
}, { img, truth, review, mime: truth.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });
await writeFile(out, Buffer.from(png, 'base64'));
await browser.close();
console.log(out);
