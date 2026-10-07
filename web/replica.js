/* VaultSnip: replica engine.
   Turns a dashboard spec (structure only, no real values) into an interactive,
   watermarked page with synthetic data. Shared by the app and every exported file.
   Needs window.echarts. No network calls. */
(function (global) {
  'use strict';

  const PRODUCT_NAME = 'VaultSnip';
  const PRODUCT_URL = 'https://vaultsnip.pages.dev';
  const FOOTER_TEXT = 'Generated with VaultSnip (Zero-Data BI Replica)';
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  /* ---------- seeded randomness ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------- formatting ---------- */
  // Formatters never throw: a value that is not a finite number shows as a dash (issue #7).
  const num = v => (typeof v === 'number' ? v : (v == null || v === '' || v === '-' ? NaN : Number(v)));
  function abbr(v, d) {
    v = num(v);
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(d ?? 1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(d ?? 1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(d ?? 0) + 'K';
    if (a >= 100) return Math.round(v).toLocaleString('en-US');
    return v.toFixed(d ?? (a < 10 ? 1 : 0));
  }
  function fmt(v, measure, generic) {
    v = num(v);
    if (!Number.isFinite(v)) return '–';
    const f = (measure && measure.format) || 'number';
    const unit = measure && measure.unit && !generic ? ' ' + String(measure.unit) : '';
    if (f === 'percent') return v.toFixed(1) + (generic ? '' : '%');
    if (f === 'currency') return (generic ? '' : (measure.currency || '$')) + abbr(v);
    if (f === 'ratio') { const o = num(measure.outOf); return v.toFixed(2) + (o > 0 && !generic ? ' / ' + o : ''); }
    if (f === 'integer' || f === 'duration') return Math.round(v).toLocaleString('en-US') + unit;
    return abbr(v) + unit;
  }
  // Typical size of a duration by its unit, so "38 min" does not come out as "4,200 min".
  const DURATION = { ms: 900, s: 40, sec: 40, secs: 40, seconds: 40, min: 40, mins: 40, minutes: 40, h: 10, hr: 10, hrs: 10, hours: 10, d: 12, day: 12, days: 12, wk: 4, weeks: 4 };

  /* ---------- synthetic data ---------- */
  // Each measure gets a hidden scale unrelated to the source. Shapes (0..100) come from the spec.
  let SCALES = {}, HINTS = {};
  const measureKey = m => m ? (String(m.name || '').toLowerCase() + '|' + (m.format || '')) : '';
  function scaleFor(measure, r) {
    const key = measureKey(measure);
    if (key && SCALES[key]) return SCALES[key];
    if (measure && !(num(measure.scaleHint) > 0) && HINTS[key]) measure = Object.assign({}, measure, { scaleHint: HINTS[key] });
    const v = rawScale(measure, r);
    if (key) SCALES[key] = v;
    return v;
  }
  function rawScale(measure, r) {
    const hint = measure ? num(measure.scaleHint) : NaN;
    if (hint > 0) return hint * 1.6 * (0.8 + r() * 0.4);
    const f = (measure && measure.format) || 'number';
    if (f === 'percent') return 100;
    if (f === 'ratio') return num(measure.outOf) > 0 ? num(measure.outOf) : 5;
    if (f === 'duration') return (DURATION[String(measure.unit || '').toLowerCase()] || 30) * (0.7 + r() * 0.6);
    if (f === 'currency') return Math.pow(10, 4 + r() * 3);
    if (f === 'integer') return Math.pow(10, 1.5 + r() * 2.5);
    return Math.pow(10, 2 + r() * 4);
  }
  function shapeArray(shape, n, mode, r, kind) {
    if (mode === 'shape' && Array.isArray(shape) && shape.length === n) {
      return shape.map(v => Math.max(0.5, Number(v) || 0) * (0.96 + r() * 0.08));
    }
    if (kind === 'trend') { let w = 50 + r() * 30; return Array.from({ length: n }, () => (w = Math.max(10, Math.min(100, w + (r() - 0.45) * 22)))); }
    return Array.from({ length: n }, () => 15 + r() * 85);
  }

  function labelsFor(spec, mode) {
    const generic = mode === 'generic';
    const dimMap = new Map(); let dimCount = 0; let measCount = 0; const measMap = new Map();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return {
      generic,
      member(dimName, m, i) { return generic ? (dimShort(dimName) + ' ' + (i + 1)) : m; },
      dim(name) { if (!generic) return name; if (!dimMap.has(name)) dimMap.set(name, 'Dimension ' + (++dimCount)); return dimMap.get(name); },
      meas(name) { if (!generic) return name; if (!measMap.has(name)) measMap.set(name, 'Metric ' + letters[measCount++ % 26]); return measMap.get(name); },
      title(t, i) { return generic ? 'Visual ' + (i + 1) : t; }
    };
    function dimShort(n) { if (!dimMap.has(n)) dimMap.set(n, 'Dimension ' + (++dimCount)); return dimMap.get(n).replace('Dimension ', 'Item ').replace(/ \d+$/, ''); }
  }

  /* ---------- maps ---------- */
  // Region outlines live in maps/<name>.json (Natural Earth, simplified; see tools/maps). They load on first use
  // and are embedded in exports. Each feature has name, a (aliases), cp (label point), bb (main landmass bbox).
  const MAPS = {}, MAP_LOADING = {}, MAP_FAILED = {};
  const MAP_LIST = ['world', 'europe', 'usa', 'canada', 'mexico', 'brazil', 'uk', 'france', 'germany', 'italy', 'spain', 'india', 'china', 'japan', 'australia', 'south-africa'];
  const MAP_ALIAS = { 'us': 'usa', 'u s': 'usa', 'united states': 'usa', 'united states of america': 'usa', 'america': 'usa', 'united kingdom': 'uk', 'great britain': 'uk', 'britain': 'uk', 'gb': 'uk', 'england': 'uk',
    'south africa': 'south-africa', 'za': 'south-africa', 'countries': 'world', 'global': 'world', 'worldwide': 'world', 'emea': 'world', 'apac': 'world', 'eu': 'europe', 'deutschland': 'germany', 'bharat': 'india' };
  let MAP_BASE = 'maps/';
  try { const cs = document.currentScript; if (cs && cs.src) MAP_BASE = new URL('maps/', cs.src).href; } catch (e) { /* inline copy: maps are embedded */ }
  const fold = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function mapName(b) {
    const f = fold(b || 'world'), g = f.replace(/ (states|state|provinces|regions|counties|prefectures|countries|map)$/, '');
    for (const x of [f, g]) { if (MAP_LIST.includes(x.replace(/ /g, '-'))) return x.replace(/ /g, '-'); if (MAP_ALIAS[x]) return MAP_ALIAS[x]; }
    return 'world';
  }
  function addMap(name, fc) {
    if (typeof fc === 'string') fc = JSON.parse(fc);
    const idx = {}, feats = {};
    fc.features.forEach(f => { feats[f.properties.name] = f.properties; idx[fold(f.properties.name)] = f.properties.name; });
    fc.features.forEach(f => (f.properties.a || []).forEach(a => { if (!(a in idx)) idx[a] = f.properties.name; }));
    let bb = [180, 90, -180, -90];
    Object.values(feats).forEach(p => { if (p.bb) bb = [Math.min(bb[0], p.bb[0]), Math.min(bb[1], p.bb[1]), Math.max(bb[2], p.bb[2]), Math.max(bb[3], p.bb[3])]; });
    const groups = {}; const g0 = (fc.vs && fc.vs.groups) || {}; Object.keys(g0).forEach(g => { groups[fold(g)] = g0[g]; });
    global.echarts.registerMap('vs-' + name, fc);
    MAPS[name] = { idx, feats, groups, moves: (fc.vs && fc.vs.moves) || [], bb: name === 'world' ? [-170, -56, 180, 84] : bb, names: Object.keys(feats) };
  }
  function loadMap(name) {
    if (MAPS[name]) return Promise.resolve();
    if (!MAP_LOADING[name]) {
      MAP_LOADING[name] = fetch(MAP_BASE + name + '.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(fc => addMap(name, fc)).catch(() => { MAP_FAILED[name] = true; });
    }
    return MAP_LOADING[name];
  }
  function mapsUsed(spec) {
    const s = new Set();
    (spec.rows || []).forEach(r => (r.visuals || []).forEach(v => { if (v && /^(map|choropleth|filled map)$/i.test(String(v.type || '').trim())) s.add(mapName(v.basemap)); }));
    return Array.from(s);
  }
  function resolveRegions(M, raw) {
    const f = fold(raw); if (!f) return [];
    const tries = [f, f.replace(/ & /g, ' and '), f.replace(/^the /, ''), f.replace(/ (state|province|region|territory|county|prefecture|district)$/, ''), f.replace(/^(state|province|region|county) of /, ''), f.replace(/\bst\b/g, 'saint')];
    for (const t of tries) { if (M.idx[t]) return [M.idx[t]]; if (M.groups[t]) return M.groups[t].filter(n => M.feats[n]); }
    return [];
  }
  function movePoint(M, c) {
    for (const m of M.moves) { const b = m.box; if (c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3]) return [m.to[0] + (c[0] - m.from[0]) * m.k, m.to[1] + (c[1] - m.from[1]) * m.k]; }
    return c;
  }
  function centroid(M, names) {
    const cps = names.map(n => M.feats[n] && M.feats[n].cp).filter(Boolean);
    if (!cps.length) return null;
    return [cps.reduce((a, c) => a + c[0], 0) / cps.length, cps.reduce((a, c) => a + c[1], 0) / cps.length];
  }
  function mapKind(v) {
    const k = fold(v.mapKind || '');
    if (/bubble|symbol|point|pin|marker|proportional|dot/.test(k)) return 'bubble';
    if (/density|heat/.test(k)) return 'density';
    if (/flow|path|line|route|origin|spider|connection/.test(k)) return 'flow';
    if (k) return 'filled';
    if (Array.isArray(v.flows) && v.flows.length) return 'flow';
    if (Array.isArray(v.points) && v.points.length) return 'bubble';
    return 'filled';
  }
  const mapDimName = v => (v.dimension && v.dimension.name) || (mapKind(v) === 'filled' ? 'Region' : 'Location');
  function mapMembers(v) {
    const pts = (Array.isArray(v.points) ? v.points : []).filter(p => p && typeof p === 'object' && !Array.isArray(p));
    if (mapKind(v) !== 'filled' && pts.length) return pts.map((p, i) => p.name || ('Location ' + (i + 1)));
    const m = (v.dimension && v.dimension.members) || [];
    if (m.length) return m;
    if (Array.isArray(v.flows)) { const s = []; v.flows.forEach(f => [f.from, f.to].forEach(x => { if (x != null && !s.includes(String(x))) s.push(String(x)); })); return s; }
    return [];
  }

  // Dimension names that mean the same thing ("Countries", "Country/Region", "Country name") share one filter key.
  function canonDim(x) {
    const f = fold(x).replace(/\b(name|names|code|codes|label)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!f) return String(x || '').trim().toLowerCase();
    if (/\bcountr(y|ies)\b|\bnations?\b/.test(f)) return 'country';
    if (/^(us )?(states?|provinces?|state province|states provinces)$/.test(f)) return 'state';
    if (/^(cit(y|ies)|metros?|towns?)$/.test(f)) return 'city';
    return f.split(' ').map(w => w.length > 3 ? w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1') : w).join(' ');
  }
  // Members match when they are the same text or the same place ("UK" and "United Kingdom").
  function geoKey(x) {
    const f = fold(x); if (!f) return null;
    for (const n of ['world'].concat(Object.keys(MAPS).filter(k => k !== 'world'))) { const M = MAPS[n]; if (M && M.idx[f]) return n + ':' + M.idx[f]; }
    return null;
  }
  function sameMember(a, b) {
    if (a === b) return true;
    const fa = fold(a), fb = fold(b);
    if (fa && fa === fb) return true;
    const ga = geoKey(a); return !!ga && ga === geoKey(b);
  }
  const selHas = (sel, m) => !!sel && sel.some(x => sameMember(x, m));

  function mapOption(v, ctx, base, tooltip, meas, scale) {
    const { L, mode, r, t, colors } = ctx;
    const F = ctx.filter;
    const name = mapName(v.basemap);
    if (!MAPS[name]) return { _placeholder: MAP_FAILED[name] ? 'The map outline could not be loaded. Open the app over http(s) rather than as a local file.' : 'Loading map outline…' };
    const M = MAPS[name], generic = L.generic, kind = mapKind(v);
    let dimName = mapDimName(v), dimKey = F.dk(dimName);
    const pts = (Array.isArray(v.points) ? v.points : []).filter(p => p && typeof p === 'object' && !Array.isArray(p));
    let raws = mapMembers(v);
    let seriesShape = v.series && v.series[0] && Array.isArray(v.series[0].shape) ? v.series[0].shape : [];
    // When the map's own labels were masked or are missing, borrow the places the rest of the dashboard uses
    // (filters, bars, tables), so the map and the other visuals filter each other.
    const placed = list => list.filter(m => resolveRegions(M, m).length).length;
    if (!pts.length && placed(raws) < Math.max(1, Math.ceil(raws.length / 2))) {
      const cands = (F.dims || []).map(d => ({ d, hit: placed(d.members) })).filter(c => c.hit >= 2 && c.hit >= c.d.members.length * 0.6)
        .sort((a, b) => ((b.d.key === dimKey) - (a.d.key === dimKey)) || (b.hit - a.hit));
      if (cands.length) { const d = cands[0].d; dimName = d.name; dimKey = d.key; raws = d.members; seriesShape = d.shape || []; }
    }
    let locs = raws.map((raw, i) => {
      const p = kind !== 'filled' && pts.length ? pts[i] : null;
      const l = { raw, shape: p ? p.shape : seriesShape[i], regions: resolveRegions(M, raw), coord: null };
      if (p && isFinite(p.lon) && isFinite(p.lat) && p.lon !== null && p.lat !== null) l.coord = movePoint(M, [+p.lon, +p.lat]);
      else if (l.regions.length) l.coord = centroid(M, l.regions);
      return l;
    });
    if (!locs.length) locs = Array.from({ length: 8 }, (_, i) => ({ raw: 'Location ' + (i + 1), regions: [], coord: null }));
    // Generic mode, or names that match nothing on this map: place each member on a seeded random region instead.
    const unmatched = locs.filter(l => kind === 'filled' ? !l.regions.length : !l.coord);
    if (generic || unmatched.length === locs.length) {
      const rr = rng(hashStr(v.id + '|' + name + '|' + (generic ? 'g' : 's')));
      const area = n => { const b = M.feats[n].bb || [0, 0, 0, 0]; return (b[2] - b[0]) * (b[3] - b[1]); };
      const pool = M.names.slice().sort((a, b) => area(b) - area(a)).slice(0, Math.max(locs.length, Math.ceil(M.names.length * (name === 'world' ? 0.45 : 0.8))));
      locs.forEach(l => { const n = pool.splice(Math.floor(rr() * pool.length), 1)[0]; l.regions = n ? [n] : []; l.coord = n ? M.feats[n].cp : null; });
    }
    const n = locs.length;
    const allShapes = locs.every(l => typeof l.shape === 'number') ? locs.map(l => l.shape) : null;
    const sel = F.sel(dimKey);
    const selRegions = new Set(); (sel || []).forEach(x => resolveRegions(M, x).forEach(rn => selRegions.add(rn)));
    const matchesSel = l => selHas(sel, l.raw) || l.regions.some(rn => selRegions.has(rn));
    const ownMatch = !!(sel && sel.length) && locs.some(matchesSel);
    const isOn = l => !ownMatch || matchesSel(l);
    const vals0 = shapeArray(allShapes, n, mode, r, 'cat').map(x => x / 100 * scale);
    const vals = vals0.map((x, i) => x * F.factor(v.id, ownMatch ? [dimKey] : [], i));
    const label = i => L.member(dimName, locs[i].raw, i);
    const mx = Math.max(1e-9, ...vals0); // unfiltered maximum, so filters elsewhere visibly lighten and shrink the map
    const note = (!generic && unmatched.length && unmatched.length < locs.length) ? 'Not on this map: ' + unmatched.map(l => l.raw).join(', ') : '';

    // Zoom world and Europe maps to the part that holds data, like BI tools do.
    const view = (() => {
      if (!['world', 'europe'].includes(name)) return {};
      let b = null;
      const add = q => { if (!q) return; b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q.slice(); };
      locs.forEach(l => { if (kind === 'filled') l.regions.forEach(rn => add(M.feats[rn] && M.feats[rn].bb)); else if (l.coord) add([l.coord[0], l.coord[1], l.coord[0], l.coord[1]]); });
      if (!b) return {};
      const w = Math.max(10, b[2] - b[0]), h = Math.max(7, b[3] - b[1]), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      const full = M.bb, z = Math.min((full[2] - full[0]) / (w * 1.25), (full[3] - full[1]) / (h * 1.25));
      return z < 1.3 ? {} : { center: [cx, cy], zoom: Math.min(z, 9) };
    })();
    const midLat = view.center ? view.center[1] : (M.bb[1] + M.bb[3]) / 2;
    const aspectScale = name === 'world' && !view.center ? 0.75 : Math.max(0.55, Math.min(1, Math.cos(midLat * Math.PI / 180)));
    const area = { map: 'vs-' + name, roam: false, aspectScale, top: 6, bottom: kind === 'filled' ? 30 : 6, left: 6, right: 6, label: { show: false } };
    const geo = Object.assign({}, area, view, { silent: true, itemStyle: { areaColor: t.grid, borderColor: t.surface, borderWidth: 0.6 } });
    const meta = { pairs: p => (p && p.data && p.data.member != null) ? [[dimKey, p.data.member]] : [] };
    const tipLoc = p => (p.data && p.data.v != null) ? `${escH(p.data.label)}<br><b>${fmt(p.data.v, meas, generic)}</b>` : '';

    if (kind === 'filled') {
      const data = [];
      locs.forEach((l, i) => l.regions.forEach(rn => data.push({ name: rn, value: vals[i], v: vals[i], member: l.raw, label: label(i) + (!generic && l.regions.length > 1 ? ' · ' + rn : ''), itemStyle: isOn(l) ? undefined : { opacity: 0.22 } })));
      return Object.assign(base, { _meta: meta, _note: note,
        tooltip: Object.assign({}, tooltip, { formatter: p => (p.data && p.data.v != null) ? tipLoc(p) : (generic ? '' : escH(p.name)) }),
        visualMap: { seriesIndex: 0, min: 0, max: mx, calculable: false, orient: 'horizontal', left: 4, bottom: 2, itemHeight: 110, itemWidth: 9, text: [fmt(mx, meas, generic), fmt(0, meas, generic)], textGap: 6, textStyle: { color: t.muted, fontSize: 10 }, inRange: { color: ['#dbe8f8', colors[0], '#13355f'] }, formatter: x => fmt(x, meas, generic) },
        series: [Object.assign({ type: 'map', selectedMode: false, itemStyle: { areaColor: t.grid, borderColor: t.surface, borderWidth: 0.6 }, emphasis: { label: { show: false }, itemStyle: { areaColor: colors[1], borderColor: t.ink, borderWidth: 0.8 } }, data }, area, view)]
      });
    }
    const points = locs.map((l, i) => l.coord ? { name: label(i), label: label(i), value: [l.coord[0], l.coord[1], vals[i]], v: vals[i], member: l.raw, itemStyle: { opacity: isOn(l) ? 0.82 : 0.14 } } : null).filter(Boolean);
    const dots = (size, color) => ({ type: 'scatter', coordinateSystem: 'geo', data: points, symbolSize: size, itemStyle: { color, borderColor: t.surface, borderWidth: 1 }, emphasis: { scale: 1.2 }, tooltip: { formatter: tipLoc } });

    if (kind === 'bubble') {
      return Object.assign(base, { _meta: meta, _note: note, tooltip: Object.assign({}, tooltip), geo,
        series: [dots(d => 7 + Math.sqrt(d[2] / mx) * 26, colors[0])] });
    }
    if (kind === 'density') {
      const heat = [], spread = Math.max(0.15, (M.bb[2] - M.bb[0]) / 70) / Math.max(1, view.zoom || 1);
      const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
      locs.forEach((l, i) => { if (!l.coord || !isOn(l)) return; const k = 14 + Math.round(30 * vals[i] / mx); for (let j = 0; j < k; j++) heat.push([l.coord[0] + gauss() * spread, l.coord[1] + gauss() * spread * 0.75, 0.4 + r()]); });
      return Object.assign(base, { _meta: meta, _note: note, tooltip: Object.assign({}, tooltip), geo,
        visualMap: { show: false, seriesIndex: 0, min: 0, max: 4, inRange: { color: ['rgba(255,214,102,0)', '#f6c344', '#eb6834', '#b3262b'] } },
        series: [{ type: 'heatmap', coordinateSystem: 'geo', data: heat, pointSize: 9, blurSize: 16, silent: true }, dots(16, 'rgba(0,0,0,0)')] });
    }
    // flow: origin → destination lines
    const byRaw = {}; locs.forEach((l, i) => { byRaw[fold(l.raw)] = i; });
    let flows = (Array.isArray(v.flows) ? v.flows : []).map(f => ({ a: byRaw[fold(f.from)], b: byRaw[fold(f.to)], shape: f.shape })).filter(f => f.a != null && f.b != null && f.a !== f.b);
    if (!flows.length) flows = locs.slice(1).map((_, i) => ({ a: 0, b: i + 1 }));
    const fShape = flows.every(f => typeof f.shape === 'number') ? flows.map(f => f.shape) : null;
    const fv0 = shapeArray(fShape, flows.length, mode, r, 'cat').map(x => x / 100 * scale);
    const fv = fv0.map((x, i) => x * F.factor(v.id, ownMatch ? [dimKey] : [], i + 100));
    const fmx = Math.max(1e-9, ...fv0);
    const lines = flows.filter(f => locs[f.a].coord && locs[f.b].coord).map((f, i) => {
      const on = isOn(locs[f.a]) || isOn(locs[f.b]);
      return { coords: [locs[f.a].coord, locs[f.b].coord], v: fv[i], member: locs[f.a].raw, label: label(f.a) + ' → ' + label(f.b), lineStyle: { width: 1 + 5 * fv[i] / fmx, opacity: on ? 0.75 : 0.1 } };
    });
    return Object.assign(base, { _meta: meta, _note: note, tooltip: Object.assign({}, tooltip), geo,
      series: [{ type: 'lines', coordinateSystem: 'geo', data: lines, lineStyle: { color: colors[0], curveness: 0.25 }, effect: { show: true, period: 5, trailLength: 0, symbol: 'circle', symbolSize: 4, color: colors[1] }, tooltip: { formatter: tipLoc } },
        dots(9, colors[1])] });
  }

  /* ---------- visual builders ---------- */
  function themeVars(root) {
    const cs = getComputedStyle(root);
    const g = n => cs.getPropertyValue(n).trim();
    return { ink: g('--rp-ink') || '#14181e', muted: g('--rp-muted') || '#5a6370', line: g('--rp-line') || '#dde1e7', grid: g('--rp-grid') || '#eef0f3', surface: g('--rp-surface') || '#fff' };
  }

  function axisBase(t) {
    return {
      axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
      splitLine: { lineStyle: { color: t.grid } }, nameTextStyle: { color: t.muted }
    };
  }

  function buildOption(v, ctx) {
    const { L, mode, r, t, colors } = ctx;
    const F = ctx.filter || { sel: () => null, factor: () => 1, dk: x => x };
    const generic = L.generic;
    const meas = v.measure || { name: 'Value', format: 'number' };
    const scale = scaleFor(meas, r);
    const tooltip = { trigger: 'item', backgroundColor: t.surface, borderColor: t.line, textStyle: { color: t.ink, fontSize: 12 }, valueFormatter: x => fmt(x, meas, generic) };
    const legend = { top: 0, textStyle: { color: t.muted, fontSize: 11 }, type: 'scroll' };
    const dimName = v.dimension && v.dimension.name || 'Category';
    const membersRaw = (v.dimension && v.dimension.members && v.dimension.members.length) ? v.dimension.members : ['A', 'B', 'C', 'D', 'E'];
    let members = membersRaw.map((m, i) => L.member(dimName, m, i));
    let n = members.length;
    const dimOpacity = () => 1;
    const dimKey = F.dk(dimName);
    const rawByLabel = {}; members.forEach((m, i) => { rawByLabel[m] = membersRaw[i]; });
    let seriesList = (v.series && v.series.length) ? v.series : [{ name: meas.name, shape: null }];
    const seriesKeys = [];
    if (seriesList.length > 1 && F.active) F.active.forEach(k => {
      const selS = F.sel(k) || [];
      const hit = seriesList.filter(s => selS.includes(s.name));
      if (hit.length) { seriesList = hit; seriesKeys.push(k); }
      else if (F.members(k).some(m => seriesList.some(s => s.name === m))) seriesKeys.push(k);
    });
    const isTrend = ['line', 'area', 'combo'].includes(v.type) || /month|week|day|date|year|quarter|period|time/i.test(dimName);
    // a combo series with its own measure (a % line over $ bars) gets its own scale and, below, its own axis
    const ownMeas = s => (v.type === 'combo' && s && s.measure && measureKey(s.measure) !== measureKey(meas)) ? s.measure : null;
    let vals = seriesList.map(s => shapeArray(s.shape, n, mode, r, isTrend ? 'trend' : 'cat').map(x => x / 100 * (ownMeas(s) ? scaleFor(ownMeas(s), r) : scale)));
    // cross-filtering: other dimensions' selections scale this visual; its own dimension's selection keeps only chosen members
    const filterable = ['bar', 'column', 'histogram', 'line', 'area', 'combo', 'pie', 'donut', 'treemap', 'funnel', 'boxplot'].includes(v.type);
    const sel = filterable ? F.sel(dimKey) : null;
    const keep = (sel && sel.length) ? membersRaw.map((m, i) => i).filter(i => selHas(sel, membersRaw[i])) : [];
    // a selection on this visual's own dimension that matches none of its members scales it like any other filter
    vals = vals.map(a => a.map((x, i) => x * F.factor(v.id, (keep.length || !(F.sel(dimKey) || []).length ? [dimKey] : []).concat(seriesKeys), i)));
    if (keep.length) { members = keep.map(i => members[i]); vals = vals.map(a => keep.map(i => a[i])); n = members.length; }
    let meta = { pairs: p => (p && p.name != null && rawByLabel[p.name] != null) ? [[dimKey, rawByLabel[p.name]]] : [] };
    const base = { color: colors, animation: !ctx.quiet, animationDuration: 300, textStyle: { fontFamily: 'inherit' } };

    // every category label shown; about 95 px per grid column, long labels in narrow slots rotate rather than overlap
    function catLabels(v, members, t, horizontal) {
      const n = members.length; if (n > 12) return null;
      const slot = Math.max(1, (num(v.span) || 6)) * 95 / n, longest = Math.max(...members.map(m => String(m).length));
      const crowded = !horizontal && longest * 6.5 > slot;
      return { color: t.muted, fontSize: 11, interval: 0, hideOverlap: false, rotate: crowded ? 35 : 0, width: crowded ? 90 : Math.max(40, slot - 6), overflow: 'truncate' };
    }
    switch (v.type) {
      case 'bar': case 'column': case 'histogram': case 'line': case 'area': case 'combo': {
        // A "column" is vertical by definition; only a "bar" can run horizontally (the AI sometimes sends both).
        const horizontal = v.type === 'bar' && v.horizontal !== false && v.horizontal !== 'false';
        const cat = Object.assign(axisBase(t), { type: 'category', data: members, name: '' });
        const lab = catLabels(v, members, t, horizontal); if (lab) cat.axisLabel = lab;
        const val = Object.assign(axisBase(t), { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, meas, generic) } });
        if (v.type === 'line' || v.type === 'area') val.scale = !v.zeroBased;
        const second = !horizontal && seriesList.map(ownMeas).find(Boolean);
        const series = seriesList.map((s, si) => {
          const kind = v.type === 'combo' ? (s.kind || (si === 0 ? 'bar' : 'line')) : (v.type === 'line' || v.type === 'area' ? 'line' : 'bar');
          const sm = (second && ownMeas(s)) || meas;
          return {
            yAxisIndex: second && ownMeas(s) ? 1 : 0, tooltip: { valueFormatter: x => fmt(x, sm, generic) },
            name: L.meas(s.name || meas.name), type: kind, stack: v.stacked ? 'total' : undefined,
            areaStyle: v.type === 'area' ? { opacity: v.stacked ? 0.7 : 0.18 } : undefined,
            smooth: false, symbolSize: 7, barMaxWidth: 46, barGap: '15%',
            itemStyle: { borderRadius: v.stacked ? 0 : (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) },
            label: { show: !!v.valueLabels && seriesList.length === 1 && n <= 12, position: horizontal ? 'right' : 'top', color: t.ink, fontSize: 11, formatter: p => fmt(p.value, sm, generic) },
            data: vals[si].map((x, i) => ({ value: x, itemStyle: { opacity: dimOpacity(members[i]) } }))
          };
        });
        if (v.stackedPercent) series.forEach((s, si) => { s.data = s.data.map((d, i) => { const tot = vals.reduce((a, arr) => a + arr[i], 0); return { value: vals[si][i] / tot * 100, itemStyle: d.itemStyle }; }); });
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { trigger: 'axis' }),
          legend: seriesList.length > 1 ? legend : undefined,
          grid: { left: 8, right: 16, top: seriesList.length > 1 ? 32 : (v.valueLabels ? 24 : 12), bottom: 8, containLabel: true },
          xAxis: horizontal ? val : cat,
          yAxis: horizontal ? Object.assign(cat, { inverse: true }) : (second ? [val, Object.assign(axisBase(t), { type: 'value', splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, second, generic) } })] : val), series
        });
      }
      case 'pie': case 'donut': {
        const data = members.map((m, i) => ({ name: m, value: vals[0][i], itemStyle: { opacity: dimOpacity(m) } }));
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { formatter: p => `${escH(p.name)}<br><b>${fmt(p.value, meas, generic)}</b> · ${Math.round(p.percent)}%` }),
          legend: Object.assign({}, legend, { type: 'plain', bottom: 0, top: 'auto', itemGap: 8, itemWidth: 12, itemHeight: 8 }),
          series: [{ type: 'pie', radius: v.type === 'donut' ? ['44%', '66%'] : [0, '66%'], center: ['50%', n > 4 ? '40%' : '44%'], itemStyle: { borderColor: t.surface, borderWidth: 2 },
            label: (num(v.span) || 6) <= 3
              ? { position: 'inside', color: '#fff', fontSize: 10, fontWeight: 600, formatter: p => p.percent >= 6 ? Math.round(p.percent) + '%' : '' }
              : { color: t.ink, fontSize: 11, formatter: p => p.percent >= 4 ? Math.round(p.percent) + '%' : '' },
            labelLine: { show: (num(v.span) || 6) > 3, length: 6, length2: 6 }, data }]
        });
      }
      case 'treemap': {
        return Object.assign(base, { _meta: meta,
          tooltip,
          series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%', top: 0, left: 0,
            label: { color: '#fff', fontSize: 11, formatter: p => `${p.name}\n${fmt(p.value, meas, generic)}` }, itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2 },
            data: members.map((m, i) => ({ name: m, value: vals[0][i], itemStyle: { color: colors[i % colors.length], opacity: dimOpacity(m) } })) }]
        });
      }
      case 'funnel': {
        const sorted = vals[0].slice().sort((a, b) => b - a);
        return Object.assign(base, { _meta: meta,
          tooltip,
          series: [{ type: 'funnel', sort: 'none', left: '8%', width: '84%', top: 8, bottom: 8, gap: 2, label: { color: t.ink, fontSize: 11, position: 'inside', formatter: p => `${p.name}  ${fmt(p.value, meas, generic)}` },
            itemStyle: { borderColor: t.surface }, data: members.map((m, i) => ({ name: m, value: mode === 'shape' ? vals[0][i] : sorted[i] })) }]
        });
      }
      case 'waterfall': {
        const shape = (seriesList[0].shape && seriesList[0].shape.length === n && mode === 'shape') ? seriesList[0].shape : members.map((_, i) => i === 0 ? 100 : (i === n - 1 ? 0 : (r() - 0.6) * 40));
        let run = 0; const helper = [], up = [], down = [];
        shape.forEach((sv, i) => {
          const x = Number(sv) / 100 * scale * (0.96 + r() * 0.08) * F.factor(v.id, [dimKey], i);
          if (i === n - 1 && v.lastIsTotal !== false) { helper.push(0); up.push(run); down.push('-'); return; }
          if (i === 0 || x >= 0) { helper.push(run); up.push(Math.abs(x)); down.push('-'); run += Math.abs(x); }
          else { run += x; helper.push(run); up.push('-'); down.push(-x); }
        });
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { trigger: 'axis', valueFormatter: undefined, formatter: ps => { const p = ps.find(q => q.seriesIndex > 0 && Number.isFinite(num(q.value))); return p ? `${escH(p.name)}<br><b>${(p.seriesIndex === 2 ? '−' : '')}${fmt(p.value, meas, generic)}</b>` : ''; } }),
          grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: members }, catLabels(v, members, t) ? { axisLabel: catLabels(v, members, t) } : {}),
          yAxis: Object.assign(axisBase(t), { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, meas, generic) } }),
          series: [
            { type: 'bar', stack: 'w', itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, data: helper },
            { type: 'bar', stack: 'w', itemStyle: { color: colors[2] || '#1baf7a' }, data: up },
            { type: 'bar', stack: 'w', itemStyle: { color: colors[7] || '#e34948' }, data: down }
          ]
        });
      }
      case 'scatter': case 'bubble': {
        const xM = v.xMeasure || { name: 'X', format: 'number' }, yM = v.yMeasure || meas;
        const xs = scaleFor(xM, r), ys = scaleFor(yM, r), ss = 1;
        const pts = (mode === 'shape' && Array.isArray(v.points) && v.points.length) ? v.points : Array.from({ length: v.pointCount || 24 }, () => [r() * 100, r() * 100, 20 + r() * 80]);
        const ptKey = F.dk('point · ' + (v.title || v.id));
        const fk = F.factor(v.id, [ptKey], 0); const keepN = Math.max(3, Math.ceil(pts.length * Math.min(1, fk * 1.15)));
        let data = pts.slice(0, keepN).map((p, i) => ({ name: (v.pointLabel || 'Point') + ' ' + (i + 1), value: [p[0] / 100 * xs * (0.97 + r() * 0.06) * (0.9 + 0.2 * fk), p[1] / 100 * ys * (0.97 + r() * 0.06), (p[2] || 40) * ss] }));
        const psel = F.sel(ptKey); if (psel && psel.length) data = data.filter(d => psel.includes(d.name));
        meta = { pairs: p => p && p.name ? [[ptKey, p.name]] : [] };
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { formatter: p => `${escH(p.name)}<br>${escH(L.meas(xM.name))}: <b>${fmt(p.value[0], xM, generic)}</b><br>${escH(L.meas(yM.name))}: <b>${fmt(p.value[1], yM, generic)}</b>` }),
          grid: { left: 8, right: 20, top: 24, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'value', scale: true, name: L.meas(xM.name), nameLocation: 'middle', nameGap: 26, axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, xM, generic) } }),
          yAxis: Object.assign(axisBase(t), { type: 'value', scale: true, name: L.meas(yM.name), axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, yM, generic) } }),
          series: [{ type: 'scatter', data, symbolSize: d => v.type === 'bubble' ? 6 + Math.sqrt(d[2]) * 3.2 : 10, itemStyle: { color: colors[0], opacity: 0.75, borderColor: t.surface, borderWidth: 1 } }]
        });
      }
      case 'heatmap': {
        const rowsD = v.rows || { name: 'Row', members: ['R1', 'R2', 'R3', 'R4'] };
        const colsD = v.columns || { name: 'Column', members: ['C1', 'C2', 'C3', 'C4', 'C5'] };
        const rk = F.dk(rowsD.name), ck = F.dk(colsD.name);
        const fullGrid = (mode === 'shape' && Array.isArray(v.matrix) && v.matrix.length === rowsD.members.length) ? v.matrix : rowsD.members.map(() => colsD.members.map(() => r() * 100));
        const rs = F.sel(rk), cs = F.sel(ck);
        const rIdx = rowsD.members.map((m, i) => i).filter(i => !(rs && rs.length) || selHas(rs, rowsD.members[i]));
        const cIdx = colsD.members.map((m, i) => i).filter(i => !(cs && cs.length) || selHas(cs, colsD.members[i]));
        const rm = rIdx.map(i => L.member(rowsD.name, rowsD.members[i], i)), cm = cIdx.map(i => L.member(colsD.name, colsD.members[i], i));
        const data = []; let mx = 0;
        rIdx.forEach((ri, a) => cIdx.forEach((ci, b) => { const cell = (fullGrid[ri] || [])[ci]; if (mode === 'shape' && fullGrid === v.matrix && (cell === null || cell === undefined || cell === '')) return; const val = (Number(cell) || 0) / 100 * scale * (0.95 + r() * 0.1) * F.factor(v.id, [rk, ck], ri * 31 + ci); mx = Math.max(mx, val); data.push([b, a, val]); }));
        meta = { pairs: p => p && p.value ? [[rk, rowsD.members[rIdx[p.value[1]]]], [ck, colsD.members[cIdx[p.value[0]]]]] : [] };
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { formatter: p => `${escH(rm[p.value[1]])} · ${escH(cm[p.value[0]])}<br><b>${fmt(p.value[2], meas, generic)}</b>` }),
          grid: { left: 8, right: 8, top: 8, bottom: 44, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: cm, splitArea: { show: false } }),
          yAxis: Object.assign(axisBase(t), { type: 'category', data: rm, inverse: true, splitArea: { show: false } }),
          visualMap: { min: 0, max: mx, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, textStyle: { color: t.muted, fontSize: 10 }, inRange: { color: ['#e8f1fb', '#2a78d6', '#123a6b'] }, formatter: x => fmt(x, meas, generic) },
          series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 1 } }]
        });
      }
      case 'gauge': {
        const pct0 = mode === 'shape' && typeof v.shapeValue === 'number' ? v.shapeValue * (0.97 + r() * 0.06) : 30 + r() * 65;
        const pct = F.key ? Math.max(3, Math.min(100, pct0 * (0.8 + 0.4 * rng(hashStr(v.id + '|' + F.key))()))) : pct0;
        // the arc position is 0-100; min/max (e.g. -100..100 for NPS) set what that position means
        let gmin = num(v.min), gmax = num(v.max);
        if (!Number.isFinite(gmin)) gmin = 0;
        if (!Number.isFinite(gmax) || gmax <= gmin) gmax = meas.format === 'percent' || !(gmin < 0) ? Math.max(gmin + 1, 100) : -gmin;
        const gval = gmin + pct / 100 * (gmax - gmin);
        const gfmt = x => meas.format === 'percent' || (!v.measure && gmin === 0 && gmax === 100) ? Math.round(x) + (generic ? '' : '%') : (gmin < 0 && x > 0 ? '+' : '') + fmt(x, meas, generic);
        return Object.assign(base, { _meta: meta,
          series: [{ type: 'gauge', min: gmin, max: gmax, progress: { show: true, width: 14, itemStyle: { color: colors[0] } }, axisLine: { lineStyle: { width: 14, color: [[1, t.grid]] } },
            axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
            title: { show: false }, detail: { valueAnimation: true, fontSize: 26, fontWeight: 700, color: t.ink, offsetCenter: [0, '10%'], formatter: gfmt }, data: [{ value: gval }] }]
        });
      }
      case 'boxplot': {
        // shape mode follows the measured boxes ([min, q1, median, q3, max], 0-100); otherwise random quartiles
        const boxes = mode === 'shape' && Array.isArray(v.boxes) && v.boxes.length === membersRaw.length ? v.boxes : null;
        const data = members.map((m, i) => {
          const f = F.factor(v.id, [dimKey], i), src = boxes && boxes[keep.length ? keep[i] : i];
          const q0 = Array.isArray(src) && src.length === 5 && src.every(x => Number.isFinite(num(x))) ? src.map(num).sort((a, b) => a - b).map(x => Math.max(0, x) * (0.97 + r() * 0.06))
            : [r() * 20, 20 + r() * 20, 40 + r() * 20, 60 + r() * 20, 80 + r() * 20];
          return q0.sort((a, b) => a - b).map(x => x / 100 * scale * (0.7 + 0.3 * f));
        });
        return Object.assign(base, { _meta: meta,
          tooltip, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: members }, catLabels(v, members, t) ? { axisLabel: catLabels(v, members, t) } : {}),
          yAxis: Object.assign(axisBase(t), { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, meas, generic) } }),
          series: [{ type: 'boxplot', data, itemStyle: { color: 'transparent', borderColor: colors[0], borderWidth: 1.5 } }]
        });
      }
      case 'map': return mapOption(v, ctx, base, tooltip, meas, scale);
      case 'gantt': {
        // Timeline / Gantt: each task is a bar from start to end on a 0-100 time scale.
        const rawTasks = (Array.isArray(v.tasks) && v.tasks.length ? v.tasks : Array.from({ length: 5 }, (_, i) => ({ name: 'Task ' + (i + 1) })))
          .map((tk, i) => typeof tk === 'string' ? { name: tk } : (tk || { name: 'Task ' + (i + 1) }));
        const tKey = F.dk('task · ' + (v.title || v.id));
        const labels = (Array.isArray(v.timeLabels) ? v.timeLabels : []).map(String);
        const names = rawTasks.map((tk, i) => String(tk.name != null ? tk.name : 'Task ' + (i + 1)));
        const shown = names.map((nm, i) => L.member('Task', nm, i));
        const tsel = F.sel(tKey);
        const clamp = x => Math.max(0, Math.min(100, x));
        const spans = rawTasks.map((tk, i) => {
          let a = num(tk.start), b = num(tk.end);
          if (mode !== 'shape' || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) { a = r() * 70; b = a + 8 + r() * 30; }
          return [clamp(a), clamp(Math.max(b, a + 2))];
        });
        const at = x => labels.length ? labels[Math.min(labels.length - 1, Math.round(x / 100 * (labels.length - 1)))] : Math.round(x) + '%';
        const on = i => !(tsel && tsel.length) || tsel.includes(names[i]);
        const color = colors[(v.colorIndex || 0) % colors.length];
        meta = { pairs: p => (p && p.seriesIndex === 1 && names[p.dataIndex] != null) ? [[tKey, names[p.dataIndex]]] : [] };
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { valueFormatter: undefined, formatter: p => p.seriesIndex === 1 ? `${escH(shown[p.dataIndex])}<br>${escH(L.generic ? '' : at(spans[p.dataIndex][0]) + ' → ' + at(spans[p.dataIndex][1]))}` : '' }),
          grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'value', min: 0, max: 100, interval: labels.length > 1 ? 100 / (labels.length - 1) : 25,
            axisLabel: { color: t.muted, fontSize: 11, formatter: x => L.generic ? '' : at(x) } }),
          yAxis: Object.assign(axisBase(t), { type: 'category', inverse: true, data: shown, splitLine: { show: false } }),
          series: [
            { type: 'bar', stack: 'g', silent: true, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, data: spans.map(sp => sp[0]) },
            { type: 'bar', stack: 'g', barMaxWidth: 18, itemStyle: { color, borderRadius: 4 },
              data: spans.map((sp, i) => ({ value: sp[1] - sp[0], itemStyle: { opacity: on(i) ? 1 : 0.25 } })) }
          ]
        });
      }
      case 'sankey': {
        const rawNodes = v.nodes && v.nodes.length ? v.nodes : ['Source A', 'Source B', 'Middle', 'End X', 'End Y'];
        const nk = F.dk('node · ' + (v.title || v.id));
        const nodes = rawNodes.map((nm, i) => L.member('Node', nm, i));
        const nodeRaw = {}; nodes.forEach((nm, i) => { nodeRaw[nm] = rawNodes[i]; });
        const nsel = F.sel(nk);
        meta = { pairs: p => p && p.dataType === 'node' ? [[nk, nodeRaw[p.name]]] : [] };
        const links = (v.links && v.links.length ? v.links : [{ source: 0, target: 2 }, { source: 1, target: 2 }, { source: 2, target: 3 }, { source: 2, target: 4 }])
          .map(l => ({ source: nodes[typeof l.source === 'number' ? l.source : (v.nodes || []).indexOf(l.source)], target: nodes[typeof l.target === 'number' ? l.target : (v.nodes || []).indexOf(l.target)], value: ((mode === 'shape' && l.shape) ? l.shape : 20 + r() * 80) / 100 * scale * F.factor(v.id, [nk], 0) }))
          .filter(l => l.source && l.target && (!(nsel && nsel.length) || nsel.includes(nodeRaw[l.source]) || nsel.includes(nodeRaw[l.target])));
        return Object.assign(base, { _meta: meta, tooltip, series: [{ type: 'sankey', left: 8, right: 90, top: 8, bottom: 8, data: nodes.filter(nm => links.some(l => l.source === nm || l.target === nm)).map(nm => ({ name: nm })), links, lineStyle: { color: 'gradient', opacity: 0.35 }, label: { color: t.ink, fontSize: 11 } }] });
      }
      default: return null;
    }
  }

  /* ---------- table columns: a plausible range per column, from the AI's hint or the column name ---------- */
  // Customer comments kept on the device (names, emails and numbers already removed). "[…]" marks hidden words.
  const isVerbatim = c => !!c && /^(verbatim|quote|comment)s?$/i.test(String(c.kind || ''));
  const HIDDEN = /\[(?:…|\.\.\.|hidden|redacted|masked|client|name)\]/gi;
  function quoteHtml(q) {
    const t = String(q).replace(/^[\s"“”']+|[\s"“”']+$/g, '').slice(0, 400);
    return '“' + t.split(HIDDEN).map(escH).join('<span class="rp-redact" role="img" aria-label="hidden"></span>') + '”';
  }
  function columnModel(c, kind) {
    const n = fold(c.name), hint = num(c.scaleHint);
    if (kind === 'percent') {
      if (/change|vs|delta|lift|growth|yoy|mom|wow|diff/.test(n)) return { lo: -15, hi: 20, signed: true };
      if (/margin/.test(n)) return { lo: 40, hi: 85 };
      if (/sla|uptime|attain|retention|crash free|success|availability/.test(n)) return { lo: 82, hi: 99.5 };
      if (/discount|churn|bounce|rate|share|conversion|error|fail/.test(n)) return { lo: 0.5, hi: 35 };
      return { lo: 5, hi: 95 };
    }
    if (/csat|rating|stars/.test(n) && !(hint > 5.5)) return { lo: 3.6, hi: 4.9, dp: 1 };
    if (/nps/.test(n) && !(hint > 100)) return { lo: -20, hi: 70, dp: 0 };
    if (/score/.test(n) && !(hint > 10.5)) return { lo: 0, hi: 10, dp: 0 };      // a 0-10 survey score is a whole number
    if (hint > 0) return { lo: hint * 0.35, hi: hint * 1.4, dp: hint < 20 ? 1 : 0 };
    if (kind === 'currency') {
      if (/price|per seat|per user|per unit|seat|unit|fee|rate/.test(n)) return { lo: 8, hi: 120, dp: 2 };
      if (/arr|annual|revenue|sales|bookings|pipeline|budget|spend/.test(n)) return { lo: 4e5, hi: 5e6 };
      if (/mrr|monthly/.test(n)) return { lo: 3e4, hi: 4e5 };
      return { lo: 2e3, hi: 2e5 };
    }
    if (/day|days|hour|hours|minute|minutes|time|age|duration|sla/.test(n)) return { lo: 1, hi: 60, dp: 0 };
    if (/solved|ticket|case|bug|issue|order|point|pts|count|deal|lead|crash/.test(n)) return { lo: 20, hi: 400, dp: 0 };
    if (/user|seat|install|session|visitor|view|download|customer|account|member|subscriber/.test(n)) return { lo: 500, hi: 50000, dp: 0 };
    return { lo: 50, hi: 5000, dp: 0 };
  }

  /* ---------- page ---------- */
  const CSS = `
.rp{--rp-bg:#f4f5f7;--rp-surface:#fff;--rp-ink:#14181e;--rp-muted:#5a6370;--rp-line:#dde1e7;--rp-grid:#eef0f3;--rp-head:#2f3b4c;--rp-good:#2f7d3e;--rp-bad:#b03c38;
  position:relative;isolation:isolate;background:var(--rp-bg);color:var(--rp-ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;border-radius:10px;overflow:hidden}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .rp{--rp-bg:#0f1215;--rp-surface:#181c21;--rp-ink:#eef1f4;--rp-muted:#a3acb9;--rp-line:#2b3139;--rp-grid:#22272e;--rp-head:#273241;--rp-good:#5cbf6e;--rp-bad:#ec7a75}}
:root[data-theme="dark"] .rp{--rp-bg:#0f1215;--rp-surface:#181c21;--rp-ink:#eef1f4;--rp-muted:#a3acb9;--rp-line:#2b3139;--rp-grid:#22272e;--rp-head:#273241;--rp-good:#5cbf6e;--rp-bad:#ec7a75}
.rp *{box-sizing:border-box}
.rp::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:20;background:var(--rp-ink);opacity:.07;
  -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='200'%3E%3Ctext x='170' y='108' text-anchor='middle' transform='rotate(-22 170 100)' font-family='Arial' font-size='24' font-weight='700' letter-spacing='3'%3ESYNTHETIC DATA%3C/text%3E%3C/svg%3E");
  mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='200'%3E%3Ctext x='170' y='108' text-anchor='middle' transform='rotate(-22 170 100)' font-family='Arial' font-size='24' font-weight='700' letter-spacing='3'%3ESYNTHETIC DATA%3C/text%3E%3C/svg%3E");
  -webkit-mask-size:340px 200px;mask-size:340px 200px}
.rp-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;align-items:center;background:var(--rp-head);color:#fff;padding:14px 18px}
.rp-head h2{margin:0;font-size:18px;font-weight:700}
.rp-head span{font-size:12.5px;color:#cfd7e2}
.rp-ribbon{display:flex;flex-wrap:wrap;gap:4px 14px;padding:7px 18px;background:var(--rp-surface);border-bottom:1px solid var(--rp-line);font-size:12px;color:var(--rp-muted)}
.rp-ribbon b{color:var(--rp-bad);letter-spacing:.08em}
.rp-filters{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:10px 18px 0}
.rp-filters .lbl{font-size:11px;font-weight:600;color:var(--rp-muted);text-transform:uppercase;letter-spacing:.05em}
.rp-chip{font:inherit;font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--rp-line);background:var(--rp-surface);color:var(--rp-ink);cursor:pointer}
.rp-chip[aria-pressed="true"]{background:#2a78d6;border-color:#2a78d6;color:#fff}
.rp-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;padding:14px 18px 18px}
.rp-card{grid-column:span var(--span,6);background:var(--rp-surface);border:1px solid var(--rp-line);border-radius:8px;padding:12px 14px;min-width:0}
.rp-card h3{margin:0 0 6px;font-size:13.5px;font-weight:650}
.rp-chart{width:100%;height:var(--h,260px)}
.rp-kpi .k{font-size:12.5px;color:var(--rp-muted)}
.rp-kpi .v{font-size:clamp(20px,2.4vw,28px);font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
.rp-kpi .d{font-size:12px;font-variant-numeric:tabular-nums}
.rp-kpi .d.good{color:var(--rp-good)} .rp-kpi .d.bad{color:var(--rp-bad)}
.rp-kpi svg{display:block;width:100%;height:28px;margin-top:6px}
.rp-table{overflow-x:auto}
.rp-table table{border-collapse:collapse;width:100%;font-size:12.5px}
.rp-table th,.rp-table td{padding:6px 8px;border-bottom:1px solid var(--rp-line);text-align:left;white-space:nowrap}
.rp-table th{background:var(--rp-bg);font-weight:600}
.rp-table td.n{text-align:right;font-variant-numeric:tabular-nums}
.rp-table td.q{white-space:normal;min-width:16em;line-height:1.45;color:var(--rp-ink)}
.rp-feed{display:flex;flex-direction:column}
.rp-fi{padding:8px 0;border-bottom:1px solid var(--rp-line)}
.rp-fi .m{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--rp-muted)}
.rp-fi .m>span:first-child{flex:1;min-width:0}
.rp-fi .m b{color:var(--rp-ink);font-weight:600}
.rp-fi p{margin:3px 0 0;font-size:13px;line-height:1.45;color:var(--rp-ink)}
.rp-badge{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--rp-bg);color:var(--rp-ink);font-variant-numeric:tabular-nums}
.rp-badge.good{background:#e3f4e8;color:#1d7a3a}.rp-badge.mid{background:#fdf1d8;color:#8a5a00}.rp-badge.bad{background:#fbe3e2;color:#b03c38}
.rp-redact{display:inline-block;width:3.4em;height:.85em;margin:0 .1em;border-radius:3px;background:var(--rp-muted);opacity:.45;vertical-align:-.05em}
.rp-row{cursor:pointer}.rp-row:hover td{background:var(--rp-bg)}
.rp-pill{background:#e8f1fb;border-color:#2a78d6;color:#14181e}
.rp-clear{border-style:dashed}
.rp-ph{display:grid;place-items:center;height:var(--h,200px);border:1px dashed var(--rp-line);border-radius:6px;color:var(--rp-muted);font-size:12.5px;text-align:center;padding:12px}
.rp-note{font-size:11.5px;color:var(--rp-muted);margin-top:4px}
.rp-text{color:var(--rp-muted);font-size:13px}
.rp-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;padding:10px 18px;border-top:1px solid var(--rp-line);font-size:11.5px;color:var(--rp-muted);background:var(--rp-surface);position:relative;z-index:21}
.rp-foot a,.rp-foot .rp-csv{color:var(--rp-muted);text-decoration:underline;text-underline-offset:2px}
.rp-foot .rp-csv{background:none;border:0;padding:0;font:inherit;cursor:pointer}
@media (max-width:760px){.rp-card{grid-column:span 12 !important}}
`;

  const MODE_NAME = { shape: 'Shape-preserving', structure: 'Structure-only', generic: 'Generic' };

  // Labels come from an AI reading a screenshot, so they are treated as untrusted: no markup survives.
  const CLEAN = typeof Symbol === 'function' ? Symbol('clean') : '__clean';
  const cleanAll = o => typeof o === 'string' ? o.replace(/[<>]/g, '') : Array.isArray(o) ? o.map(cleanAll) : (o && typeof o === 'object') ? Object.keys(o).reduce((a, k) => { a[k] = cleanAll(o[k]); return a; }, {}) : o;
  function cleanSpec(spec) { if (spec && spec[CLEAN]) return spec; const c = cleanAll(spec || {}); Object.defineProperty(c, CLEAN, { value: true }); return c; }

  function render(root, spec, opts) {
    spec = cleanSpec(spec);
    opts = opts || {};
    const rows = root._rows = [];
    const mode = opts.mode || 'shape';
    const seed = opts.seed || 4127;
    const L = labelsFor(spec, mode);
    SCALES = {}; HINTS = {};
    (spec.rows || []).forEach(row => (row.visuals || []).forEach(v => [v && v.measure, v && v.xMeasure, v && v.yMeasure].forEach(m => {
      const h = m ? num(m.scaleHint) : NaN; if (h > 0 && !HINTS[measureKey(m)]) HINTS[measureKey(m)] = h;
    })));
    if (!document.getElementById('rp-style')) { const st = document.createElement('style'); st.id = 'rp-style'; st.textContent = CSS; document.head.appendChild(st); }
    (root._charts || []).forEach(c => c.dispose());
    root._charts = [];
    const state = root._state = root._state || { filters: {} };
    if (opts.resetSelection) state.filters = {};
    const reopts = Object.assign({}, opts, { resetSelection: false, _quiet: true });
    const colors = [(spec.theme && spec.theme.primary) || PALETTE[0], (spec.theme && spec.theme.secondary) || PALETTE[1]].concat(PALETTE.slice(2));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const visuals = [];
    // Normalise what different models call the same visual.
    const TYPE_ALIAS = { timeline: 'gantt', roadmap: 'gantt', 'gantt chart': 'gantt', 'stacked bar': 'bar', 'stacked column': 'column', doughnut: 'donut', choropleth: 'map', 'filled map': 'map' };
    const normType = v => {
      let ty = String(v.type || '').toLowerCase().trim(); ty = TYPE_ALIAS[ty] || ty;
      if (ty === 'placeholder' && /gantt|timeline|roadmap/i.test(v.originalType || '')) ty = 'gantt';
      return ty;
    };
    (spec.rows || []).forEach(row => (row.visuals || []).forEach(v => { if (v) visuals.push(Object.assign({ _h: row.height }, v, { type: normType(v) })); }));
    // map outlines load on first use; the page re-renders once they arrive
    root._spec = spec;
    const missing = mapsUsed(spec).filter(n => !MAPS[n] && !MAP_FAILED[n]);
    if (missing.length && global.fetch) Promise.all(missing.map(loadMap)).then(() => { if (root._spec === spec) render(root, spec, reopts); });

    // ---- filter model: each member of a dimension owns a share of the total; selecting members
    // keeps only those members in visuals on that dimension and scales every other visual by their share
    const dk = canonDim;
    const shares = {};
    const setShares = (name, list, shape) => {
      const k = dk(name); if (shares[k] || !list || !list.length) return;
      const rr = rng(seed ^ hashStr('share|' + k));
      const arr = (mode === 'shape' && shape && shape.length === list.length) ? shape.map(x => Math.max(0.5, Math.abs(+x) || 0)) : list.map(() => 15 + rr() * 85);
      const tot = arr.reduce((a, b) => a + b, 0); shares[k] = {}; list.forEach((m, i) => { shares[k][m] = arr[i] / tot; });
    };
    visuals.forEach(v => { if (v.dimension && v.type !== 'map') setShares(v.dimension.name, v.dimension.members, v.series && v.series[0] && v.series[0].shape); });
    (spec.filters || []).forEach(f => setShares(f.label, f.members));
    visuals.forEach(v => (Array.isArray(v.columns) ? v.columns : []).forEach(c => { if (c.kind === 'category') setShares(c.name, c.members); }));
    visuals.forEach(v => {
      if (v.type === 'heatmap' && v.rows && v.columns) {
        const m = Array.isArray(v.matrix) ? v.matrix : null;
        setShares(v.rows.name, v.rows.members, m && m.length === v.rows.members.length ? m.map(row => row.reduce((a, b) => a + (+b || 0), 0)) : null);
        setShares(v.columns.name, v.columns.members, m && m[0] && m[0].length === v.columns.members.length ? v.columns.members.map((_, ci) => m.reduce((a, row) => a + (+row[ci] || 0), 0)) : null);
      }
      if (v.type === 'scatter' || v.type === 'bubble') { const n = (v.points && v.points.length) || v.pointCount || 24; setShares('point · ' + (v.title || v.id), Array.from({ length: n }, (_, i) => (v.pointLabel || 'Point') + ' ' + (i + 1))); }
      if (v.type === 'map') setShares(mapDimName(v), mapMembers(v), (v.points && v.points.length ? v.points.map(p => p && p.shape) : (v.series && v.series[0] && v.series[0].shape)));
      if (v.type === 'gantt' && Array.isArray(v.tasks)) setShares('task · ' + (v.title || v.id), v.tasks.map((tk, i) => String(tk && typeof tk === 'object' ? (tk.name != null ? tk.name : 'Task ' + (i + 1)) : tk)));
      if (v.type === 'sankey') setShares('node · ' + (v.title || v.id), v.nodes && v.nodes.length ? v.nodes : ['Source A', 'Source B', 'Middle', 'End X', 'End Y']);
    });
    Object.keys(state.filters).forEach(k => { if (!state.filters[k] || !state.filters[k].length) delete state.filters[k]; });
    const active = Object.keys(state.filters);
    const F = {
      active: Object.keys(state.filters).filter(k => state.filters[k] && state.filters[k].length),
      members: k => Object.keys(shares[k] || {}),
      dk, key: Object.keys(state.filters).filter(k => state.filters[k] && state.filters[k].length).sort().map(k => k + '=' + state.filters[k].join(',')).join(';'),
      sel: k => state.filters[k] || null,
      dims: (spec.filters || []).filter(f => f.members && f.members.length).map(f => ({ key: dk(f.label), name: f.label, members: f.members }))
        .concat(visuals.filter(v => v.type !== 'map' && v.dimension && v.dimension.members && v.dimension.members.length).map(v => ({ key: dk(v.dimension.name), name: v.dimension.name, members: v.dimension.members, shape: v.series && v.series[0] && v.series[0].shape })))
        .concat([].concat(...visuals.map(v => (Array.isArray(v.columns) ? v.columns : []).filter(c => c.kind === 'category' && c.members && c.members.length).map(c => ({ key: dk(c.name), name: c.name, members: c.members }))))),
      factor(vid, ownKeys, i) {
        let f = 1;
        active.forEach(k => {
          if (ownKeys.includes(k)) return;
          const sh = shares[k] || {};
          const part = Object.keys(sh).filter(m => selHas(state.filters[k], m)).reduce((a, m) => a + sh[m], 0) || 0.1;
          const rr = rng(hashStr(vid + '|' + k + '|' + state.filters[k].join(',') + '|' + i));
          f *= Math.min(1, part * (0.85 + 0.3 * rr()));
        });
        return f;
      }
    };
    const toggleMany = pairs => {
      pairs.forEach(([k, raw]) => {
        if (!k || raw == null) return;
        let cur = state.filters[k] ? state.filters[k].slice() : [];
        if (cur.some(x => sameMember(x, raw))) cur = cur.filter(x => !sameMember(x, raw)); else cur.push(raw);
        state.filters[k] = cur;
      });
      render(root, spec, reopts);
    };
    const toggle = (k, raw) => toggleMany([[k, raw]]);
    root._toggle = toggleMany;
    const filterHtml = (spec.filters || []).filter(f => f.members && f.members.length).map(f => {
      const k = dk(f.label), on = state.filters[k] || [];
      return `<span class="lbl">${esc(L.dim(f.label))}</span>` + f.members.map((m, i) => `<button type="button" class="rp-chip" data-dim="${esc(k)}" data-raw="${esc(m)}" aria-pressed="${selHas(on, m)}">${esc(L.member(f.label, m, i))}</button>`).join('');
    }).join('');
    const keyLabel = k => { const m = /^(point|node|task) /.exec(k); return m ? m[1][0].toUpperCase() + m[1].slice(1) : k; };
    const chipDims = (spec.filters || []).map(f => dk(f.label));
    const chipHas = (k, m) => (spec.filters || []).some(f => dk(f.label) === k && (f.members || []).some(x => sameMember(x, m)));
    const pills = active.map(k => state.filters[k].filter(m => !(chipDims.includes(k) && chipHas(k, m))).map(m => `<button type="button" class="rp-chip rp-pill" data-dim="${esc(k)}" data-raw="${esc(m)}" aria-pressed="true" title="Remove this filter">${esc(L.generic ? 'Filter' : keyLabel(k))}: ${esc(L.generic ? '•' : m)} ✕</button>`).join('')).join('');
    const filterBar = filterHtml + pills + (active.length ? `<button type="button" class="rp-chip rp-clear">Clear all filters</button>` : '');
    const activeNote = active.length ? `<span>Filtered: ${active.map(k => esc(L.generic ? 'filter' : keyLabel(k)) + ' (' + state.filters[k].length + ')').join(', ')}</span>` : '';

    const quotes = !L.generic && visuals.some(v => v.type === 'table' && (Array.isArray(v.columns) ? v.columns : []).some(c => isVerbatim(c) && Array.isArray(c.values) && c.values.length));
    const footNote = quotes ? 'Synthetic replica · numbers are generated · customer comments are quoted with personal details hidden' : 'Synthetic replica · no source values included';
    root.className = 'rp';
    root.innerHTML = `
      <div class="rp-head"><h2>${esc(L.generic ? 'Dashboard 1' : (spec.title || 'Dashboard'))}</h2><span>${esc(L.generic ? '' : (spec.subtitle || ''))}</span></div>
      <div class="rp-ribbon"><b>SYNTHETIC DATA</b><span>${MODE_NAME[mode]} mode · seed ${seed}</span><span>Values are generated and are not real figures.</span>${activeNote}</div>
      ${filterBar ? `<div class="rp-filters">${filterBar}</div>` : ''}
      <div class="rp-grid"></div>
      <div class="rp-foot"><span>${esc(footNote)} · <button type="button" class="rp-csv">Download data (CSV)</button></span><a href="${PRODUCT_URL}?ref=export" target="_blank" rel="noopener">${FOOTER_TEXT}</a></div>`;
    root.setAttribute('data-synthetic', 'true');
    const grid = root.querySelector('.rp-grid');
    const t = themeVars(root);
    const heights = { s: 140, m: 260, l: 340 };

    visuals.forEach((v, idx) => {
      const r = rng(seed ^ hashStr(v.id || idx) ^ hashStr(mode));
      const card = document.createElement('div');
      card.className = 'rp-card';
      card.style.setProperty('--span', Math.max(2, Math.min(12, v.span || 6)));
      const title = v.type === 'kpi' ? '' : `<h3>${esc(L.title(v.title || '', idx))}</h3>`;
      card.innerHTML = title;
      grid.appendChild(card);
      const h = heights[v._h] || (v.type === 'kpi' ? 120 : 260);

      if (v.type === 'kpi') {
        const meas = v.measure || { name: v.title || 'Value', format: 'number' };
        const fk = F.factor(v.id, [], 0);
        const hint = num(meas.scaleHint) > 0 ? num(meas.scaleHint) : HINTS[measureKey(meas)];
        const shapeV = num(v.shapeValue);
        const outOf = num(meas.outOf) > 0 ? num(meas.outOf) : 5;
        const base = meas.format === 'percent' ? (mode === 'shape' && Number.isFinite(shapeV) ? Math.max(0, Math.min(100, shapeV)) : 15 + r() * 60)
          : meas.format === 'ratio' ? outOf * (mode === 'shape' && Number.isFinite(shapeV) ? Math.max(0.05, Math.min(1, shapeV / 100)) : 0.72 + r() * 0.22)
          : hint > 0 ? hint * (0.85 + r() * 0.3)
          : meas.format === 'duration' ? scaleFor(meas, r) * (0.7 + r() * 0.6) : scaleFor(meas, r) * (3 + r() * 4);
        const val = meas.format === 'percent' ? Math.max(0, Math.min(100, base + (active.length ? (rng(hashStr(v.id + '|' + active.map(k => state.filters[k].join(',')).join(';')))() - 0.5) * 8 : 0)))
          : meas.format === 'ratio' ? Math.min(outOf, base * (0.96 + 0.04 * fk)) : base * fk;
        // a percent change cannot move past 0 or 100, so the swing shrinks near the ends (99% moves by tenths, not 6 points)
        const room = meas.format === 'percent' ? Math.max(0.2, Math.min(val, 100 - val)) : 100;
        const swing = meas.format === 'percent' ? Math.min(8, room * 0.6) : 20;
        const d0 = (r() - 0.35) * swing; const d = F.key ? (rng(hashStr(v.id + '|d|' + F.key))() - 0.4) * swing * 1.1 : d0; const up = d >= 0;
        const spark = v.sparkline ? (() => { const a = shapeArray(v.sparkShape, 12, mode, F.key ? rng(hashStr(v.id + '|s|' + F.key)) : r, 'trend'); const mx = Math.max(...a), mn = Math.min(...a); return `<svg viewBox="0 0 120 28" preserveAspectRatio="none"><polyline fill="none" stroke="${colors[0]}" stroke-width="1.5" points="${a.map((x, i) => `${i * 120 / 11},${26 - (x - mn) / (mx - mn || 1) * 24}`).join(' ')}"/></svg>`; })() : '';
        card.classList.add('rp-kpi');
        // green means good: for "lower is better" measures (errors, response time, churn) a fall is good news
        const good = up === (meas.higherIsBetter !== false && v.higherIsBetter !== false);
        const dTxt = meas.format === 'ratio' ? (Math.abs(d) / 100 * outOf).toFixed(2) : Math.abs(d).toFixed(1) + (meas.format === 'percent' ? ' pts' : '%');
        card.innerHTML = `<div class="k">${esc(L.meas(v.title || meas.name))}</div><div class="v">${esc(fmt(val, meas, L.generic))}</div>${v.delta === false ? '' : `<div class="d ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${dTxt} vs prior</div>`}${spark}`;
        rows.push({ v, member: '', series: L.meas(v.title || meas.name), value: val, format: meas.format });
        return;
      }
      if (v.type === 'table') {
        const cols = (v.columns && v.columns.length) ? v.columns : [{ name: 'Item', kind: 'text' }, { name: 'Value', kind: 'number' }];
        const nRows = Math.min(v.rowCount || 5, 25);
        const catCols = cols.filter(c => c.kind === 'category' && c.members && c.members.length);
        const ownKeys = catCols.map(c => dk(c.name));
        const tf = F.factor(v.id, ownKeys, 0);
        const pool = c => { const k = dk(c.name), allowed = state.filters[k] && state.filters[k].length ? c.members.filter(m => selHas(state.filters[k], m)) : c.members; return allowed.length ? allowed : c.members; };
        const pick = (c, ri) => { const p = pool(c); return p[Math.floor(rng(hashStr(v.id + '|' + c.name + '|' + ri + '|' + p.join(',')))() * p.length)]; };
        const rowCat = catCols[0];
        // the row-label column lists its members in order, without repeats, with any "Total" row last
        const rowLabels = rowCat ? (() => { const p = pool(rowCat).map(String); const tot = p.filter(m => /^(grand )?totals?$/i.test(m.trim())); return p.filter(m => !tot.includes(m)).concat(tot); })() : [];
        const vcol = cols.find(c => isVerbatim(c) && Array.isArray(c.values) && c.values.length);
        const rowsN = rowCat ? Math.min(nRows, rowLabels.length) : (vcol && !L.generic ? Math.min(25, vcol.values.length) : nRows);
        const ids = Array.from({ length: rowsN }, () => Math.floor(r() * 65536).toString(16).toUpperCase().padStart(4, '0'));
        const desc = Array.from({ length: rowsN }, () => r()).sort((a, b) => b - a);
        // every numeric column gets its own stream and range; the first one follows the table's sort order
        const firstNum = cols.findIndex(c => ['number', 'currency'].includes(c.kind));
        const colVal = (c, ci, ri) => {
          const m = columnModel(c, c.kind), rr = rng(hashStr(v.id + '|' + c.name + '|' + ci + '|' + ri + '|' + mode));
          // in shape mode a column may carry a 0-100 position per row (read from bar lengths or badge colours)
          const sh = mode === 'shape' && Array.isArray(c.shape) ? num(c.shape[ri]) : NaN;
          const u = Number.isFinite(sh) ? Math.max(0, Math.min(1, sh / 100 + (rr() - 0.5) * 0.06)) : (v.sorted && ci === firstNum) ? desc[ri] : rr();
          let x = m.lo + u * (m.hi - m.lo);
          if (c.kind !== 'percent' && !(m.lo < 0)) x *= tf;
          return { x, m };
        };
        const csvCell = (c, ri, o) => rows.push({ v, dim: 'Row', member: String(ri + 1), series: L.generic ? L.dim(c.name) : c.name, value: o.text, format: c.kind || 'text' });
        const cellOf = (c, ci, ri) => {
          const k = c.kind || 'text';
          const cats = c.members && c.members.length ? c.members : null;
          let cell;
          if (isVerbatim(c)) {
            const q = Array.isArray(c.values) && !L.generic ? c.values[ri] : null;
            return q != null && String(q).trim() ? { html: quoteHtml(q), text: String(q), cls: 'q', k: 'verbatim' } : { html: esc('Comment ' + String(ri + 1).padStart(2, '0')), text: 'Comment ' + String(ri + 1).padStart(2, '0'), cls: '', k: 'verbatim' };
          }
          let x = null;
          if (k === 'person') cell = (L.generic ? 'Owner ' : 'Person ') + (1 + ((ri * 7 + ci) % 9));
          else if (k === 'org' || k === 'text') cell = (L.generic ? 'Entity ' : (c.placeholder || (k === 'org' ? 'Company' : 'Item')) + ' ') + String(ri + 1).padStart(2, '0');
          else if (k === 'id') cell = (L.generic ? 'ID-' : 'TKN-') + ids[ri];
          else if (k === 'category') { if (cats) { const m = c === rowCat ? rowLabels[ri] : pick(c, ri); cell = L.member(c.name, m, cats.map(String).indexOf(String(m))); } else cell = 'Group ' + 'ABC'[Math.floor(r() * 3)]; }
          else if (k === 'date') cell = new Date(Date.now() - Math.floor(r() * 120) * 864e5).toISOString().slice(0, 10);
          else if (k === 'percent') { const o = colVal(c, ci, ri); x = o.x; cell = (o.m.signed && x > 0 ? '+' : '') + x.toFixed(1) + (L.generic ? '' : '%'); }
          else if (k === 'currency') { const o = colVal(c, ci, ri); x = o.x; cell = o.m.dp === 2 && x < 1000 ? (L.generic ? '' : (c.currency || (v.measure && v.measure.currency) || '$')) + x.toFixed(2) : fmt(x, { format: 'currency', currency: c.currency || (v.measure && v.measure.currency) }, L.generic); }
          else { const o = colVal(c, ci, ri); x = o.x; cell = o.m.dp === 1 ? x.toFixed(1) : (o.m.lo < 0 && x > 0 ? '+' : '') + (o.m.dp === 0 && Math.abs(x) < 1e4 ? Math.round(x).toLocaleString('en-US') : abbr(x)); }
          const isNum = ['number', 'currency', 'percent'].includes(k);
          return { html: esc(cell), text: cell, cls: isNum ? 'n' : '', k, x, max: isNum ? columnModel(c, k).hi : null };
        };
        // A narrow list of customer comments reads like the source: who said it, the quote, and the score badge.
        if (vcol && (num(v.span) || 6) <= 6) {
          const items = Array.from({ length: rowsN }, (_, ri) => {
            const cs = cols.map((c, ci) => { const o = cellOf(c, ci, ri); csvCell(c, ri, o); return o; });
            const meta = cs.filter(o => !o.cls && o.k !== 'verbatim').map((o, i) => i === 0 ? `<b>${o.html}</b>` : o.html).join(' · ');
            const quote = cs.filter(o => o.k === 'verbatim').map(o => `<p>${o.html}</p>`).join('');
            const badges = cs.filter(o => o.cls === 'n').map(o => {
              const sx = o.x == null ? null : Math.round(o.x);
              const tone = o.k === 'number' && o.max <= 10.5 && sx != null ? (sx >= 9 ? 'good' : sx >= 7 ? 'mid' : 'bad') : '';
              return `<span class="rp-badge ${tone}">${o.html}</span>`;
            }).join('');
            return `<div class="rp-fi"><div class="m"><span>${meta}</span>${badges}</div>${quote}</div>`;
          }).join('');
          card.insertAdjacentHTML('beforeend', `<div class="rp-feed">${items}</div>`);
          return;
        }
        const rowsHtml = Array.from({ length: rowsN }, (_, ri) => (rowCat ? `<tr class="rp-row" data-dim="${esc(dk(rowCat.name))}" data-raw="${esc(rowLabels[ri])}" title="Filter by this ${esc(rowCat.name)}">` : '<tr>') + cols.map((c, ci) => {
          const o = cellOf(c, ci, ri); csvCell(c, ri, o);
          return `<td class="${o.cls}">${o.html}</td>`;
        }).join('') + '</tr>').join('');
        card.insertAdjacentHTML('beforeend', `<div class="rp-table"><table><thead><tr>${cols.map(c => `<th>${esc(L.generic ? L.dim(c.name) : c.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
        return;
      }
      if (v.type === 'text') { card.insertAdjacentHTML('beforeend', `<p class="rp-text">${esc(L.generic ? 'Text block' : (v.content || 'Text block (content masked)'))}</p>`); return; }
      const opt = buildOption(v, { L, mode, r, t, colors, filter: F, quiet: !!opts._quiet });
      if (!opt || opt._placeholder) {
        card.insertAdjacentHTML('beforeend', `<div class="rp-ph" style="--h:${h}px">${esc(opt ? opt._placeholder : 'Visual type "' + (v.originalType || v.type) + '" recognised; shown as a placeholder.')}</div>`);
        return;
      }
      const el = document.createElement('div');
      el.className = 'rp-chart'; el.style.setProperty('--h', h + 'px');
      card.appendChild(el);
      const chart = global.echarts.init(el, null, { renderer: 'svg' });
      chart.setOption(Object.assign({}, opt, { _meta: undefined, _note: undefined }));
      const meta = opt._meta; delete opt._meta;
      if (opt._note) card.insertAdjacentHTML('beforeend', `<div class="rp-note">${esc(opt._note)}</div>`);
      chartRows(v, opt, L).forEach(x => rows.push(x));
      if (meta && meta.pairs) chart.on('click', p => { const pairs = meta.pairs(p).filter(x => x[0] && x[1] != null); if (pairs.length) toggleMany(pairs); });
      root._charts.push(chart);
    });

    root.querySelectorAll('.rp-chip[data-dim], .rp-row').forEach(b => b.addEventListener('click', () => toggle(b.getAttribute('data-dim'), b.getAttribute('data-raw'))));
    const clr = root.querySelector('.rp-clear'); if (clr) clr.addEventListener('click', () => { state.filters = {}; render(root, spec, reopts); });
    const csvBtn = root.querySelector('.rp-csv'); if (csvBtn) csvBtn.addEventListener('click', () => downloadCsv(root));
    root._title = L.generic ? '' : (spec.title || ''); root._generic = L.generic;
    if (!root._ro && global.ResizeObserver) { root._ro = new ResizeObserver(() => (root._charts || []).forEach(c => c.resize())); root._ro.observe(root); }
  }

  /* ---------- synthetic data as CSV ---------- */
  // One row per data point, read from what is drawn (so filters and the privacy mode apply), in a long
  // "tidy" layout that Excel, Power BI, Tableau, Looker Studio and Sheets all pivot directly.
  function chartRows(v, opt, L) {
    const out = [], S = Array.isArray(opt.series) ? opt.series : [];
    const measName = L.meas((v.measure && v.measure.name) || v.title || 'Value'), fmtName = (v.measure && v.measure.format) || 'number';
    const dimName = L.dim((v.dimension && v.dimension.name) || 'Category');
    const add = (dim, member, series, value, dim2, member2, format) => out.push({ v, dim, member, dim2, member2, series, value, format: format || fmtName });
    const val = d => d == null ? NaN : (typeof d === 'object' && !Array.isArray(d) ? d.value : d);
    const axes = [].concat(opt.xAxis || [], opt.yAxis || []);
    const cats = (axes.find(a => a && a.type === 'category') || {}).data || [];
    switch (v.type) {
      case 'bar': case 'column': case 'histogram': case 'line': case 'area': case 'combo':
        S.forEach(s => (s.data || []).forEach((d, i) => add(dimName, cats[i], s.name, val(d)))); break;
      case 'pie': case 'donut': case 'treemap': case 'funnel':
        ((S[0] || {}).data || []).forEach(d => add(dimName, d.name, measName, d.value)); break;
      case 'waterfall': {
        const up = (S[1] || {}).data || [], down = (S[2] || {}).data || [];
        cats.forEach((c, i) => add(dimName, c, measName, up[i] !== '-' && up[i] != null ? up[i] : -down[i])); break;
      }
      case 'scatter': case 'bubble': {
        const xa = [].concat(opt.xAxis || [])[0] || {}, ya = [].concat(opt.yAxis || [])[0] || {};
        ((S[0] || {}).data || []).forEach(d => { add('Point', d.name, xa.name || 'X', d.value[0], '', '', (v.xMeasure || {}).format); add('Point', d.name, ya.name || 'Y', d.value[1], '', '', (v.yMeasure || v.measure || {}).format); if (v.type === 'bubble') add('Point', d.name, 'Size', d.value[2], '', '', 'number'); });
        break;
      }
      case 'heatmap': {
        const xs = ([].concat(opt.xAxis || [])[0] || {}).data || [], ys = ([].concat(opt.yAxis || [])[0] || {}).data || [];
        ((S[0] || {}).data || []).forEach(d => add(L.dim((v.rows || {}).name || 'Row'), ys[d[1]], measName, d[2], L.dim((v.columns || {}).name || 'Column'), xs[d[0]]));
        break;
      }
      case 'gauge': add('', '', measName, val(((S[0] || {}).data || [])[0])); break;
      case 'boxplot':
        ((S[0] || {}).data || []).forEach((q, i) => ['Min', 'Q1', 'Median', 'Q3', 'Max'].forEach((nm, j) => add(dimName, cats[i], measName + ' · ' + nm, q[j]))); break;
      case 'sankey':
        ((S[0] || {}).links || []).forEach(l => add('Source', l.source, measName, l.value, 'Target', l.target)); break;
      case 'gantt': {
        const st = (S[0] || {}).data || [], len = (S[1] || {}).data || [];
        cats.forEach((c, i) => { add('Task', c, 'Start (% of timeline)', st[i], '', '', 'number'); add('Task', c, 'End (% of timeline)', num(st[i]) + num(val(len[i])), '', '', 'number'); });
        break;
      }
      case 'map':
        S.forEach(s => (s.type === 'map' || s.type === 'scatter' || s.type === 'lines') && (s.data || []).forEach(d => { if (d && d.v != null) add(L.dim(mapDimName(v)), d.label || d.name, measName, d.v, s.type === 'map' && d.label !== d.name && !L.generic ? 'Region' : '', s.type === 'map' && d.label !== d.name && !L.generic ? d.name : ''); }));
        break;
    }
    return out;
  }
  function toCsv(root) {
    const cell = x => {
      if (typeof x === 'number') return Number.isFinite(x) ? String(Math.abs(x) >= 1000 ? Math.round(x) : Math.round(x * 100) / 100) : '';
      let s = String(x == null ? '' : x);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // never a formula when opened in a spreadsheet
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ['visual', 'visual_type', 'dimension', 'member', 'dimension_2', 'member_2', 'series', 'value', 'format', 'synthetic'];
    const idx = new Map(); let n = 0;
    const lines = (root._rows || []).map(r => {
      if (!idx.has(r.v)) idx.set(r.v, ++n);
      const title = !root._generic && r.v.title ? r.v.title : 'Visual ' + idx.get(r.v);
      return [title, r.v.type, r.dim || '', r.member == null ? '' : r.member, r.dim2 || '', r.member2 || '', r.series || '', r.value, r.format || '', 'TRUE'].map(cell).join(',');
    });
    return [head.join(',')].concat(lines).join('\r\n') + '\r\n';
  }
  function downloadCsv(root) {
    const name = (String(root._title || '').replace(/\[client\]/ig, '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/^-|-$/g, '') || 'dashboard') + '-synthetic-data.csv';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + toCsv(root)], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- export: one self-contained file ---------- */
  function exportHtml(spec, opts, libs) {
    const safe = s => s.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${PRODUCT_NAME}"><meta name="synthetic-data" content="true">
<title>${(opts.mode === 'generic' ? 'Dashboard replica' : (spec.title || 'Dashboard replica')).replace(/[<>&"]/g, '')} (synthetic)</title>
<style>body{margin:0;padding:16px;background:#e9ebef;font-family:ui-sans-serif,system-ui,sans-serif}@media (prefers-color-scheme: dark){body{background:#0b0d10}}#app{max-width:1280px;margin:0 auto}</style>
</head><body><div id="app"></div>
<script>${safe(libs.echarts)}</script>
<script>${safe(libs.replica)}</script>
${Object.keys(libs.maps || {}).map(n => `<script>DSCReplica.addMap(${JSON.stringify(n)},${safe(libs.maps[n])});</script>`).join('\n')}
<script>window.DSC_SPEC=${JSON.stringify(cleanSpec(spec)).replace(/</g, '\\u003c')};DSCReplica.render(document.getElementById('app'),window.DSC_SPEC,${JSON.stringify({ mode: opts.mode, seed: opts.seed })});</script>
</body></html>`;
  }

  global.DSCReplica = { render, exportHtml, addMap, loadMap, mapsUsed, toCsv, downloadCsv, MAP_LIST, PRODUCT_NAME, PRODUCT_URL };
})(window);
