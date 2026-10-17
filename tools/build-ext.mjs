// Builds a loadable development extension with canvas redaction (Feature 3) into dist/extension-dev.
// Usage: npm run build:wasm && npm run build:ext [-- --test]
// The release build (build.sh, extension/manifest.json, extension/background.js) is not changed.
// --test also grants <all_urls> (test builds only), because the end-to-end test calls the service worker
// directly instead of clicking the menu (which is what grants activeTab).
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'extension-dev');
const test = process.argv.includes('--test');

try { await access(join(root, 'public/wasm/vaultsnip_core_bg.wasm')); }
catch { console.error('public/wasm is missing: run npm run build:wasm first.'); process.exit(1); }

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'web'), join(out, 'app'), { recursive: true });
await cp(join(root, 'web/icons'), join(out, 'icons'), { recursive: true });
await cp(join(root, 'public/wasm'), join(out, 'wasm'), { recursive: true, filter: (p) => !p.endsWith('.gitignore') });
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

const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
manifest.background = { service_worker: 'background.js', type: 'module' };
manifest.permissions = [...new Set([...manifest.permissions, 'scripting', 'offscreen', 'contextMenus'])];
manifest.commands = { 'blur-canvases': { suggested_key: { default: 'Alt+Shift+B' }, description: 'Blur text in charts on this page' } };
if (test) manifest.host_permissions = ['<all_urls>']; // captureVisibleTab accepts only <all_urls> or activeTab
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Development extension in ${out}${test ? ' (test build)' : ''}. Load it unpacked from chrome://extensions.`);
