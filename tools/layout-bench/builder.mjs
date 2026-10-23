// Runs the on-device layout builder (web/lib/vs-layout.js) in Chromium exactly as the app does, and scores what it
// finds against annotated visuals (developer tool, shared by the real-world and the generated benchmark).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './items.mjs';

/** Starts a page with the builder; build(imageFile, review) returns its result with panel boxes in the file's pixels. */
export async function layoutBuilder(opts = {}) {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: await readFile(join(ROOT, 'web', 'lib', 'vs-layout.js'), 'utf8') });
  await page.evaluate((o) => Object.assign(self.VSLayout.PANEL_OPTS, o), opts);

  /** As app.js does: the image at the review's size, the masks drawn in the app's grey, masked words without text. */
  async function build(file, review) {
    const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
    const img = (await readFile(file)).toString('base64');
    const r = await page.evaluate(async ({ img, mime, review }) => {
      const im = new Image(); im.src = `data:${mime};base64,` + img; await im.decode();
      const c = document.createElement('canvas'); c.width = review.width; c.height = review.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
      x.fillStyle = '#787c82'; (review.masks || []).forEach((m) => x.fillRect(m.x, m.y, m.w, m.h));
      const d = x.getImageData(0, 0, c.width, c.height);
      const words = review.words.map((w) => ({ text: w.kept ? w.text : '', x: w.x, y: w.y, w: w.w, h: w.h, kept: w.kept }));
      const out = self.VSLayout.buildSpec({ image: { data: d.data, width: d.width, height: d.height, channels: 4 }, words, masks: review.masks || [] });
      return { ...out, fileWidth: im.width };
    }, { img, mime, review });
    // panel boxes back in the original image's pixels, where the annotations are
    const k = r.fileWidth / review.width;
    r.panels = r.panels.map((p) => ({ ...p, box: p.box.map((v) => v * k) }));
    r.imageArea = r.fileWidth * (r.fileWidth * review.height / review.width);
    return r;
  }
  return { build, close: () => browser.close() };
}

export const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
export const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const ALIAS = { donut: 'pie', bubble: 'scatter' };
const LENIENT = { combo: ['column', 'line', 'bar'], area: ['area', 'line'], line: ['line', 'area'], waterfall: ['column'] };
/** Whether a found type matches an annotated one; lenient accepts close cousins (line and area, combo and column). */
export const same = (got, want, lenient) => { got = ALIAS[got] || got; return got === want || (lenient && (LENIENT[want] || []).includes(got)); };

/**
 * Matches panels to annotated visuals: a visual is found when a panel's centre is inside it and its centre inside the
 * panel. Panels inside an `ignore` box (page headers, filters) count neither way.
 */
export function scorePage(panels, visuals, ignore = []) {
  const counted = panels.filter((p) => !ignore.some((g) => inside(center(p.box), g)));
  const truths = visuals.map((v) => ({ ...v, hit: null }));
  for (const p of counted) { const t = truths.find((t) => !t.hit && inside(center(p.box), t.bbox) && inside(center(t.bbox), p.box)); if (t) t.hit = p; }
  const hits = truths.filter((t) => t.hit);
  return {
    counted, truths, hits,
    strict: hits.filter((t) => same(t.hit.type, t.type, false)).length,
    lenient: hits.filter((t) => same(t.hit.type, t.type, true)).length,
  };
}
