// Builds the on-device layout builder (Phase 2) into web/lib/vs-layout.js (self.VSLayout, for the page and its worker), committed like web/lib.
// Re-run after changing src/layout. VSLAYOUT_OUT builds into another folder instead (to try a change; see
// tools/layout-bench/builder.mjs).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { escapeNonchars } from './escape-nonchars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [escapeNonchars()],
  build: {
    outDir: process.env.VSLAYOUT_OUT || join(root, 'web/lib'), emptyOutDir: false, target: 'es2020', minify: true, copyPublicDir: false,
    lib: { entry: join(root, 'src/layout/index.ts'), formats: ['iife'], name: 'VSLayout', fileName: () => 'vs-layout.js' },
  },
});
console.log('Built ' + join(process.env.VSLAYOUT_OUT || 'web/lib', 'vs-layout.js'));
