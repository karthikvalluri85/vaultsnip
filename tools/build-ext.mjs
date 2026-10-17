// Builds the extension's scripts into extension/, which build.sh packages as-is (no build step on release):
//   extension/background.js     service worker (toolbar snip + canvas redaction), from src/background/index.ts
//   extension/canvas-ocr.js     canvas redactor, injected on demand, from src/content/canvas-ocr-entry.ts
//   extension/offscreen.html, offscreen-ocr.js   OCR + text rules for canvas redaction
// Like web/ml, these are committed. Re-run after changing src/background, src/content or src/shared.
import { cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { escapeNonchars } from './escape-nonchars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension');

await cp(join(root, 'src/background/offscreen.html'), join(out, 'offscreen.html'));

const bundle = (entry, file, format) => build({
  configFile: false,
  logLevel: 'warn',
  plugins: [escapeNonchars()],
  build: {
    outDir: out, emptyOutDir: false, minify: false, target: 'es2022', copyPublicDir: false,
    lib: { entry: join(root, entry), formats: [format], name: 'vaultsnip', fileName: () => file },
  },
});
await bundle('src/background/index.ts', 'background.js', 'es');
await bundle('src/background/offscreen-ocr.ts', 'offscreen-ocr.js', 'es');
await bundle('src/content/canvas-ocr-entry.ts', 'canvas-ocr.js', 'iife'); // injected by file, so one classic script
console.log('Built extension/ scripts');
