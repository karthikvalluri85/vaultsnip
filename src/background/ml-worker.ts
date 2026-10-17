/**
 * Web Worker running the contextual PII fallback (Feature 2) off the main thread.
 *
 * The app page starts it: new Worker('ml/ml-worker.js?models=…&gz=…', { type: 'module' }). A Manifest V3
 * service worker cannot start Web Workers, and the redaction runs on the app page in both the extension
 * and the web app. The model and ONNX runtime come from VaultSnip itself, never from a CDN or Hugging Face.
 */
import { installNetworkGuard } from './network-guard';
import { installModelFiles, modelSource } from './model-files';
import { createMlHandler } from './ml-handler';
import type { MlRequest, MlResponse } from './ml-protocol';
// Emitted by Vite next to this bundle; the same file the ONNX runtime references itself.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

declare const self: DedicatedWorkerGlobalScope;

const src = modelSource(self.location.href);
installNetworkGuard(self as any, self.location.origin, [], src.remoteBase ? [new URL(src.remoteBase).origin] : []);
installModelFiles(self as any, src, self.location.origin);

const handle = createMlHandler(
  async () => {
    // Imported only after the guard is in place.
    const { useLocalFilesOnly, loadNerScorer } = await import('./ner-model');
    useLocalFilesOnly({
      // A path, not a full URL: transformers.js 4.3 only checks local files whose path is not a URL,
      // and otherwise silently reports tokenizer_config.json as missing.
      models: src.localPath,
      ortWasm: new URL(ortWasmUrl, self.location.href).href,
    });
    return loadNerScorer();
  },
  (r: MlResponse) => self.postMessage(r),
);

self.onmessage = (e: MessageEvent<MlRequest>) => void handle(e.data);
