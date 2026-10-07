// Static checks for VaultSnip: JavaScript syntax, JSON validity, manifest sanity,
// version consistency and that every local file the app references exists.
// Usage: node tools/check.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const ok = msg => console.log('  ✓ ' + msg);
const fail = msg => { errors.push(msg); console.log('  ✗ ' + msg); };

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!['lib', 'node_modules', 'lang'].includes(n)) walk(p, out); } else out.push(p);
  }
  return out;
}

console.log('JavaScript syntax');
for (const f of [...walk(join(root, 'web')), ...walk(join(root, 'extension')), ...walk(join(root, 'tools'))].filter(f => ['.js', '.mjs'].includes(extname(f)))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok(f.slice(root.length + 1)); }
  catch (e) { fail(`${f.slice(root.length + 1)}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`); }
}

console.log('JSON files');
const maps = readdirSync(join(root, 'web', 'maps')).filter(f => f.endsWith('.json'));
for (const f of maps) {
  try {
    const fc = JSON.parse(readFileSync(join(root, 'web', 'maps', f), 'utf8'));
    if (fc.type !== 'FeatureCollection' || !fc.features.length) throw new Error('not a non-empty FeatureCollection');
    const bad = fc.features.filter(x => !x.properties || !x.properties.name || !x.geometry);
    if (bad.length) throw new Error(bad.length + ' features without name or geometry');
    ok(`maps/${f} (${fc.features.length} regions)`);
  } catch (e) { fail(`maps/${f}: ${e.message}`); }
}
const replica = readFileSync(join(root, 'web', 'replica.js'), 'utf8');
const listed = (replica.match(/const MAP_LIST = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
for (const m of listed) if (!maps.includes(m + '.json')) fail(`MAP_LIST names "${m}" but web/maps/${m}.json is missing`);
for (const f of maps) if (!listed.includes(f.replace('.json', ''))) fail(`web/maps/${f} is not in MAP_LIST`);
if (listed.length === maps.length) ok('MAP_LIST matches web/maps');

console.log('Extension manifest');
const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3'); else ok('Manifest V3');
const perms = manifest.permissions || [];
if (perms.some(p => p !== 'activeTab') || manifest.host_permissions) fail('only the activeTab permission is allowed (privacy promise)'); else ok('activeTab only');

console.log('Versions');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const fb = (readFileSync(join(root, 'web', 'feedback.js'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
if (pkg === manifest.version && pkg === fb) ok(`package.json, manifest and feedback.js all ${pkg}`);
else fail(`version mismatch: package.json ${pkg}, manifest ${manifest.version}, feedback.js ${fb}`);
if (changelog.includes(`## [${pkg}]`)) ok(`CHANGELOG has ${pkg}`); else fail(`CHANGELOG.md has no section for ${pkg}`);

console.log('Local references in web/index.html');
const html = readFileSync(join(root, 'web', 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
  if (/^(https?:|mailto:|data:|\/\/)/.test(ref)) continue;
  if (existsSync(join(root, 'web', ref))) ok(ref); else fail(`index.html references missing file ${ref}`);
}

console.log('Privacy guard: no third-party trackers in web/');
const trackers = /googletagmanager|google-analytics|gtag\(|sentry|logrocket|hotjar|mixpanel|segment\.com|amplitude\.com|clarity\.ms/i;
for (const f of walk(join(root, 'web')).filter(f => /\.(js|html)$/.test(f))) {
  if (trackers.test(readFileSync(f, 'utf8'))) fail(`possible tracker in ${f.slice(root.length + 1)}`);
}
if (!errors.some(e => e.startsWith('possible tracker'))) ok('none found');

console.log(errors.length ? `\n${errors.length} problem(s) found.` : '\nAll checks passed.');
process.exit(errors.length ? 1 : 0);
