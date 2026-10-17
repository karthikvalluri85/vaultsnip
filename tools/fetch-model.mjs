// The contextual PII check's model (Feature 2), pinned to one revision and checked against SHA-256 hashes.
//   npm run fetch:model             download into web/models/pii-bert-small (weights gzipped; committed)
//   npm run fetch:model -- --check  verify the committed files offline
//
// Model: gravitee-io/bert-small-pii-detection, int8 ONNX (28.7 MB; 19.5 MB gzipped), Apache-2.0.
// Base model prajjwal1/bert-small (MIT); training data gravitee-io/pii-detection-dataset (Apache-2.0,
// built from MIT/Apache-2.0 sources, mostly synthetic). Attribution: THIRD_PARTY_NOTICES.md.
// The weights are gzipped because the web app's host refuses single files over 25 MiB.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync, constants } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'gravitee-io/bert-small-pii-detection';
const REVISION = 'f8c27a85c51c0168f07b9dcf00265bf0a4097939';
// [file in the repo, where transformers.js looks for it, SHA-256 of the original]
export const FILES = [
  ['config.json', 'config.json', '6757df1ae2ec9ca16cef63009af337a66573d06c721d03c7820590f69eefa6c8'],
  ['tokenizer.json', 'tokenizer.json', 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'],
  ['tokenizer_config.json', 'tokenizer_config.json', '01a629a4923673b9a7a6d7da214952152c87c7ab3e002aae8e1e025486942163'],
  ['model.quant.onnx', 'onnx/model_quantized.onnx', 'b227845ff4989c9f7383874b841895dfbdb9a4d7a20ceb39c3f187271894bf2a'],
];

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'models', 'pii-bert-small');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const zipped = (local) => local.endsWith('.onnx');
const stored = (local) => join(out, local + (zipped(local) ? '.gz' : ''));
// Fixed header, so the same model always gives the same .gz (clean diffs, reproducible builds).
const gzip = (buf) => gzipSync(buf, { level: constants.Z_BEST_COMPRESSION });

async function original(local) {
  const buf = await readFile(stored(local));
  return zipped(local) ? gunzipSync(buf) : buf;
}

if (process.argv.includes('--check')) {
  let bad = 0;
  for (const [, local, want] of FILES) {
    let ok = false;
    try { ok = sha256(await original(local)) === want; } catch { /* missing */ }
    console.log(`  ${ok ? '✓' : '✗'} ${local}`);
    if (!ok) bad++;
  }
  if (bad) { console.error('Model files missing or changed: run npm run fetch:model'); process.exit(1); }
  console.log('Model files match the pinned revision.');
  process.exit(0);
}

for (const [file, local, want] of FILES) {
  try {
    if (sha256(await original(local)) === want) { console.log(`  ✓ ${local} (already present)`); continue; }
  } catch { /* not downloaded yet */ }
  const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`${file}: SHA-256 mismatch (got ${got}, want ${want})`);
  await mkdir(dirname(stored(local)), { recursive: true });
  const data = zipped(local) ? gzip(buf) : buf;
  await writeFile(stored(local), data);
  console.log(`  ✓ ${local}${zipped(local) ? '.gz' : ''} (${(data.length / 1e6).toFixed(1)} MB)`);
}
console.log(`Model ready in ${out}`);
