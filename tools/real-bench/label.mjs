// Label your own screenshots for the masking benchmark, privately (developer tool, no network).
//   node tools/real-bench/label.mjs [--dir .bench/real] [--port 8765]
// Put screenshots (PNG, JPG, WebP) in the folder, open the address it prints, and drag a box over every sensitive item:
// a name, a number, an ID, an email. Boxes over safe labels are optional (they measure over-masking). Each image's
// labels are saved beside it as <name>.truth.json, in the format tools/synth-bench/run.mjs scores:
//   node tools/synth-bench/run.mjs --dir .bench/real
// Privacy: the server listens on 127.0.0.1 only and serves only this folder and the labeller page. .bench/ is git-ignored,
// so neither the screenshots nor their labels can be committed; nothing is sent anywhere.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'real')), PORT = +arg('--port', 8765);
const IMG = /\.(png|jpe?g|webp)$/i, TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
await mkdir(DIR, { recursive: true });

const idOf = f => basename(f).replace(IMG, '');
// only plain file names inside the folder: nothing else on the disk can be read or written through this server
const safeName = n => typeof n === 'string' && /^[\w .()-]{1,120}$/.test(n) && !n.includes('..');
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, await readFile(join(HERE, 'label.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/list') {
      const files = (await readdir(DIR)).filter(f => IMG.test(f)).sort();
      const list = await Promise.all(files.map(async f => {
        const truth = await readFile(join(DIR, idOf(f) + '.truth.json'), 'utf8').then(JSON.parse, () => null);
        return { file: f, id: idOf(f), boxes: truth ? truth.words.length : 0, truth };
      }));
      return send(res, 200, JSON.stringify(list));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      const name = decodeURIComponent(url.pathname.slice(5));
      if (!safeName(name) || !IMG.test(name)) return send(res, 404, '{}');
      return send(res, 200, await readFile(join(DIR, name)), TYPES[extname(name).toLowerCase()]);
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 5e6) throw new Error('too large'); }
      const t = JSON.parse(body);
      if (!safeName(t.file) || !IMG.test(t.file) || !(await stat(join(DIR, t.file)).catch(() => null))) return send(res, 400, '{"error":"unknown image"}');
      const KINDS = new Set(['name', 'org', 'number', 'id', 'email', 'place', 'product', 'other', 'safe']);
      const words = (t.words || []).filter(w => KINDS.has(w.kind) && [w.x, w.y, w.w, w.h].every(Number.isFinite) && w.w > 0 && w.h > 0)
        .map(w => ({ text: String(w.text || '').slice(0, 200), x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h),
          kind: w.kind === 'safe' ? 'label' : w.kind, sensitive: w.kind !== 'safe', rotated: false, clipped: false, ink: true }));
      const truth = { id: idOf(t.file), file: t.file, width: Math.round(t.width), height: Math.round(t.height),
        style: { theme: 'real', font: '-', size: 0, dpr: 1, format: extname(t.file).slice(1).toLowerCase() }, labelledBy: 'hand', words };
      await writeFile(join(DIR, truth.id + '.truth.json'), JSON.stringify(truth, null, 1));
      return send(res, 200, JSON.stringify({ saved: words.length }));
    }
    send(res, 404, '{}');
  } catch (e) { send(res, 500, JSON.stringify({ error: e.message })); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Labelling screenshots in ${DIR}\nOpen http://127.0.0.1:${PORT}/ (this computer only). Ctrl+C to stop.`));
