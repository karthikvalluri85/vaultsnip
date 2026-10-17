// BI-aware evaluation: do small open vision models understand a masked BI dashboard well enough to rebuild it?
// Three plain questions instead of one big JSON request (developer tool; nothing here ships in VaultSnip):
//   1. chart type of each visual: one crop per visual (boxes from truth.json, so this measures classification alone),
//      multiple choice, with the BI context stated;
//   2. which tool made the dashboard (Power BI, Tableau, Looker, ...);
//   3. a rebuild list: one visual per line as "type | title", what VaultSnip's replica engine needs.
//
//   node tools/eval-vision/bi.mjs [image] [--truth truth.json] [--models qwen3-vl-2b,moondream2,...] [--out dir]
//
// CPU in Node (no WebGPU), first run downloads the models. All are MIT or Apache-2.0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AutoProcessor, AutoTokenizer, AutoModelForVision2Seq, Florence2ForConditionalGeneration, Moondream1ForConditionalGeneration,
  Qwen3VLForConditionalGeneration, RawImage,
} from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const imagePath = resolve(args[0] && !args[0].startsWith('--') ? args[0] : join(here, 'masked-dashboard.png'));
const truth = JSON.parse(await readFile(flag('truth', join(here, 'truth.json')), 'utf8'));
const outDir = resolve(flag('out', join(here, 'results-bi')));

export const TYPES = ['kpi', 'bar', 'column', 'line', 'area', 'pie', 'donut', 'table', 'map', 'scatter', 'gauge', 'funnel', 'treemap', 'text'];
const CONTEXT = 'This image comes from a business intelligence (BI) dashboard or report, such as Power BI, Tableau, Looker or Excel. Grey rectangles hide private text and numbers; ignore them and never guess what is under them.';
export const Q_TYPE = `${CONTEXT}\nThis crop shows ONE visual. Which type is it? A "column" chart has vertical bars; a "bar" chart has horizontal bars; a "kpi" is a single big number with a label.\nAnswer with exactly one word from: ${TYPES.join(', ')}.`;
export const Q_TOOL = `${CONTEXT}\nWhich tool most likely produced this dashboard? Answer with one of: Power BI, Tableau, Looker, Qlik, Excel, Google Sheets, Metabase, custom web app, unknown. Then give one short reason.`;
export const Q_LIST = `${CONTEXT}\nList every visual on this dashboard in reading order (left to right, top to bottom), one per line, exactly as:\ntype | title\nUse a type from: ${TYPES.join(', ')}. Write only the list.`;

/* ---------- models: load once, ask many questions ---------- */

async function chatModel(id, Model, dtype) {
  const processor = await AutoProcessor.from_pretrained(id);
  const model = await Model.from_pretrained(id, { dtype, device: 'cpu' });
  return {
    async ask(image, prompt, maxTokens) {
      const text = processor.apply_chat_template([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }], { add_generation_prompt: true });
      const inputs = await processor(text, [image]);
      const out = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1 });
      return processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0].trim();
    },
    dispose: () => model.dispose(),
  };
}

