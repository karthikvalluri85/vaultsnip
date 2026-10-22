// Downloads the benchmark images listed in truth.json into a local folder, for evaluation on this machine only
// (developer tool). The images are not redistributed: each keeps its source's terms, recorded next to it in truth.json.
//   node tools/layout-bench/fetch.mjs [bench dir, default .bench]
// Tableau Public views are fetched as the static image Tableau Public serves for each view. An image whose size differs
// from the annotated size is reported, since its boxes would no longer line up.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_BENCH, ROOT, items } from './items.mjs';

const bench = process.argv[2] || DEFAULT_BENCH;

/** A Tableau Public view page → the PNG Tableau Public serves for it; any other URL is used as it is. */
const imageUrl = (source) => {
  const m = /public\.tableau\.com\/app\/profile\/[^/]+\/viz\/([^/]+)\/([^/?#]+)/.exec(source);
  return m ? `https://public.tableau.com/static/images/${m[1].slice(0, 2)}/${m[1]}/${m[2]}/1.png` : source;
};
/** Width and height from a PNG header. */
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

const all = items(bench);
let ok = 0;
for (const it of all) {
  await mkdir(dirname(it.file), { recursive: true });
  try {
    if (it.source.startsWith('web/')) await copyFile(join(ROOT, it.source.split(' ')[0]), it.file);   // VaultSnip's own sample
    else {
      const res = await fetch(imageUrl(it.source));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(it.file, Buffer.from(await res.arrayBuffer()));
    }
    const size = pngSize(await readFile(it.file));
    const off = it.size && (size[0] !== it.size[0] || size[1] !== it.size[1]);
    console.log(`  ${off ? '!' : '✓'} ${it.id} ${size.join('×')}${off ? ` (annotated at ${it.size.join('×')}: boxes will not line up)` : ''}`);
    if (!off) ok++;
  } catch (e) {
    console.log(`  ✗ ${it.id}: ${e.message}`);
  }
}
console.log(`${ok}/${all.length} images ready in ${bench}`);
