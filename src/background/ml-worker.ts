/**
 * Web Worker running the on-device models off the main thread: the contextual PII fallback (Feature 2) and the
 * text-region detector (Phase 2).
 *
 * The app page starts it: new Worker('ml/ml-worker.js?models=…&gz=…', { type: 'module' }). A Manifest V3
 * service worker cannot start Web Workers, and the redaction runs on the app page in both the extension
 * and the web app. The models and ONNX runtime come from VaultSnip itself, never from a CDN or Hugging Face.
 */
import { installNetworkGuard } from './network-guard';
import { installModelFiles, modelSource } from './model-files';
import { createMlHandler } from './ml-handler';
// types only: a value imported here would land in this entry chunk, and the models chunk importing it back would run
// this file a second time (tools/build-ml.mjs refuses such a build)
import type { MlRequest, MlResponse } from './ml-protocol';
// Emitted by Vite next to this bundle; the same file the ONNX runtime references itself.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

declare const self: DedicatedWorkerGlobalScope;

const src = modelSource(self.location.href);
installNetworkGuard(self as any, self.location.origin, [], src.remoteBase ? [new URL(src.remoteBase).origin] : []);
installModelFiles(self as any, src, self.location.origin);
const ortWasm = new URL(ortWasmUrl, self.location.href).href;

const handle = createMlHandler(
  {
    ner: async () => {
      // Imported only after the guard is in place.
      const { useLocalFilesOnly, loadNerScorer } = await import('./models');
      useLocalFilesOnly({
        // A path, not a full URL: transformers.js 4.3 only checks local files whose path is not a URL,
        // and otherwise silently reports tokenizer_config.json as missing.
        models: src.localPath,
        ortWasm,
      });
      return loadNerScorer();
    },
    detector: async () => {
      const { loadTextDetector } = await import('./models');
      // the local path: the model-files layer maps it to the configured source and unpacks .onnx.gz
      return loadTextDetector(new URL(src.localPath, self.location.origin).href, ortWasm);
    },
    reader: async () => {
      const { loadTextReader } = await import('./models');
      return loadTextReader(new URL(src.localPath, self.location.origin).href, ortWasm);
    },
  },
  (r: MlResponse) => self.postMessage(r),
);

self.onmessage = (e: MessageEvent<MlRequest>) => void handle(e.data);
