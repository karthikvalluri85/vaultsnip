// Evaluates small open vision models on a masked dashboard: can they recover its layout (chart types, titles, labels,
// boxes) without reading or inventing what the masks hide? Developer tool only; nothing here ships in VaultSnip.
//
//   node tools/eval-vision/eval.mjs [image] [--truth truth.json] [--models smolvlm-256m,florence2-base,...] [--out dir]
//
// Runs on the CPU through Transformers.js in Node (WebGPU exists only in the browser), so speed here says little about
// the browser; accuracy is the point. The first run downloads each model from huggingface.co into the Transformers.js
// cache (hundreds of MB to ~1.5 GB per model). Every model listed has a licence that allows redistribution (MIT or
// Apache-2.0); Qwen2.5-VL-3B is left out on purpose (qwen-research licence).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AutoProcessor, AutoTokenizer, AutoModelForVision2Seq, Florence2ForConditionalGeneration, Moondream1ForConditionalGeneration,
  Qwen2VLForConditionalGeneration, Qwen3VLForConditionalGeneration, RawImage,
} from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const imagePath = resolve(args[0] && !args[0].startsWith('--') ? args[0] : join(here, 'masked-dashboard.png'));
const truthPath = flag('truth', join(here, 'truth.json'));
const outDir = resolve(flag('out', join(here, 'results')));
const MAX_SIDE = +flag('max-side', 1024);   // images are downscaled to this longest side for every model
const MAX_TOKENS = +flag('max-tokens', 700);

export const PROMPT = `This is a screenshot of a business dashboard. Grey rectangles hide private text and numbers: never guess what is under them.
Describe the layout as JSON only, with no other text:
{"title": string, "visuals": [{"type": "kpi"|"bar"|"column"|"line"|"area"|"pie"|"donut"|"table"|"map"|"text", "title": string, "bbox": [x0, y0, x1, y1], "labels": [string]}]}
bbox uses a 0-1000 scale of the image width and height. labels are the readable axis, legend or column labels.`;

/* ---------- the models ---------- */

const chat = async (id, Model, dtype, image, opts = {}) => {
  const processor = await AutoProcessor.from_pretrained(id);
  const model = await Model.from_pretrained(id, { dtype, device: 'cpu' });
  const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: PROMPT }] }];
  const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(text, [image], opts.processor || {});
  const out = await model.generate({ ...inputs, max_new_tokens: MAX_TOKENS, do_sample: false });
  const n = inputs.input_ids.dims.at(-1);
  const answer = processor.batch_decode(out.slice(null, [n, null]), { skip_special_tokens: true })[0];
  await model.dispose();
  return answer;
};

export const MODELS = {
  'smolvlm-256m': { id: 'HuggingFaceTB/SmolVLM-256M-Instruct', params: '256M', licence: 'Apache-2.0',
    run: (img) => chat('HuggingFaceTB/SmolVLM-256M-Instruct', AutoModelForVision2Seq, { embed_tokens: 'fp32', vision_encoder: 'q4', decoder_model_merged: 'q4' }, img) },
  'smolvlm-500m': { id: 'HuggingFaceTB/SmolVLM-500M-Instruct', params: '500M', licence: 'Apache-2.0',
    run: (img) => chat('HuggingFaceTB/SmolVLM-500M-Instruct', AutoModelForVision2Seq, { embed_tokens: 'fp32', vision_encoder: 'q4', decoder_model_merged: 'q4' }, img) },
  'florence2-base': { id: 'onnx-community/Florence-2-base-ft', params: '230M', licence: 'MIT', run: (img) => florence('onnx-community/Florence-2-base-ft', img) },
  'florence2-large': { id: 'onnx-community/Florence-2-large-ft', params: '770M', licence: 'MIT', run: (img) => florence('onnx-community/Florence-2-large-ft', img) },
  'moondream2': { id: 'Xenova/moondream2', params: '1.9B', licence: 'Apache-2.0', run: (img) => moondream('Xenova/moondream2', img) },
  'qwen3-vl-2b': { id: 'onnx-community/Qwen3-VL-2B-Instruct-ONNX', params: '2B', licence: 'Apache-2.0',
    run: (img) => chat('onnx-community/Qwen3-VL-2B-Instruct-ONNX', Qwen3VLForConditionalGeneration, 'q4', img) },
  'qwen2-vl-2b': { id: 'onnx-community/Qwen2-VL-2B-Instruct', params: '2B', licence: 'Apache-2.0',
    run: (img) => chat('onnx-community/Qwen2-VL-2B-Instruct', Qwen2VLForConditionalGeneration, 'q4', img) },
};

