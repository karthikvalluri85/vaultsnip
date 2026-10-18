// Builds the on-device layout builder (Phase 2) into web/lib/vs-layout.js (self.VSLayout, for the page and its worker), committed like web/lib.
// Re-run after changing src/layout.
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
    outDir: join(root, 'web/lib'), emptyOutDir: false, target: 'es2020', minify: true, copyPublicDir: false,
    lib: { entry: join(root, 'src/layout/index.ts'), formats: ['iife'], name: 'VSLayout', fileName: () => 'vs-layout.js' },
  },
});
console.log('Built web/lib/vs-layout.js');
