import { describe, expect, it } from 'vitest';
import { baselineShift, componentName, crc32, escXml, layoutText, paint, reactPackage, zip } from '../../src/export/design-export';

/** Reads a stored (uncompressed) zip back into { name: text }. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder(), out: Record<string, string> = {};
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    expect(v.getUint16(p + 8, true)).toBe(0); // stored
    const size = v.getUint32(p + 18, true), nlen = v.getUint16(p + 26, true), xlen = v.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nlen)), data = bytes.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    expect(crc32(data)).toBe(v.getUint32(p + 14, true));
    out[name] = dec.decode(data);
    p += 30 + nlen + xlen + size;
  }
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  expect(v.getUint16(end + 10, true)).toBe(Object.keys(out).length);
  return out;
}

describe('design export helpers (Feature 5)', () => {
  it('reads computed colours, and treats transparent as no paint', () => {
    expect(paint('rgb(42, 120, 214)')).toEqual({ color: '#2a78d6', opacity: 1 });
    expect(paint('rgba(0, 0, 0, 0.45)')).toEqual({ color: '#000000', opacity: 0.45 });
    expect(paint('rgb(20 24 30 / 50%)')).toEqual({ color: '#14181e', opacity: 0.5 });
    expect(paint('rgba(0, 0, 0, 0)')).toBeNull();
    expect(paint('transparent')).toBeNull();
    expect(paint('#FFF')).toEqual({ color: '#fff', opacity: 1 });
  });

  it('escapes text for XML and drops characters XML cannot hold', () => {
    expect(escXml('A & B <script> "x" \'y\'')).toBe('A &amp; B &lt;script&gt; &quot;x&quot; &apos;y&apos;');
    expect(escXml('ok\u0000\u0007done')).toBe('okdone');
  });

  it('lays text out like the browser: collapsed spaces, text-transform', () => {
    expect(layoutText('  Sessions\n   by  week ')).toBe(' Sessions by week ');
    expect(layoutText('a  b', 'pre-wrap')).toBe('a  b');
    expect(layoutText('Channel', 'normal', 'uppercase')).toBe('CHANNEL');
  });

  it('names the component from the title, safely', () => {
    expect(componentName('Website Performance')).toBe('WebsitePerformanceReplica');
    expect(componentName('2025 Q3 · Sales <b>')).toBe('Q3SalesBReplica');
    expect(componentName('')).toBe('DashboardReplica');
  });

  it('moves centred chart text onto an alphabetic baseline', () => {
    expect(baselineShift('central')).toBeCloseTo(0.35);
    expect(baselineShift('hanging')).toBeCloseTo(0.8);
    expect(baselineShift('alphabetic')).toBe(0);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid zip with UTF-8 names', () => {
    const files = unzip(zip([{ name: 'a/Ü.txt', text: 'hello' }, { name: 'b.json', text: '{"x":"é"}' }]));
    expect(files).toEqual({ 'a/Ü.txt': 'hello', 'b.json': '{"x":"é"}' });
  });
});

describe('React package (Feature 5)', () => {
  const spec = { title: 'Sales', rows: [{ visuals: [{ id: 'k', type: 'kpi', title: 'Revenue', measure: { name: 'Revenue', format: 'currency' } }] }] };
  const pkg = reactPackage({ spec, mode: 'structure', seed: 77, title: 'Sales Overview', replica: '(function(global){global.DSCReplica={};})(window);', maps: { world: '{"type":"FeatureCollection","features":[]}' } });
  const files = unzip(pkg.zip);

  it('holds the component, the engine, the spec, the maps and a README', () => {
    expect(pkg.name).toBe('SalesOverviewReplica');
    expect(Object.keys(files).sort()).toEqual(['README.md', 'SalesOverviewReplica.jsx', 'maps.json', 'spec.json', 'vaultsnip-replica.js'].map((f) => 'SalesOverviewReplica/' + f).sort());
    expect(JSON.parse(files['SalesOverviewReplica/spec.json'])).toEqual(spec);
    expect(JSON.parse(files['SalesOverviewReplica/maps.json'])).toEqual({ world: { type: 'FeatureCollection', features: [] } });
    expect(files['SalesOverviewReplica/vaultsnip-replica.js']).toMatch(/Apache-2\.0[\s\S]*global\.DSCReplica/);
  });

  it('renders live from spec and seed, with nothing frozen into the code', () => {
    const jsx = files['SalesOverviewReplica/SalesOverviewReplica.jsx'];
    expect(jsx).toMatch(/DSCReplica\.render\(el, spec, \{ mode: level, seed, realistic: false, resetSelection: true \}\)/);
    expect(jsx).toMatch(/export default function SalesOverviewReplica\(\{ seed = 77, mode = EXPORTED \}\)/);
    expect(jsx).not.toMatch(/Revenue/); // values and labels come from spec.json at runtime
  });

  it('ships the realistic-names injector only when the replica uses it, with a runtime prop', () => {
    expect(Object.keys(files).some((f) => f.endsWith('vaultsnip-faker.js'))).toBe(false);
    expect(files['SalesOverviewReplica/SalesOverviewReplica.jsx']).toMatch(/realistic: false, resetSelection/);
    const withNames = unzip(reactPackage({ spec, mode: 'shape', seed: 5, title: 'Sales Overview', replica: '', faker: 'window.VSFaker={};', maps: {} }).zip);
    const jsx = withNames['SalesOverviewReplica/SalesOverviewReplica.jsx'];
    expect(withNames['SalesOverviewReplica/vaultsnip-faker.js']).toMatch(/Faker \(MIT[\s\S]*window\.VSFaker=\{\};/);
    expect(jsx).toMatch(/import '\.\/vaultsnip-faker\.js';\nimport '\.\/vaultsnip-replica\.js';/);
    expect(jsx).toMatch(/\{ seed = 5, mode = EXPORTED, realistic = true \}/);
    expect(jsx).toMatch(/\{ mode: level, seed, realistic, resetSelection: true \}/);
    expect(jsx).toMatch(/\[seed, level, realistic\]/);
  });

  it('ships the search box when given, published on window', () => {
    expect(Object.keys(files).some((f) => f.endsWith('vaultsnip-search.js'))).toBe(false);
    const withSearch = unzip(reactPackage({ spec, mode: 'shape', seed: 5, title: 'Sales Overview', replica: '', search: 'var VSSearch={};', maps: {} }).zip);
    expect(withSearch['SalesOverviewReplica/vaultsnip-search.js']).toMatch(/MiniSearch \(MIT[\s\S]*var VSSearch=\{\};[\s\S]*window\.VSSearch = VSSearch;/);
    expect(withSearch['SalesOverviewReplica/SalesOverviewReplica.jsx']).toMatch(/import '\.\/vaultsnip-search\.js';\nimport '\.\/vaultsnip-replica\.js';/);
    expect(withSearch['SalesOverviewReplica/README.md']).toMatch(/Search this dashboard[\s\S]*MiniSearch/);
  });

  it('cannot show a less private mode than it was exported at', () => {
    const jsx = files['SalesOverviewReplica/SalesOverviewReplica.jsx'];
    expect(jsx).toMatch(/const EXPORTED = "structure";/);
    expect(jsx).toMatch(/LEVELS\[Math\.max\(LEVELS\.indexOf\(mode\), LEVELS\.indexOf\(EXPORTED\)\)\]/);
    expect(reactPackage({ spec, mode: 'nonsense' as never, seed: 1, replica: '', maps: {} }).files[0].text).toMatch(/const EXPORTED = "generic";/);
  });
});
