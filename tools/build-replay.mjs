// Builds the replay player (Feature 4) into web/lib/vs-replay.js (window.VSReplay), committed like web/lib.
// Re-run after changing src/replay or src/shared.
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
    lib: { entry: join(root, 'src/replay/player.ts'), formats: ['iife'], name: 'VSReplay', fileName: () => 'vs-replay.js' },
  },
});
console.log('Built web/lib/vs-replay.js');
