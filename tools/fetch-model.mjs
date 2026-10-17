// Downloads the contextual-fallback NER model (Feature 2) into public/models/, pinned to one revision
// and checked against SHA-256 hashes. Run once: npm run fetch:model
//
// Model: onnx-community/TinyBERT-finetuned-NER-ONNX (int8, 14.5 MB), an ONNX export of
// adel-cybral/TinyBERT-finetuned-NER (CoNLL-2003, F1 0.858 on validation).
// LICENSE: none of the model repos declares a license. public/models/ is not committed and build.sh
// does not package it. Do not ship the model in a release until its licensing is settled.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'onnx-community/TinyBERT-finetuned-NER-ONNX';
const REVISION = '9b03777d9832105fbe419f258127fb2ec3eb09d7';
const FILES = {
  'config.json': 'ce496c6364ef1274d4def03a1015d6cab33fa5fd77fe9ea1c3ff945b6b61966d',
  'tokenizer.json': 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66',
  'tokenizer_config.json': 'e711904cac23112776b678356ccf702cf934babaa01125f698ac43bf9ad38e73',
  'onnx/model_quantized.onnx': 'ba4a1a00cf1600cae8e7cf3fda4650c825811719065b51041256392edd3647b8',
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'tinybert-ner');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const [file, want] of Object.entries(FILES)) {
  const dest = join(out, file);
  try {
    if (sha256(await readFile(dest)) === want) { console.log(`  ✓ ${file} (already present)`); continue; }
  } catch { /* not downloaded yet */ }
  const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`${file}: SHA-256 mismatch (got ${got}, want ${want})`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  ✓ ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
console.log(`Model ready in ${out}`);
console.log('Note: the model has no declared license. Do not ship it in a release package yet.');
