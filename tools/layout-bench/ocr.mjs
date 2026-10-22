// Runs VaultSnip's own review step (review.mjs) on every benchmark image and saves what the on-device builder receives
// (developer tool): run/<id>.ocr.json = { width, height, words: [{ text, x, y, w, h, kept }], masks: [{ x, y, w, h }],
// gate, findings: [{ type, severity, x, y, w, h }], ms }. Masked words carry no text. Run fetch.mjs first.
//   node tools/layout-bench/ocr.mjs [bench dir, default .bench] [--only id,id]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_BENCH, items } from './items.mjs';
import { reviewer } from './review.mjs';

const args = process.argv.slice(2);
const bench = (args[0] && !args[0].startsWith('--')) ? args[0] : DEFAULT_BENCH;
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const todo = items(bench).filter((it) => !only || only.has(it.id));

await mkdir(join(bench, 'run'), { recursive: true });
const app = await reviewer();
try {
  for (const it of todo) {
    const out = await app.read(it.file);
    await writeFile(it.ocr, JSON.stringify(out));
    console.log(`  ✓ ${it.id}: ${out.words.length} words (${out.words.filter((w) => w.kept).length} readable), ${out.masks.length} masks, check ${out.gate} (${out.findings.length} to resolve), ${(out.ms / 1000).toFixed(1)} s`);
  }
} finally {
  await app.close();
}
