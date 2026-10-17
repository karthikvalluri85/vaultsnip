/**
 * Web Worker running the contextual NER fallback (Feature 2) off the main thread.
 *
 * The app page starts it (new Worker('ml/ml-worker.js', { type: 'module' })); a Manifest V3 service worker
 * cannot start Web Workers, and the redaction runs on the app page in both the extension and the web app.
 * Model and ONNX runtime are served next to this file (public/ml/), never from a CDN.
 */
import { installNetworkGuard } from './network-guard';
import { createMlHandler } from './ml-handler';
import type { MlRequest, MlResponse } from './ml-protocol';
// Emitted by Vite next to this bundle; the same file the ONNX runtime references itself.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

declare const self: DedicatedWorkerGlobalScope;

installNetworkGuard(self as any, self.location.origin);

const handle = createMlHandler(
  async () => {
    // Imported only after the guard is in place.
    const { useLocalFilesOnly, loadNerScorer } = await import('./ner-model');
    useLocalFilesOnly({
      // A path, not a full URL: transformers.js 4.3 only checks local files whose path is not a URL,
      // and otherwise silently reports tokenizer_config.json as missing.
      models: new URL('../models/', self.location.href).pathname,
      ortWasm: new URL(ortWasmUrl, self.location.href).href,
    });
    return loadNerScorer();
  },
  (r: MlResponse) => self.postMessage(r),
);

self.onmessage = (e: MessageEvent<MlRequest>) => void handle(e.data);
