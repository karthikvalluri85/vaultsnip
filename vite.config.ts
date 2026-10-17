// Builds the ML worker (Feature 2) into public/ml/: npm run build:ml
// Vitest also reads this file; the build settings do not affect tests.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  // Asset URLs relative to the bundle, so public/ml/ works under any path (extension or web app).
  base: './',
  resolve: {
    // transformers.js imports the WebGPU build of the ONNX runtime, which needs the 26.9 MB "asyncify"
    // binary. The 14.5 MB model runs fine on plain WASM (14.3 MB binary), so the plain build is used.
    alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' }],
  },
  build: {
    outDir: 'public/ml',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: { 'ml-worker': 'src/background/ml-worker.ts' },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
