// Builds the extension's scripts into extension/, which build.sh packages as-is (no build step on release):
//   extension/background.js     service worker (toolbar snip + canvas redaction), from src/background/index.ts
//   extension/canvas-ocr.js     canvas redactor, injected on demand, from src/content/canvas-ocr-entry.ts
//   extension/offscreen.html, offscreen-ocr.js   OCR + scanner for canvas redaction
//   extension/wasm/             Rust scanner (npm run build:wasm first)
// Like web/ml, these are committed. Re-run after changing src/background, src/content or src/core-rust.
import { cp, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension');

try { await access(join(root, 'public/wasm/vaultsnip_core_bg.wasm')); }
catch { console.error('public/wasm is missing: run npm run build:wasm first.'); process.exit(1); }

await rm(join(out, 'wasm'), { recursive: true, force: true });
await cp(join(root, 'public/wasm'), join(out, 'wasm'), { recursive: true, filter: (p) => !/\.gitignore$|\.d\.ts$|package\.json$|README\.md$/.test(p) });
await cp(join(root, 'src/background/offscreen.html'), join(out, 'offscreen.html'));

const bundle = (entry, file, format) => build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: out, emptyOutDir: false, minify: false, target: 'es2022', copyPublicDir: false,
    lib: { entry: join(root, entry), formats: [format], name: 'vaultsnip', fileName: () => file },
  },
});
await bundle('src/background/index.ts', 'background.js', 'es');
await bundle('src/background/offscreen-ocr.ts', 'offscreen-ocr.js', 'es');
await bundle('src/content/canvas-ocr-entry.ts', 'canvas-ocr.js', 'iife'); // injected by file, so one classic script
console.log('Built extension/ scripts and wasm/');
