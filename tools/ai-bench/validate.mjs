// Structural checks on a replica spec, as the app's instructions (SYSTEM in web/app.js) define it: what a strict answer
// format would have to prevent (developer tool, used by tools/ai-bench/run.mjs). Returns a list of problems, each a
// short code and where it is; an empty list means the answer is well-formed.
export const TYPES = ['kpi', 'bar', 'column', 'line', 'area', 'combo', 'pie', 'donut', 'treemap', 'funnel', 'waterfall', 'scatter', 'bubble',
  'heatmap', 'gauge', 'boxplot', 'histogram', 'sankey', 'gantt', 'table', 'pivot', 'text', 'map', 'placeholder'];
const SERIES = ['bar', 'column', 'line', 'area', 'combo', 'pie', 'donut', 'treemap', 'funnel', 'waterfall', 'histogram'];

export function validate(spec) {
  const out = [];
  const add = (code, where) => out.push({ code, where });
  if (!spec || typeof spec !== 'object') return [{ code: 'not-an-object', where: '' }];
  if (!Array.isArray(spec.rows) || !spec.rows.length) add('no-rows', '');
  let n = 0;
  (spec.rows || []).forEach((row, ri) => {
    const vs = Array.isArray(row.visuals) ? row.visuals : [];
    if (!['s', 'm', 'l'].includes(row.height)) add('row-height', `row ${ri + 1}`);
    const spans = vs.reduce((a, v) => a + (Number(v.span) || 0), 0);
    if (vs.length && spans !== 12) add('spans-not-12', `row ${ri + 1} (${spans})`);
    vs.forEach((v, vi) => {
      n++;
      const at = `row ${ri + 1} visual ${vi + 1} (${v.type})`;
      if (!TYPES.includes(v.type)) add('unknown-type', at);
      if (!(Number(v.span) >= 1 && Number(v.span) <= 12)) add('span', at);
      if (v.type === 'column' && (v.horizontal === true || v.horizontal === 'true')) add('column-horizontal', at);
      if (SERIES.includes(v.type)) {
        const members = v.dimension && Array.isArray(v.dimension.members) ? v.dimension.members : null;
        if (!members) add('no-dimension', at);
        if (!Array.isArray(v.series) || !v.series.length) add('no-series', at);
        else v.series.forEach((s) => {
          if (!Array.isArray(s.shape)) add('no-shape', at);
          else {
            if (members && s.shape.length !== members.length) add('shape-length', at);
            if (s.shape.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x > 100 || (x < 0 && v.type !== 'waterfall') || x < -100)) add('shape-range', at);
          }
        });
      }
      if (v.type === 'table' && (!Array.isArray(v.columns) || !v.columns.length)) add('no-columns', at);
      if ((v.type === 'scatter' || v.type === 'bubble') && !Array.isArray(v.points)) add('no-points', at);
    });
  });
  if (n > 20) add('over-20-visuals', String(n));
  return out;
}
