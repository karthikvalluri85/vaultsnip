// Zero-shot chart-type classification of dashboard panels with SigLIP / CLIP (developer tool; nothing ships).
// Each visual is cropped (boxes from truth.json) and scored against BI-specific descriptions; no training, no prompt-following.
//
//   node tools/eval-vision/zeroshot.mjs [image] [--truth truth.json] [--models siglip,clip]
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const imagePath = resolve(args[0] && !args[0].startsWith('--') ? args[0] : join(here, 'masked-dashboard.png'));
const truth = JSON.parse(await readFile(flag('truth', join(here, 'truth.json')), 'utf8'));

// One description per VaultSnip visual type, phrased the way such panels look in BI tools.
export const LABELS = {
  kpi: 'a KPI card on a dashboard showing one large number with a small label',
  column: 'a column chart with vertical bars',
  bar: 'a horizontal bar chart',
  line: 'a line chart with a line over time',
  pie: 'a pie or donut chart',
  table: 'a data table with rows and columns of text',
  map: 'a map with shaded regions',
  scatter: 'a scatter plot of dots',
  text: 'a paragraph of text',
};

const MODELS = {
  siglip: { id: 'Xenova/siglip-base-patch16-224', dtype: 'quantized', template: 'This is a photo of {}.' },
  clip: { id: 'Xenova/clip-vit-base-patch32', dtype: 'quantized', template: 'a screenshot of {}' },
};

const full = await RawImage.read(imagePath);
const px = (b) => [Math.round(b[0] / 1000 * full.width), Math.round(b[1] / 1000 * full.height), Math.round(b[2] / 1000 * full.width), Math.round(b[3] / 1000 * full.height)];
const crops = await Promise.all(truth.visuals.map((v) => full.crop(px(v.bbox))));
const names = Object.keys(LABELS), texts = Object.values(LABELS);

for (const key of flag('models', 'siglip,clip').split(',')) {
  const m = MODELS[key];
  const t0 = Date.now();
  const classify = await pipeline('zero-shot-image-classification', m.id, { dtype: m.dtype, device: 'cpu' });
  let hits = 0;
  console.log(`\n=== ${key} (${m.id}, ${m.dtype})`);
  for (const [i, v] of truth.visuals.entries()) {
    const out = await classify(crops[i], texts, { hypothesis_template: m.template });
    const got = names[texts.indexOf(out[0].label)];
    const ok = got === v.type; if (ok) hits++;
    console.log(`  ${ok ? '✓' : '✗'} ${v.title.padEnd(24)} want ${v.type.padEnd(7)} got ${got.padEnd(7)} (${(out[0].score * 100).toFixed(0)}%; next ${names[texts.indexOf(out[1].label)]})`);
  }
  console.log(`  ${hits}/${truth.visuals.length} correct in ${((Date.now() - t0) / 1000).toFixed(1)} s (first run includes the download)`);
}