async function moondreamModel(id) {
  const processor = await AutoProcessor.from_pretrained(id);
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const model = await Moondream1ForConditionalGeneration.from_pretrained(id, { dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' }, device: 'cpu' });
  return {
    async ask(image, prompt, maxTokens) {
      // Transformers.js 4 wants one <image> token per image feature: 729 for Moondream (27×27)
      const out = await model.generate({ ...tokenizer('<image>'.repeat(729) + `\n\nQuestion: ${prompt}\n\nAnswer:`), ...(await processor(image)), do_sample: false, max_new_tokens: maxTokens, repetition_penalty: 1.1 });
      return tokenizer.batch_decode(out, { skip_special_tokens: true })[0].split('Answer:').pop().trim();
    },
    dispose: () => model.dispose(),
  };
}

// Florence-2 answers task tokens, not questions: for a chart type it captions the crop and the caption is read for a type word.
async function florenceModel(id) {
  const model = await Florence2ForConditionalGeneration.from_pretrained(id, { dtype: 'q4', device: 'cpu' });
  const processor = await AutoProcessor.from_pretrained(id);
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  return {
    async ask(image, prompt, maxTokens) {
      if (prompt !== Q_TYPE) return '(Florence-2 cannot answer free questions)';
      const task = '<MORE_DETAILED_CAPTION>';
      const ids = await model.generate({ ...tokenizer(processor.construct_prompts(task)), ...(await processor(image)), max_new_tokens: maxTokens });
      return processor.post_process_generation(tokenizer.batch_decode(ids, { skip_special_tokens: false })[0], task, image.size)[task];
    },
    dispose: () => model.dispose(),
  };
}

const MODELS = {
  'smolvlm-500m': () => chatModel('HuggingFaceTB/SmolVLM-500M-Instruct', AutoModelForVision2Seq, { embed_tokens: 'fp32', vision_encoder: 'q4', decoder_model_merged: 'q4' }),
  'florence2-base': () => florenceModel('onnx-community/Florence-2-base-ft'),
  'moondream2': () => moondreamModel('Xenova/moondream2'),
  'qwen3-vl-2b': () => chatModel('onnx-community/Qwen3-VL-2B-Instruct-ONNX', Qwen3VLForConditionalGeneration, 'q4'),
};

/* ---------- reading answers ---------- */

const SYN = { 'bar chart': 'bar', 'column chart': 'column', 'line chart': 'line', 'line graph': 'line', 'pie chart': 'pie', 'donut chart': 'donut', 'doughnut': 'donut', 'scorecard': 'kpi', 'card': 'kpi', 'number': 'kpi', 'spreadsheet': 'table', 'grid': 'table', 'histogram': 'column' };
/** The chart type an answer names (first type word, or a common synonym), or null. */
export function typeOf(answer) {
  const a = ' ' + String(answer).toLowerCase().replace(/[^a-z ]+/g, ' ') + ' ';
  let best = null, at = Infinity;
  for (const [k, v] of [...Object.entries(SYN), ...TYPES.map((t) => [t, t])]) {
    const i = a.indexOf(' ' + k + ' ');
    if (i >= 0 && i < at) { at = i; best = v; }
  }
  return best;
}
const same = (got, want, lenient) => got === want || (lenient && ((got === 'bar' && want === 'column') || (got === 'column' && want === 'bar') || (got === 'area' && want === 'line') || (got === 'donut' && want === 'pie')));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Scores a "type | title" list against the true visuals, in order. */
export function scoreList(answer, visuals) {
  const lines = String(answer).split('\n').map((l) => l.trim()).filter((l) => l.includes('|'));
  const got = lines.map((l) => { const [t, ...rest] = l.split('|'); return { type: typeOf(t), title: rest.join('|').trim() }; });
  const n = visuals.length;
  const typesInOrder = visuals.filter((v, i) => got[i] && same(got[i].type, v.type, true)).length / n;
  const titles = visuals.filter((v) => got.some((g) => norm(g.title).includes(norm(v.title)))).length / n;
  return { lines: got.length, expected: n, typesInOrder: +typesInOrder.toFixed(2), titles: +titles.toFixed(2), repeats: got.length - new Set(got.map((g) => g.type + '|' + norm(g.title))).size };
}

/* ---------- main ---------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const full = await RawImage.read(imagePath);
  const scale = (b) => [Math.round(b[0] / 1000 * full.width), Math.round(b[1] / 1000 * full.height), Math.round(b[2] / 1000 * full.width), Math.round(b[3] / 1000 * full.height)];
  const crops = await Promise.all(truth.visuals.map((v) => full.crop(scale(v.bbox))));
  const small = await full.resize(1024, Math.round(full.height * 1024 / full.width));
  await mkdir(outDir, { recursive: true });
  const wanted = flag('models', Object.keys(MODELS).join(',')).split(',');
  const summary = [];
  for (const key of wanted) {
    if (!MODELS[key]) { console.log(`unknown model ${key}`); continue; }
    console.log(`\n=== ${key}`);
    const t0 = Date.now(); const log = { model: key, types: [], tool: '', list: '' };
    try {
      const m = await MODELS[key]();
      for (const [i, v] of truth.visuals.entries()) {
        const a = await m.ask(crops[i], Q_TYPE, 40);
        log.types.push({ want: v.type, title: v.title, answer: a, got: typeOf(a) });
        console.log(`  type ${i + 1}: want ${v.type.padEnd(6)} got ${String(typeOf(a)).padEnd(6)} ← ${a.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
      log.tool = await m.ask(small, Q_TOOL, 60); console.log(`  tool: ${log.tool.replace(/\s+/g, ' ').slice(0, 200)}`);
      log.list = await m.ask(small, Q_LIST, 200); console.log(`  list:\n    ${log.list.split('\n').slice(0, 12).join('\n    ')}`);
      await m.dispose();
    } catch (e) { log.error = String(e && e.message || e).split('\n')[0]; console.log('  ERROR ' + log.error); }
    const strict = log.types.filter((t) => same(t.got, t.want, false)).length, lenient = log.types.filter((t) => same(t.got, t.want, true)).length;
    summary.push({ model: key, seconds: Math.round((Date.now() - t0) / 1000), chartTypeStrict: `${strict}/${truth.visuals.length}`, chartTypeLenient: `${lenient}/${truth.visuals.length}`,
      tool: (log.tool.match(/power bi|tableau|looker|qlik|excel|google sheets|metabase|custom web app|unknown/i) || ['?'])[0], ...(log.list ? scoreList(log.list, truth.visuals) : {}), error: log.error || '' });
    await writeFile(join(outDir, `${key}.json`), JSON.stringify(log, null, 2));
  }
  console.table(summary);
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
}
