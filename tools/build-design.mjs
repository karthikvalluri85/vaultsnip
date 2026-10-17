// Builds the design export (Feature 5) into web/lib/vs-design.js (window.VSDesign), committed like web/lib.
// Re-run after changing src/export.
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
    lib: { entry: join(root, 'src/export/design-export.ts'), formats: ['iife'], name: 'VSDesign', fileName: () => 'vs-design.js' },
  },
});
console.log('Built web/lib/vs-design.js');
