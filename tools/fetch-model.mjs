// The on-device models, each pinned to one revision and checked against SHA-256 hashes.
//   npm run fetch:model             download into web/models/<folder> (weights gzipped; committed)
//   npm run fetch:model -- --check  verify the committed files offline
//
// 1. Name check (Feature 2): gravitee-io/bert-small-pii-detection, int8 ONNX (28.7 MB; 19.5 MB gzipped), Apache-2.0.
//    Base model prajjwal1/bert-small (MIT); training data gravitee-io/pii-detection-dataset (Apache-2.0, built from
//    MIT/Apache-2.0 sources, mostly synthetic).
// 2. Text-region detector (Phase 2): PaddlePaddle/PP-OCRv5_mobile_det_onnx, the PaddleOCR team's own ONNX export of
//    PP-OCRv5_mobile_det (4.8 MB), Apache-2.0. It finds where text is, without reading it.
// 3. Second-look text reader (Phase 2b): PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx, the PaddleOCR team's own ONNX export
//    of en_PP-OCRv5_mobile_rec (7.8 MB) and its character list, Apache-2.0. It reads one line of text.
// Attribution: THIRD_PARTY_NOTICES.md. The weights are gzipped because the web app's host refuses single files over
// 25 MiB; build.sh unpacks them for store packages.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync, constants } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODELS = [
  {
    repo: 'gravitee-io/bert-small-pii-detection', revision: 'f8c27a85c51c0168f07b9dcf00265bf0a4097939', folder: 'pii-bert-small',
    // [file in the repo, where the app looks for it, SHA-256 of the original]
    files: [
      ['config.json', 'config.json', '6757df1ae2ec9ca16cef63009af337a66573d06c721d03c7820590f69eefa6c8'],
      ['tokenizer.json', 'tokenizer.json', 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'],
      ['tokenizer_config.json', 'tokenizer_config.json', '01a629a4923673b9a7a6d7da214952152c87c7ab3e002aae8e1e025486942163'],
      ['model.quant.onnx', 'onnx/model_quantized.onnx', 'b227845ff4989c9f7383874b841895dfbdb9a4d7a20ceb39c3f187271894bf2a'],
    ],
  },
  {
    repo: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx', revision: 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d', folder: 'pp-ocrv5-det',
    files: [
      ['inference.onnx', 'inference.onnx', 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d'],
    ],
  },
  {
    repo: 'PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx', revision: '3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b', folder: 'pp-ocrv5-rec-en',
    files: [
      ['inference.onnx', 'inference.onnx', 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f'],
      ['inference.yml', 'inference.yml', '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067'],
    ],
  },
];

const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'models');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const zipped = (local) => local.endsWith('.onnx');
const stored = (m, local) => join(base, m.folder, local + (zipped(local) ? '.gz' : ''));
// Fixed header, so the same model always gives the same .gz (clean diffs, reproducible builds).
const gzip = (buf) => gzipSync(buf, { level: constants.Z_BEST_COMPRESSION });

async function original(m, local) {
  const buf = await readFile(stored(m, local));
  return zipped(local) ? gunzipSync(buf) : buf;
}

if (process.argv.includes('--check')) {
  let bad = 0;
  for (const m of MODELS) {
    for (const [, local, want] of m.files) {
      let ok = false;
      try { ok = sha256(await original(m, local)) === want; } catch { /* missing */ }
      console.log(`  ${ok ? '✓' : '✗'} ${m.folder}/${local}`);
      if (!ok) bad++;
    }
  }
  if (bad) { console.error('Model files missing or changed: run npm run fetch:model'); process.exit(1); }
  console.log('Model files match their pinned revisions.');
  process.exit(0);
}

for (const m of MODELS) {
  for (const [file, local, want] of m.files) {
    try {
      if (sha256(await original(m, local)) === want) { console.log(`  ✓ ${m.folder}/${local} (already present)`); continue; }
    } catch { /* not downloaded yet */ }
    const res = await fetch(`https://huggingface.co/${m.repo}/resolve/${m.revision}/${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== want) throw new Error(`${file}: SHA-256 mismatch (got ${got}, want ${want})`);
    await mkdir(dirname(stored(m, local)), { recursive: true });
    const data = zipped(local) ? gzip(buf) : buf;
    await writeFile(stored(m, local), data);
    console.log(`  ✓ ${m.folder}/${local}${zipped(local) ? '.gz' : ''} (${(data.length / 1e6).toFixed(1)} MB)`);
  }
}
console.log(`Models ready in ${base}`);
