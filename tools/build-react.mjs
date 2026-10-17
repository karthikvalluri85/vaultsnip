// Builds the DOM-to-React exporter (Feature 8) into web/lib/vs-react.js (window.VSReact), committed like web/lib.
// Re-run after changing src/exporters or src/export.
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
    lib: { entry: join(root, 'src/exporters/dom-to-react.ts'), formats: ['iife'], name: 'VSReact', fileName: () => 'vs-react.js' },
  },
});
console.log('Built web/lib/vs-react.js');
