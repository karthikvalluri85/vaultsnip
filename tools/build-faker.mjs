// Builds the smart data injector (Feature 6) into web/lib/vs-faker.js (window.VSFaker), committed like web/lib.
// Faker's full locale data is several MB; replicas and their exports need only names, companies, places and products,
// so this first writes a slim copy of those lists (src/replica/faker-locales.json) for the locales a dashboard can map to.
// Re-run after changing src/replica or upgrading @faker-js/faker.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allLocales } from '@faker-js/faker';
import { build } from 'vite';
import { escapeNonchars } from './escape-nonchars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Keep in sync with LOCALES in src/replica/smart-injector.ts.
const LOCALES = ['en', 'en_US', 'en_GB', 'en_IN', 'en_CA', 'en_AU', 'en_ZA', 'de', 'fr', 'es', 'es_MX', 'it', 'pt_BR', 'ja', 'zh_CN'];
const KEEP = {
  person: ['first_name', 'last_name', 'last_name_pattern', 'sex'],
  company: ['legal_entity_type', 'name_pattern'],
  location: ['city_name', 'city_pattern', 'city_prefix', 'city_suffix', 'country', 'state'],
  commerce: ['product_name', 'department'],
  metadata: null,
};
const slim = {};
for (const code of LOCALES) {
  const def = allLocales[code];
  if (!def) throw new Error('Faker has no locale ' + code);
  const out = {};
  for (const [mod, keys] of Object.entries(KEEP)) {
    if (!def[mod]) continue;
    out[mod] = keys ? Object.fromEntries(keys.filter((k) => def[mod][k] != null).map((k) => [k, def[mod][k]])) : def[mod];
  }
  slim[code] = out;
}
writeFileSync(join(root, 'src/replica/faker-locales.json'), JSON.stringify(slim) + '\n');

await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [escapeNonchars()],
  build: {
    outDir: join(root, 'web/lib'), emptyOutDir: false, target: 'es2020', minify: true, copyPublicDir: false,
    lib: { entry: join(root, 'src/replica/smart-injector.ts'), formats: ['iife'], name: 'VSFaker', fileName: () => 'vs-faker.js' },
  },
});
console.log('Built web/lib/vs-faker.js');
