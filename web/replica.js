/* VaultSnip: replica engine.
   Turns a dashboard spec (structure only, no real values) into an interactive,
   watermarked page with synthetic data. Shared by the app and every exported file.
   Needs window.echarts. No network calls. */
(function (global) {
  'use strict';

  const PRODUCT_NAME = 'VaultSnip';
  const PRODUCT_URL = 'https://github.com/karthikvalluri85/vaultsnip'; // TODO: replace with the live site
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
  function abbr(v, d) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(d ?? 1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(d ?? 1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(d ?? 0) + 'K';
    if (a >= 100) return Math.round(v).toLocaleString('en-US');
    return v.toFixed(d ?? (a < 10 ? 1 : 0));
  }
  function fmt(v, measure, generic) {
    const f = (measure && measure.format) || 'number';
    if (f === 'percent') return v.toFixed(1) + (generic ? '' : '%');
    if (f === 'currency') return (generic ? '' : (measure.currency || '$')) + abbr(v);
    if (f === 'integer') return Math.round(v).toLocaleString('en-US');
    return abbr(v);
  }

  /* ---------- synthetic data ---------- */
  // Each measure gets a hidden scale unrelated to the source. Shapes (0..100) come from the spec.
  let SCALES = {};
  function scaleFor(measure, r) {
    const key = measure ? (String(measure.name || '').toLowerCase() + '|' + (measure.format || '')) : '';
    if (key && SCALES[key]) return SCALES[key];
    const v = rawScale(measure, r);
    if (key) SCALES[key] = v;
    return v;
  }
  function rawScale(measure, r) {
    if (measure && measure.scaleHint) return measure.scaleHint * 1.6 * (0.8 + r() * 0.4);
    const f = (measure && measure.format) || 'number';
    if (f === 'percent') return 100;
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
    let vals = seriesList.map(s => shapeArray(s.shape, n, mode, r, isTrend ? 'trend' : 'cat').map(x => x / 100 * scale));
    // cross-filtering: other dimensions' selections scale this visual; its own dimension's selection keeps only chosen members
    vals = vals.map(a => a.map((x, i) => x * F.factor(v.id, [dimKey].concat(seriesKeys), i)));
    const filterable = ['bar', 'column', 'histogram', 'line', 'area', 'combo', 'pie', 'donut', 'treemap', 'funnel', 'boxplot'].includes(v.type);
    const sel = filterable ? F.sel(dimKey) : null;
    if (sel && sel.length) {
      const keep = membersRaw.map((m, i) => i).filter(i => sel.includes(membersRaw[i]));
      if (keep.length) { members = keep.map(i => members[i]); vals = vals.map(a => keep.map(i => a[i])); n = members.length; }
    }
    let meta = { pairs: p => (p && p.name != null && rawByLabel[p.name] != null) ? [[dimKey, rawByLabel[p.name]]] : [] };
    const base = { color: colors, animation: !ctx.quiet, animationDuration: 300, textStyle: { fontFamily: 'inherit' } };

    switch (v.type) {
      case 'bar': case 'column': case 'histogram': case 'line': case 'area': case 'combo': {
        const horizontal = !!v.horizontal;
        const cat = Object.assign(axisBase(t), { type: 'category', data: members, name: '' });
        if (n <= 8) cat.axisLabel = { color: t.muted, fontSize: 11, interval: 0, hideOverlap: false, width: 80, overflow: 'truncate' };
        const val = Object.assign(axisBase(t), { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, meas, generic) } });
        if (v.type === 'line' || v.type === 'area') val.scale = !v.zeroBased;
        const series = seriesList.map((s, si) => {
          const kind = v.type === 'combo' ? (s.kind || (si === 0 ? 'bar' : 'line')) : (v.type === 'line' || v.type === 'area' ? 'line' : 'bar');
          return {
            name: L.meas(s.name || meas.name), type: kind, stack: v.stacked ? 'total' : undefined,
            areaStyle: v.type === 'area' ? { opacity: v.stacked ? 0.7 : 0.18 } : undefined,
            smooth: false, symbolSize: 7, barMaxWidth: 46, barGap: '15%',
            itemStyle: { borderRadius: v.stacked ? 0 : (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) },
            label: { show: !!v.valueLabels && seriesList.length === 1 && n <= 12, position: horizontal ? 'right' : 'top', color: t.ink, fontSize: 11, formatter: p => fmt(p.value, meas, generic) },
            data: vals[si].map((x, i) => ({ value: x, itemStyle: { opacity: dimOpacity(members[i]) } }))
          };
        });
        if (v.stackedPercent) series.forEach((s, si) => { s.data = s.data.map((d, i) => { const tot = vals.reduce((a, arr) => a + arr[i], 0); return { value: vals[si][i] / tot * 100, itemStyle: d.itemStyle }; }); });
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { trigger: 'axis' }),
          legend: seriesList.length > 1 ? legend : undefined,
          grid: { left: 8, right: 16, top: seriesList.length > 1 ? 32 : (v.valueLabels ? 24 : 12), bottom: 8, containLabel: true },
          xAxis: horizontal ? val : cat, yAxis: horizontal ? Object.assign(cat, { inverse: true }) : val, series
        });
      }
      case 'pie': case 'donut': {
        const data = members.map((m, i) => ({ name: m, value: vals[0][i], itemStyle: { opacity: dimOpacity(m) } }));
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { formatter: p => `${p.name}<br><b>${fmt(p.value, meas, generic)}</b> · ${p.percent}%` }),
          legend: Object.assign({}, legend, { bottom: 0, top: 'auto' }),
          series: [{ type: 'pie', radius: v.type === 'donut' ? ['48%', '72%'] : [0, '72%'], center: ['50%', '45%'], itemStyle: { borderColor: t.surface, borderWidth: 2 }, label: { color: t.ink, fontSize: 11, formatter: '{d}%' }, data }]
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
          tooltip: Object.assign({}, tooltip, { trigger: 'axis', formatter: ps => { const p = ps.find(q => q.seriesIndex > 0 && q.value !== '-'); return p ? `${p.name}<br><b>${(p.seriesIndex === 2 ? '−' : '')}${fmt(p.value, meas, generic)}</b>` : ''; } }),
          grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: members }),
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
          tooltip: Object.assign({}, tooltip, { formatter: p => `${p.name}<br>${L.meas(xM.name)}: <b>${fmt(p.value[0], xM, generic)}</b><br>${L.meas(yM.name)}: <b>${fmt(p.value[1], yM, generic)}</b>` }),
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
        const rIdx = rowsD.members.map((m, i) => i).filter(i => !(rs && rs.length) || rs.includes(rowsD.members[i]));
        const cIdx = colsD.members.map((m, i) => i).filter(i => !(cs && cs.length) || cs.includes(colsD.members[i]));
        const rm = rIdx.map(i => L.member(rowsD.name, rowsD.members[i], i)), cm = cIdx.map(i => L.member(colsD.name, colsD.members[i], i));
        const data = []; let mx = 0;
        rIdx.forEach((ri, a) => cIdx.forEach((ci, b) => { const val = (Number((fullGrid[ri] || [])[ci]) || 0) / 100 * scale * (0.95 + r() * 0.1) * F.factor(v.id, [rk, ck], ri * 31 + ci); mx = Math.max(mx, val); data.push([b, a, val]); }));
        meta = { pairs: p => p && p.value ? [[rk, rowsD.members[rIdx[p.value[1]]]], [ck, colsD.members[cIdx[p.value[0]]]]] : [] };
        return Object.assign(base, { _meta: meta,
          tooltip: Object.assign({}, tooltip, { formatter: p => `${rm[p.value[1]]} · ${cm[p.value[0]]}<br><b>${fmt(p.value[2], meas, generic)}</b>` }),
          grid: { left: 8, right: 8, top: 8, bottom: 44, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: cm, splitArea: { show: false } }),
          yAxis: Object.assign(axisBase(t), { type: 'category', data: rm, splitArea: { show: false } }),
          visualMap: { min: 0, max: mx, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, textStyle: { color: t.muted, fontSize: 10 }, inRange: { color: ['#e8f1fb', '#2a78d6', '#123a6b'] }, formatter: x => fmt(x, meas, generic) },
          series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 1 } }]
        });
      }
      case 'gauge': {
        const pct0 = mode === 'shape' && typeof v.shapeValue === 'number' ? v.shapeValue * (0.97 + r() * 0.06) : 30 + r() * 65;
        const pct = F.key ? Math.max(3, Math.min(100, pct0 * (0.8 + 0.4 * rng(hashStr(v.id + '|' + F.key))()))) : pct0;
        return Object.assign(base, { _meta: meta,
          series: [{ type: 'gauge', min: 0, max: 100, progress: { show: true, width: 14, itemStyle: { color: colors[0] } }, axisLine: { lineStyle: { width: 14, color: [[1, t.grid]] } },
            axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
            title: { show: false }, detail: { valueAnimation: true, fontSize: 26, fontWeight: 700, color: t.ink, offsetCenter: [0, '10%'], formatter: x => x.toFixed(0) + (generic ? '' : '%') }, data: [{ value: pct }] }]
        });
      }
      case 'boxplot': {
        const data = members.map((m, i) => { const f = F.factor(v.id, [dimKey], i); const q = [r() * 20, 20 + r() * 20, 40 + r() * 20, 60 + r() * 20, 80 + r() * 20].map(x => x / 100 * scale * (0.7 + 0.3 * f)); return q; });
        return Object.assign(base, { _meta: meta,
          tooltip, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
          xAxis: Object.assign(axisBase(t), { type: 'category', data: members }),
          yAxis: Object.assign(axisBase(t), { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: x => fmt(x, meas, generic) } }),
          series: [{ type: 'boxplot', data, itemStyle: { color: 'transparent', borderColor: colors[0], borderWidth: 1.5 } }]
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
.rp-kpi .d.up{color:var(--rp-good)} .rp-kpi .d.down{color:var(--rp-bad)}
.rp-kpi svg{display:block;width:100%;height:28px;margin-top:6px}
.rp-table{overflow-x:auto}
.rp-table table{border-collapse:collapse;width:100%;font-size:12.5px}
.rp-table th,.rp-table td{padding:6px 8px;border-bottom:1px solid var(--rp-line);text-align:left;white-space:nowrap}
.rp-table th{background:var(--rp-bg);font-weight:600}
.rp-table td.n{text-align:right;font-variant-numeric:tabular-nums}
.rp-row{cursor:pointer}.rp-row:hover td{background:var(--rp-bg)}
.rp-pill{background:#e8f1fb;border-color:#2a78d6;color:#14181e}
.rp-clear{border-style:dashed}
.rp-ph{display:grid;place-items:center;height:var(--h,200px);border:1px dashed var(--rp-line);border-radius:6px;color:var(--rp-muted);font-size:12.5px;text-align:center;padding:12px}
.rp-text{color:var(--rp-muted);font-size:13px}
.rp-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;padding:10px 18px;border-top:1px solid var(--rp-line);font-size:11.5px;color:var(--rp-muted);background:var(--rp-surface);position:relative;z-index:21}
.rp-foot a{color:var(--rp-muted);text-decoration:underline;text-underline-offset:2px}
@media (max-width:760px){.rp-card{grid-column:span 12 !important}}
`;

  const MODE_NAME = { shape: 'Shape-preserving', structure: 'Structure-only', generic: 'Generic' };

  function render(root, spec, opts) {
    opts = opts || {};
    const mode = opts.mode || 'shape';
    const seed = opts.seed || 4127;
    const L = labelsFor(spec, mode);
    SCALES = {};
    if (!document.getElementById('rp-style')) { const st = document.createElement('style'); st.id = 'rp-style'; st.textContent = CSS; document.head.appendChild(st); }
    (root._charts || []).forEach(c => c.dispose());
    root._charts = [];
    const state = root._state = root._state || { filters: {} };
    if (opts.resetSelection) state.filters = {};
    const reopts = Object.assign({}, opts, { resetSelection: false, _quiet: true });
    const colors = [(spec.theme && spec.theme.primary) || PALETTE[0], (spec.theme && spec.theme.secondary) || PALETTE[1]].concat(PALETTE.slice(2));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const visuals = [];
    (spec.rows || []).forEach(row => (row.visuals || []).forEach(v => visuals.push(Object.assign({ _h: row.height }, v))));

    // ---- filter model: each member of a dimension owns a share of the total; selecting members
    // keeps only those members in visuals on that dimension and scales every other visual by their share
    const dk = x => String(x || '').trim().toLowerCase();
    const shares = {};
    const setShares = (name, list, shape) => {
      const k = dk(name); if (shares[k] || !list || !list.length) return;
      const rr = rng(seed ^ hashStr('share|' + k));
      const arr = (mode === 'shape' && shape && shape.length === list.length) ? shape.map(x => Math.max(0.5, Math.abs(+x) || 0)) : list.map(() => 15 + rr() * 85);
      const tot = arr.reduce((a, b) => a + b, 0); shares[k] = {}; list.forEach((m, i) => { shares[k][m] = arr[i] / tot; });
    };
    visuals.forEach(v => { if (v.dimension) setShares(v.dimension.name, v.dimension.members, v.series && v.series[0] && v.series[0].shape); });
    (spec.filters || []).forEach(f => setShares(f.label, f.members));
    visuals.forEach(v => (Array.isArray(v.columns) ? v.columns : []).forEach(c => { if (c.kind === 'category') setShares(c.name, c.members); }));
    visuals.forEach(v => {
      if (v.type === 'heatmap' && v.rows && v.columns) {
        const m = Array.isArray(v.matrix) ? v.matrix : null;
        setShares(v.rows.name, v.rows.members, m && m.length === v.rows.members.length ? m.map(row => row.reduce((a, b) => a + (+b || 0), 0)) : null);
        setShares(v.columns.name, v.columns.members, m && m[0] && m[0].length === v.columns.members.length ? v.columns.members.map((_, ci) => m.reduce((a, row) => a + (+row[ci] || 0), 0)) : null);
      }
      if (v.type === 'scatter' || v.type === 'bubble') { const n = (v.points && v.points.length) || v.pointCount || 24; setShares('point · ' + (v.title || v.id), Array.from({ length: n }, (_, i) => (v.pointLabel || 'Point') + ' ' + (i + 1))); }
      if (v.type === 'sankey') setShares('node · ' + (v.title || v.id), v.nodes && v.nodes.length ? v.nodes : ['Source A', 'Source B', 'Middle', 'End X', 'End Y']);
    });
    Object.keys(state.filters).forEach(k => { if (!state.filters[k] || !state.filters[k].length) delete state.filters[k]; });
    const active = Object.keys(state.filters);
    const F = {
      active: Object.keys(state.filters).filter(k => state.filters[k] && state.filters[k].length),
      members: k => Object.keys(shares[k] || {}),
      dk, key: Object.keys(state.filters).filter(k => state.filters[k] && state.filters[k].length).sort().map(k => k + '=' + state.filters[k].join(',')).join(';'),
      sel: k => state.filters[k] || null,
      factor(vid, ownKeys, i) {
        let f = 1;
        active.forEach(k => {
          if (ownKeys.includes(k)) return;
          const sh = shares[k] || {};
          const part = state.filters[k].reduce((a, m) => a + (sh[m] || 0), 0) || 0.1;
          const rr = rng(hashStr(vid + '|' + k + '|' + state.filters[k].join(',') + '|' + i));
          f *= Math.min(1, part * (0.85 + 0.3 * rr()));
        });
        return f;
      }
    };
    const toggleMany = pairs => {
      pairs.forEach(([k, raw]) => {
        if (!k || raw == null) return;
        const cur = state.filters[k] ? state.filters[k].slice() : [];
        const at = cur.indexOf(raw); if (at >= 0) cur.splice(at, 1); else cur.push(raw);
        state.filters[k] = cur;
      });
      render(root, spec, reopts);
    };
    const toggle = (k, raw) => toggleMany([[k, raw]]);
    root._toggle = toggleMany;
    const filterHtml = (spec.filters || []).filter(f => f.members && f.members.length).map(f => {
      const k = dk(f.label), on = state.filters[k] || [];
      return `<span class="lbl">${esc(L.dim(f.label))}</span>` + f.members.map((m, i) => `<button type="button" class="rp-chip" data-dim="${esc(k)}" data-raw="${esc(m)}" aria-pressed="${on.includes(m)}">${esc(L.member(f.label, m, i))}</button>`).join('');
    }).join('');
    const chipDims = (spec.filters || []).map(f => dk(f.label));
    const pills = active.filter(k => !chipDims.includes(k)).map(k => state.filters[k].map(m => `<button type="button" class="rp-chip rp-pill" data-dim="${esc(k)}" data-raw="${esc(m)}" aria-pressed="true" title="Remove this filter">${esc(L.generic ? 'Filter' : k)}: ${esc(L.generic ? '•' : m)} ✕</button>`).join('')).join('');
    const filterBar = filterHtml + pills + (active.length ? `<button type="button" class="rp-chip rp-clear">Clear all filters</button>` : '');
    const activeNote = active.length ? `<span>Filtered: ${active.map(k => esc(k) + ' (' + state.filters[k].length + ')').join(', ')}</span>` : '';

    root.className = 'rp';
    root.innerHTML = `
      <div class="rp-head"><h2>${esc(L.generic ? 'Dashboard 1' : (spec.title || 'Dashboard'))}</h2><span>${esc(L.generic ? '' : (spec.subtitle || ''))}</span></div>
      <div class="rp-ribbon"><b>SYNTHETIC DATA</b><span>${MODE_NAME[mode]} mode · seed ${seed}</span><span>Values are generated and are not real figures.</span>${activeNote}</div>
      ${filterBar ? `<div class="rp-filters">${filterBar}</div>` : ''}
      <div class="rp-grid"></div>
      <div class="rp-foot"><span>Synthetic replica · no source values included</span><a href="${PRODUCT_URL}?ref=export" target="_blank" rel="noopener">${FOOTER_TEXT}</a></div>`;
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
        const base = meas.format === 'percent' ? (mode === 'shape' && typeof v.shapeValue === 'number' ? v.shapeValue : 15 + r() * 60) : scaleFor(meas, r) * (meas.scaleHint ? 0.7 + r() * 0.3 : 3 + r() * 4);
        const val = meas.format === 'percent' ? Math.max(0, Math.min(100, base + (active.length ? (rng(hashStr(v.id + '|' + active.map(k => state.filters[k].join(',')).join(';')))() - 0.5) * 8 : 0))) : base * fk;
        const d0 = (r() - 0.35) * 20; const d = F.key ? (rng(hashStr(v.id + '|d|' + F.key))() - 0.4) * 22 : d0; const up = d >= 0;
        const spark = v.sparkline ? (() => { const a = shapeArray(v.sparkShape, 12, mode, F.key ? rng(hashStr(v.id + '|s|' + F.key)) : r, 'trend'); const mx = Math.max(...a), mn = Math.min(...a); return `<svg viewBox="0 0 120 28" preserveAspectRatio="none"><polyline fill="none" stroke="${colors[0]}" stroke-width="1.5" points="${a.map((x, i) => `${i * 120 / 11},${26 - (x - mn) / (mx - mn || 1) * 24}`).join(' ')}"/></svg>`; })() : '';
        card.classList.add('rp-kpi');
        card.innerHTML = `<div class="k">${esc(L.meas(v.title || meas.name))}</div><div class="v">${fmt(val, meas, L.generic)}</div>${v.delta === false ? '' : `<div class="d ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${meas.format === 'percent' ? ' pts' : '%'} vs prior</div>`}${spark}`;
        return;
      }
      if (v.type === 'table') {
        const cols = (v.columns && v.columns.length) ? v.columns : [{ name: 'Item', kind: 'text' }, { name: 'Value', kind: 'number' }];
        const nRows = Math.min(v.rowCount || 5, 25);
        const catCols = cols.filter(c => c.kind === 'category' && c.members && c.members.length);
        const ownKeys = catCols.map(c => dk(c.name));
        const tf = F.factor(v.id, ownKeys, 0);
        const pick = (c, ri) => { const k = dk(c.name), allowed = state.filters[k] && state.filters[k].length ? c.members.filter(m => state.filters[k].includes(m)) : c.members; const pool = allowed.length ? allowed : c.members; return pool[Math.floor(rng(hashStr(v.id + '|' + c.name + '|' + ri + '|' + pool.join(',')))() * pool.length)]; };
        const mScale = scaleFor({ format: 'currency' }, r);
        const ids = Array.from({ length: nRows }, () => Math.floor(r() * 65536).toString(16).toUpperCase().padStart(4, '0'));
        const desc = Array.from({ length: nRows }, () => r()).sort((a, b) => b - a);
        const rowCat = catCols[0];
        const rowsHtml = Array.from({ length: nRows }, (_, ri) => (rowCat ? `<tr class="rp-row" data-dim="${esc(dk(rowCat.name))}" data-raw="${esc(pick(rowCat, ri))}" title="Filter by this ${esc(rowCat.name)}">` : '<tr>') + cols.map((c, ci) => {
          const k = c.kind || 'text';
          const cats = c.members && c.members.length ? c.members : null;
          let cell;
          if (k === 'person') cell = (L.generic ? 'Owner ' : 'Person ') + (1 + ((ri * 7 + ci) % 9));
          else if (k === 'org' || k === 'text') cell = (L.generic ? 'Entity ' : (c.placeholder || 'Item') + ' ') + String(ri + 1).padStart(2, '0');
          else if (k === 'id') cell = (L.generic ? 'ID-' : 'TKN-') + ids[ri];
          else if (k === 'category') { if (cats) { const m = pick(c, ri); cell = L.member(c.name, m, cats.indexOf(m)); } else cell = 'Group ' + 'ABC'[Math.floor(r() * 3)]; }
          else if (k === 'date') cell = '2026-' + String(1 + Math.floor(r() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(r() * 28)).padStart(2, '0');
          else if (k === 'percent') cell = (r() * 100).toFixed(1) + (L.generic ? '' : '%');
          else if (k === 'currency') cell = fmt(desc[ri] * mScale * tf, { format: 'currency', currency: c.currency || (v.measure && v.measure.currency) }, L.generic);
          else cell = abbr((v.sorted ? desc[ri] : r()) * mScale * tf);
          const num = ['number', 'currency', 'percent'].includes(k);
          return `<td class="${num ? 'n' : ''}">${esc(cell)}</td>`;
        }).join('') + '</tr>').join('');
        card.insertAdjacentHTML('beforeend', `<div class="rp-table"><table><thead><tr>${cols.map(c => `<th>${esc(L.generic ? L.dim(c.name) : c.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
        return;
      }
      if (v.type === 'text') { card.insertAdjacentHTML('beforeend', `<p class="rp-text">${esc(L.generic ? 'Text block' : (v.content || 'Text block (content masked)'))}</p>`); return; }
      const opt = buildOption(v, { L, mode, r, t, colors, filter: F, quiet: !!opts._quiet });
      if (!opt) {
        card.insertAdjacentHTML('beforeend', `<div class="rp-ph" style="--h:${h}px">${esc(v.type === 'map' ? 'Map visual recognised. Map rendering arrives in the next release.' : 'Visual type "' + (v.originalType || v.type) + '" recognised; shown as a placeholder.')}</div>`);
        return;
      }
      const el = document.createElement('div');
      el.className = 'rp-chart'; el.style.setProperty('--h', h + 'px');
      card.appendChild(el);
      const chart = global.echarts.init(el, null, { renderer: 'svg' });
      chart.setOption(Object.assign({}, opt, { _meta: undefined }));
      const meta = opt._meta; delete opt._meta;
      if (meta && meta.pairs) chart.on('click', p => { const pairs = meta.pairs(p).filter(x => x[0] && x[1] != null); if (pairs.length) toggleMany(pairs); });
      root._charts.push(chart);
    });

    root.querySelectorAll('.rp-chip[data-dim], .rp-row').forEach(b => b.addEventListener('click', () => toggle(b.getAttribute('data-dim'), b.getAttribute('data-raw'))));
    const clr = root.querySelector('.rp-clear'); if (clr) clr.addEventListener('click', () => { state.filters = {}; render(root, spec, reopts); });
    if (!root._ro && global.ResizeObserver) { root._ro = new ResizeObserver(() => (root._charts || []).forEach(c => c.resize())); root._ro.observe(root); }
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
<script>window.DSC_SPEC=${safe(JSON.stringify(spec))};DSCReplica.render(document.getElementById('app'),window.DSC_SPEC,${JSON.stringify({ mode: opts.mode, seed: opts.seed })});</script>
</body></html>`;
  }

  global.DSCReplica = { render, exportHtml, PRODUCT_NAME, PRODUCT_URL };
})(window);