// Florence-2 takes task tokens, not free prompts: it reads text with boxes and detects objects; no chart types.
async function florence(id, image) {
  const model = await Florence2ForConditionalGeneration.from_pretrained(id, { dtype: 'q4', device: 'cpu' });
  const processor = await AutoProcessor.from_pretrained(id);
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const vision = await processor(image);
  const run = async (task) => {
    const ids = await model.generate({ ...tokenizer(processor.construct_prompts(task)), ...vision, max_new_tokens: MAX_TOKENS });
    return processor.post_process_generation(tokenizer.batch_decode(ids, { skip_special_tokens: false })[0], task, image.size);
  };
  const ocr = await run('<OCR_WITH_REGION>');
  const od = await run('<OD>');
  await model.dispose();
  return JSON.stringify({ size: image.size, ocr_with_region: ocr['<OCR_WITH_REGION>'], od: od['<OD>'] });
}

async function moondream(id, image) {
  const processor = await AutoProcessor.from_pretrained(id);
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const model = await Moondream1ForConditionalGeneration.from_pretrained(id, { dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' }, device: 'cpu' });
  // Transformers.js 4 wants one <image> token per image feature: 729 for Moondream (a 27×27 grid)
  const prompt = '<image>'.repeat(729) + `\n\nQuestion: ${PROMPT}\n\nAnswer:`;
  const out = await model.generate({ ...tokenizer(prompt), ...(await processor(image)), do_sample: false, max_new_tokens: MAX_TOKENS });
  const text = tokenizer.batch_decode(out, { skip_special_tokens: true })[0];
  await model.dispose();
  return text.split('Answer:').pop().trim();
}

/* ---------- scoring against the true layout ---------- */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const TYPE_ALIAS = { bar: 'column', column: 'column', area: 'line', line: 'line', donut: 'pie', pie: 'pie', kpi: 'kpi', card: 'kpi', table: 'table' };
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};

/** The first JSON object in a model's answer, tolerating code fences and trailing text. */
export function parseJson(text) {
  const s = String(text).replace(/```(json)?/g, '');
  const start = s.indexOf('{');
  for (let end = s.lastIndexOf('}'); start >= 0 && end > start; end = s.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* shorter */ }
  }
  return null;
}

export function score(raw, truth, kind) {
  const text = norm(raw);
  const labelRecall = truth.labels.filter((l) => text.includes(norm(l))).length / truth.labels.length;
  const titleRecall = truth.visuals.filter((v) => text.includes(norm(v.title))).length / truth.visuals.length;
  let visuals = [], boxes = [];
  if (kind === 'florence') {
    const j = parseJson(raw) || {};
    const od = j.od || {};
    // Florence answers in pixels of the image it was given (downscaled to --max-side; 1024x640 for the sample)
    const [w, h] = Array.isArray(j.size) ? j.size : [1024, 640];
    boxes = (od.bboxes || []).map((b) => [b[0] / w * 1000, b[1] / h * 1000, b[2] / w * 1000, b[3] / h * 1000]);
  } else {
    const j = parseJson(raw);
    visuals = (j && Array.isArray(j.visuals)) ? j.visuals : [];
    boxes = visuals.map((v) => v.bbox).filter((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite));
  }
  // chart types: how many of the true visuals are matched by a predicted visual of the same type
  const want = truth.visuals.map((v) => v.type);
  const got = visuals.map((v) => TYPE_ALIAS[String(v.type || '').toLowerCase()] || String(v.type || '').toLowerCase());
  const pool = [...got];
  const typeHits = want.filter((t) => { const i = pool.indexOf(TYPE_ALIAS[t] || t); if (i < 0) return false; pool.splice(i, 1); return true; }).length;
  // boxes: mean best IoU per true visual
  const boxScore = truth.visuals.reduce((a, v) => a + Math.max(0, ...boxes.map((b) => iou(v.bbox, b))), 0) / truth.visuals.length;
  // invented numbers: every value on this dashboard is masked, so any figure in a text field was made up
  const strings = [];
  const walk = (o, key) => { if (typeof o === 'string') strings.push(o); else if (Array.isArray(o)) { if (key !== 'bbox' && key !== 'bboxes' && key !== 'quad_boxes') o.forEach((x) => walk(x, key)); } else if (o && typeof o === 'object') Object.entries(o).forEach(([k, x]) => walk(x, k)); };
  const parsed = parseJson(raw);
  walk(parsed ?? raw);
  const invented = strings.join(' ').match(/(?<![a-z])[$€£]?\d[\d.,]*\s?(%|k|m|bn|b)?(?![a-z])/gi)?.filter((n) => !/^(2026|5)$/.test(n.trim())) ?? [];
  return {
    json: kind === 'florence' ? 'n/a' : !!parsed,
    visuals: kind === 'florence' ? boxes.length : visuals.length,
    typeAccuracy: kind === 'florence' ? null : +(typeHits / want.length).toFixed(2),
    titleRecall: +titleRecall.toFixed(2), labelRecall: +labelRecall.toFixed(2), boxIoU: +boxScore.toFixed(2),
    inventedNumbers: invented.length,
  };
}

/* ---------- main ---------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const truth = JSON.parse(await readFile(truthPath, 'utf8'));
  const wanted = (flag('models', Object.keys(MODELS).filter((k) => k !== 'florence2-large' && k !== 'qwen2-vl-2b').join(','))).split(',');
  let image = await RawImage.read(imagePath);
  if (Math.max(image.width, image.height) > MAX_SIDE) image = await image.resize(Math.round(image.width * MAX_SIDE / Math.max(image.width, image.height)), Math.round(image.height * MAX_SIDE / Math.max(image.width, image.height)));
  await mkdir(outDir, { recursive: true });
  const rows = [];
  for (const key of wanted) {
    const m = MODELS[key];
    if (!m) { console.log(`unknown model ${key}; choose from ${Object.keys(MODELS).join(', ')}`); continue; }
    console.log(`\n=== ${key} (${m.id}, ${m.params}, ${m.licence})`);
    const t0 = Date.now(); let raw = '', error = '';
    try { raw = await m.run(image); } catch (e) { error = String(e && e.message || e).split('\n')[0]; }
    const seconds = +((Date.now() - t0) / 1000).toFixed(1);
    const rssMB = Math.round(process.memoryUsage().rss / 1048576);
    const s = error ? {} : score(raw, truth, key.startsWith('florence') ? 'florence' : 'chat');
    rows.push({ model: key, params: m.params, seconds, rssMB, error, ...s });
    console.log(error ? `ERROR: ${error}` : raw.slice(0, 3000));
    await writeFile(join(outDir, `${key}.txt`), error ? `ERROR: ${error}` : raw);
  }
  console.log('\n' + JSON.stringify(rows, null, 1));
  console.table(rows.map(({ error, ...r }) => r));
  await writeFile(join(outDir, 'scores.json'), JSON.stringify(rows, null, 2));
}
