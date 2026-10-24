/**
 * A second text reader for the second look (Phase 2b): PaddleOCR's en_PP-OCRv5_mobile_rec (Apache-2.0), the PaddleOCR
 * team's own ONNX export, in the same ML worker and ONNX runtime as the detector. It reads one line of text at a time:
 * the app sends a crop already straightened, this file resizes it to the model's 48 px height and decodes the answer.
 *
 * Preprocessing and decoding follow the model's inference.yml: BGR, (x / 255 - 0.5) / 0.5, channels first, height 48;
 * greedy CTC decoding (class 0 is the blank, class i is character_dict[i - 1], and a last extra class, when the model
 * has one, is the space). Confidence is the mean probability of the characters kept.
 */
import * as ort from 'onnxruntime-web/wasm';
import { READER_DIR, type Pixels } from './ml-protocol';

export interface Reading { text: string; conf: number }
export interface TextReader { read(line: Pixels): Promise<Reading> }

/** The character list from inference.yml (a YAML list under PostProcess.character_dict). */
export function parseDict(yml: string): string[] {
  const lines = yml.split(/\r?\n/), at = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l));
  if (at < 0) throw new Error('no character_dict in inference.yml');
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*-\s(.*)$/.exec(l);
    if (!m) break;
    let v = m[1];
    if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = JSON.parse(v);
    out.push(v);
  }
  return out;
}

/** Greedy CTC decoding of probabilities [steps × classes]: best class per step, repeats merged, blanks dropped. */
export function ctcDecode(probs: ArrayLike<number>, steps: number, classes: number, dict: readonly string[]): Reading {
  const space = classes === dict.length + 2;
  let text = '', sum = 0, n = 0, prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0, p = -Infinity;
    for (let c = 0; c < classes; c++) { const v = probs[t * classes + c]; if (v > p) { p = v; best = c; } }
    if (best !== 0 && best !== prev) {
      text += best <= dict.length ? dict[best - 1] : space ? ' ' : '';
      sum += p; n++;
    }
    prev = best;
  }
  return { text: text.trim(), conf: n ? sum / n : 0 };
}

/** RGBA pixels of a line → the model's input: 1 × 3 × 48 × W (W a multiple of 8, at most 3200), BGR, centred. */
export function toLineTensor(img: Pixels): { data: Float32Array; width: number } {
  const H = 48, width = Math.max(8, Math.min(3200, Math.round((img.width * H) / Math.max(1, img.height) / 8) * 8));
  const out = new Float32Array(3 * H * width);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) {
    // nearest pixel of the source (the app sends crops already near this size)
    const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width)), sy = Math.min(img.height - 1, Math.floor((y * img.height) / H));
    const i = (sy * img.width + sx) * 4;
    for (let c = 0; c < 3; c++) out[c * H * width + y * width + x] = (img.data[i + (2 - c)] / 255 - 0.5) / 0.5;
  }
  return { data: out, width };
}

/** Loads the model and its character list from `modelsBase` + READER_DIR, through the worker's guarded fetch. */
export async function loadTextReader(modelsBase: string, ortWasm: string): Promise<TextReader> {
  ort.env.wasm.wasmPaths = { wasm: ortWasm };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const [model, yml] = await Promise.all(['inference.onnx', 'inference.yml'].map(async (f) => {
    const res = await fetch(new URL(READER_DIR + f, modelsBase).href);
    if (!res.ok) throw new Error(`text reader ${f}: HTTP ${res.status}`);
    return f.endsWith('.onnx') ? new Uint8Array(await res.arrayBuffer()) : res.text();
  }));
  const dict = parseDict(yml as string);
  const session = await ort.InferenceSession.create(model as Uint8Array, { executionProviders: ['wasm'] });
  const input = session.inputNames[0], output = session.outputNames[0];
  return {
    async read(line) {
      const { data, width } = toLineTensor(line);
      const result = await session.run({ [input]: new ort.Tensor('float32', data, [1, 3, 48, width]) });
      const o = result[output];
      try {
        const [, steps, classes] = o.dims as number[];
        return ctcDecode(o.data as Float32Array, steps, classes, dict);
      } finally {
        o.dispose();
      }
    },
  };
}
