/**
 * The text-region detector (Phase 2) in the ML worker: PaddleOCR's PP-OCRv5_mobile_det (Apache-2.0), run with the
 * same ONNX runtime as the name check. It finds where text is; it does not read it.
 *
 * Preprocessing follows the model's own inference.yml: BGR channels, scaled to 0-1 and normalised with the ImageNet
 * mean and standard deviation, channels first. The page sends pixels already at the input size (sides multiples of
 * 32, see detectorSize), so this file does no resizing. Post-processing is dbRegions (src/shared/text-regions.ts).
 */
import * as ort from 'onnxruntime-web/wasm';
import { DETECTOR_FILE, type Pixels } from './ml-protocol';
import type { TextDetector } from './ml-handler';
import { dbRegions } from '../shared/text-regions';

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/** RGBA pixels → the model's input tensor: 1 × 3 × H × W, BGR, normalised. */
export function toTensorData(img: Pixels): Float32Array {
  const { width: w, height: h, data } = img, n = w * h, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (data[i * 4 + (2 - c)] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/**
 * Loads the model from `modelsBase` + DETECTOR_FILE (through the worker's guarded fetch, so it comes only from
 * VaultSnip's own files)
 * into a single-threaded WASM session: extension pages are not cross-origin isolated, so there are no threads.
 */
export async function loadTextDetector(modelsBase: string, ortWasm: string): Promise<TextDetector> {
  ort.env.wasm.wasmPaths = { wasm: ortWasm };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const res = await fetch(new URL(DETECTOR_FILE, modelsBase).href);
  if (!res.ok) throw new Error(`text detector model: HTTP ${res.status}`);
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
  const input = session.inputNames[0], output = session.outputNames[0];
  return {
    async detect(img) {
      if (img.width % 32 || img.height % 32) throw new Error('detector input sides must be multiples of 32');
      const feeds = { [input]: new ort.Tensor('float32', toTensorData(img), [1, 3, img.height, img.width]) };
      const result = await session.run(feeds);
      const map = result[output];
      try {
        const [, , mh, mw] = map.dims as number[];
        return dbRegions(map.data as Float32Array, mw, mh);
      } finally {
        map.dispose();
      }
    },
  };
}
