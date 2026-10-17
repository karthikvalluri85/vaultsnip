// Builds the contextual PII check (Feature 2) into web/, which is served as-is (no build step on deploy):
//   web/ml/ml-worker.js, web/ml/ner-model.js, web/ml/assets/ort-wasm-simd-threaded.wasm   (Web Worker)
//   web/lib/vs-context.js                                                                  (page client, window.VSContext)
// Like web/lib, these are committed. Re-run after changing src/background or src/content/context-classifier.ts.
// The model itself comes from npm run fetch:model (web/models/).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  configFile: false,
  logLevel: 'warn',
  base: './', // asset URLs relative to the worker, so web/ml works under any path (site root or extension app/)
  resolve: {
    // transformers.js imports the WebGPU build of the ONNX runtime, which needs the 26.9 MB "asyncify"
    // binary. The model runs fine on plain WASM (14.3 MB binary), so the plain build is used.
    alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' }],
  },
  build: {
    outDir: join(root, 'web/ml'), emptyOutDir: true, target: 'es2022', modulePreload: false, copyPublicDir: false,
    rollupOptions: {
      input: { 'ml-worker': join(root, 'src/background/ml-worker.ts') },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: join(root, 'web/lib'), emptyOutDir: false, target: 'es2020', minify: false, copyPublicDir: false,
    lib: { entry: join(root, 'src/content/context-classifier.ts'), formats: ['iife'], name: 'VSContext', fileName: () => 'vs-context.js' },
  },
});
console.log('Built web/ml and web/lib/vs-context.js');
