/* VaultSnip: share links.
   A replica's layout spec is compressed into the URL fragment (#r=…). The fragment never reaches any
   server, so a link is shared without VaultSnip storing anything. What a link carries depends on the
   privacy level the sharer picks, and the receiver cannot switch to a less private mode:
     shape      titles, labels and the relative shapes of the charts
     structure  titles and labels only; every shape, position and magnitude hint is removed
     generic    the layout and chart types only; every piece of text is replaced too
   A link never carries the screenshot, the masked image, OCR text or any real value. */
(function (global) {
  'use strict';

  const LEVELS = ['shape', 'structure', 'generic'];
  const rank = m => Math.max(0, LEVELS.indexOf(m));
  const MAX_TEXT = 2 * 1024 * 1024;            // refuse anything that inflates past 2 MB
  const VERSION = 1;

  /* ---------- privacy levels ---------- */
  // Every number in a spec is a relative shape (0-100), a position or a magnitude hint. None are real
  // values, but together they reproduce the original's ups and downs. Structure-only drops all of them.
  const SHAPE_KEYS = ['shape', 'matrix', 'shapeValue', 'sparkShape', 'boxes', 'scaleHint', 'start', 'end'];
  function stripShapes(o) {
    if (Array.isArray(o)) return o.map(stripShapes);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    Object.keys(o).forEach(k => {
      if (SHAPE_KEYS.includes(k)) return;
      if (k === 'points' && Array.isArray(o.points)) {
        // scatter points are [x, y, size]: keep only how many there were; map points keep their place
        if (o.points.every(Array.isArray)) { out.pointCount = o.points.length; return; }
        out.points = o.points.map(p => { const q = stripShapes(p); return q; });
        return;
      }
      out[k] = stripShapes(o[k]);
    });
    return out;
  }

  // Generic: one consistent placeholder per original string, so filters and cross-highlighting still line up.
  function genericize(spec) {
    const maps = {};
    const name = (kind, label) => s => {
      if (s == null || s === '') return s;
      const m = maps[kind] = maps[kind] || new Map();
      if (!m.has(String(s))) m.set(String(s), label + ' ' + (m.size + 1));
      return m.get(String(s));
    };
    const dim = name('dim', 'Dimension'), mem = name('mem', 'Item'), ser = name('ser', 'Series'), met = name('met', 'Metric');
    const node = name('node', 'Node'), task = name('task', 'Task'), loc = name('loc', 'Location'), tl = name('tl', 'T');
    let vi = 0;
    const measure = m => m && Object.assign({}, m, { name: met(m.name) });
    const s = stripShapes(spec);
    const out = { title: 'Dashboard', subtitle: '', theme: s.theme, rows: [] };
    out.filters = (s.filters || []).map(f => ({ label: dim(f.label), members: (f.members || []).map(mem) }));
    out.rows = (s.rows || []).map(r => ({ height: r.height, visuals: (r.visuals || []).filter(Boolean).map(v => {
      const g = { id: 'v' + (++vi), type: v.type, span: v.span, title: 'Visual ' + vi };
      ['horizontal', 'stacked', 'stackedPercent', 'valueLabels', 'sparkline', 'sorted', 'rowCount', 'pointCount', 'mapKind', 'originalType', 'delta', 'higherIsBetter', 'min', 'max', 'lastIsTotal', 'colorIndex', 'zeroBased'].forEach(k => { if (v[k] !== undefined) g[k] = v[k]; });
      if (v.basemap) g.basemap = v.basemap;
      if (v.measure) g.measure = measure(v.measure);
      if (v.xMeasure) g.xMeasure = measure(v.xMeasure);
      if (v.yMeasure) g.yMeasure = measure(v.yMeasure);
      if (v.dimension) g.dimension = { name: dim(v.dimension.name), members: (v.dimension.members || []).map(mem) };
      if (Array.isArray(v.series)) g.series = v.series.map(x => Object.assign({}, x, { name: ser(x.name), measure: x.measure && measure(x.measure) }));
      if (v.rows && v.rows.members) g.rows = { name: dim(v.rows.name), members: v.rows.members.map(mem) };
      if (Array.isArray(v.columns)) g.columns = v.columns.map(c => Object.assign({}, c, { name: dim(c.name), placeholder: undefined, members: Array.isArray(c.members) ? c.members.map(mem) : undefined }));
      else if (v.columns && v.columns.members) g.columns = { name: dim(v.columns.name), members: v.columns.members.map(mem) };
      if (Array.isArray(v.nodes)) g.nodes = v.nodes.map(node);
      if (Array.isArray(v.links)) g.links = v.links.map(l => ({ source: typeof l.source === 'number' ? l.source : node(l.source), target: typeof l.target === 'number' ? l.target : node(l.target) }));
      if (Array.isArray(v.tasks)) g.tasks = v.tasks.map(t => ({ name: task(t && typeof t === 'object' ? t.name : t) }));
      if (Array.isArray(v.timeLabels)) g.timeLabels = v.timeLabels.map(tl);
      if (Array.isArray(v.points) && !v.points.every(Array.isArray)) g.points = v.points.map(p => ({ name: loc(p && p.name) }));
      if (Array.isArray(v.flows)) g.flows = v.flows.map(f => ({ from: loc(f.from), to: loc(f.to) }));
      return g;
    }) }));
    return out;
  }

  function forLevel(spec, level) {
    if (level === 'generic') return genericize(spec);
    if (level === 'structure') return stripShapes(spec);
    return JSON.parse(JSON.stringify(spec));
  }

  /* ---------- encoding ---------- */
  const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = str => { const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  async function pack(spec, opts) {
    const level = LEVELS.includes(opts.level) ? opts.level : 'shape';
    const body = JSON.stringify({ v: VERSION, level, mode: LEVELS[Math.max(rank(level), rank(opts.mode))], seed: opts.seed | 0, spec: forLevel(spec, level) });
    const stream = new Blob([new TextEncoder().encode(body)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  async function unpack(str) {
    const stream = new Blob([unb64url(str)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(new TextDecoderStream());
    const reader = stream.getReader(); let text = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += value; if (text.length > MAX_TEXT) { reader.cancel(); throw new Error('This link is too large to open.'); } }
    const o = JSON.parse(text);
    if (!o || !o.spec || !Array.isArray(o.spec.rows)) throw new Error('This link does not contain a replica.');
    const level = LEVELS.includes(o.level) ? o.level : 'generic';
    // whatever the link claims, apply its level again so a hand-edited link cannot carry more than it says
    return { level, mode: LEVELS[Math.max(rank(level), rank(o.mode))], seed: (o.seed | 0) || 4127, spec: forLevel(o.spec, level) };
  }

  // Links open the public site, except on a local copy where they open the local copy.
  function base() {
    const local = /^https?:$/.test(location.protocol);
    return (local ? location.origin + location.pathname : (global.DSCReplica && DSCReplica.PRODUCT_URL || 'https://vaultsnip.pages.dev') + '/');
  }
  async function link(spec, opts) { return base() + '#r=' + await pack(spec, opts); }
  function fromHash(hash) { const m = /^#r=([A-Za-z0-9_-]+)$/.exec(hash || ''); return m ? m[1] : null; }

  global.VSShare = { LEVELS, rank, forLevel, pack, unpack, link, fromHash };
})(window);
