/**
 * Loads the local NER model and scores OCR lines. Used by the ML worker in the browser and by the
 * real-model test in Node (the package's export conditions pick the matching transformers.js build).
 */
import { AutoModelForTokenClassification, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { MODEL_ID, type WordScore } from './ml-protocol';
import { LABELS, emptyScores, packLines, personOrg } from './ner-encode';

export interface NerScorer {
  score(lines: string[][]): Promise<WordScore[][]>;
}

export interface LocalPaths {
  /** Folder holding `<MODEL_ID>/`: a same-origin path such as "/models/" (browser) or a file path (Node). Not a full URL. */
  models: string;
  /** URL of ort-wasm-simd-threaded.wasm. Browser only. */
  ortWasm?: string;
}

/**
 * Turns off every remote default in transformers.js. Out of the box it downloads models from
 * huggingface.co and the ONNX runtime from cdn.jsdelivr.net, and in browsers refuses local models.
 */
export function useLocalFilesOnly(paths: LocalPaths): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = paths.models;
  env.useBrowserCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm && paths.ortWasm) {
    env.useWasmCache = false;
    wasm.wasmPaths = { wasm: paths.ortWasm };
    wasm.numThreads = 1; // extension pages are not cross-origin isolated, so there is no SharedArrayBuffer
    wasm.proxy = false;
  }
}

const BATCH = 16;

export async function loadNerScorer(modelId = MODEL_ID): Promise<NerScorer> {
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForTokenClassification.from_pretrained(modelId, { dtype: 'q8' });
  const [cls, sep] = tokenizer.encode('') as number[];
  const encode = (w: string) => tokenizer.encode(w, { add_special_tokens: false }) as number[];
  const int64 = (a: number[]) => BigInt64Array.from(a, (v) => BigInt(v));

  return {
    async score(lines) {
      const out = emptyScores(lines);
      const rows = packLines(lines, encode, cls, sep);
      for (let b = 0; b < rows.length; b += BATCH) {
        const batch = rows.slice(b, b + BATCH);
        const len = Math.max(...batch.map((r) => r.ids.length));
        const ids: number[] = [], mask: number[] = [];
        for (const r of batch) {
          for (let i = 0; i < len; i++) {
            ids.push(i < r.ids.length ? r.ids[i] : 0);
            mask.push(i < r.ids.length ? 1 : 0);
          }
        }
        const dims = [batch.length, len];
        const { logits } = await model({
          input_ids: new Tensor('int64', int64(ids), dims),
          attention_mask: new Tensor('int64', int64(mask), dims),
          token_type_ids: new Tensor('int64', new BigInt64Array(ids.length), dims),
        });
        const data = logits.data as Float32Array;
        const n = logits.dims[2] as number;
        if (n !== LABELS.length) throw new Error(`model has ${n} labels, expected ${LABELS.length}`);
        batch.forEach((r, ri) => r.words.forEach((w) => {
          out[w.line][w.word] = personOrg(data, (ri * len + w.pos) * n, n);
        }));
      }
      return out;
    },
  };
}
