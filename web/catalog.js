// VaultSnip chart catalogue (Phase 3): every visual type the replica engine draws, with the data it needs and an example.
// The one place a type is declared: the AI instructions' list of types (web/app.js), the answer checker
// (tools/ai-bench/validate.mjs), the types offered in "Fix it here", the check that every type draws (tools/e2e.mjs) and
// the public page of supported charts (web/charts.html) all read it. Adding a type means adding one entry here.
// Examples are invented; numbers in them are 0-100 shapes, never values.
(function (global) {
  'use strict';
  const dim = (name, members) => ({ name, members });
  const money = (name) => ({ name, format: 'currency', currency: '$' });
  const ENTRIES = [
    { type: 'kpi', label: 'KPI card', fix: true, data: 'measure (name, format), optional delta, sparkline, shapeValue for a percentage',
      example: { type: 'kpi', title: '', measure: money('Net revenue'), sparkline: true } },
    { type: 'column', label: 'Column chart', fix: true, data: 'dimension (members), measure, series (one shape 0-100 per member); stacked, stackedPercent, refLines',
      example: { type: 'column', title: 'Revenue by region', dimension: dim('Region', ['North', 'South', 'East', 'West']), measure: money('Revenue'), series: [{ name: 'Revenue', shape: [100, 72, 55, 38] }], refLines: [{ name: 'Target', shape: 80 }] } },
    { type: 'bar', label: 'Bar chart', fix: true, data: 'as column, with horizontal: true',
      example: { type: 'bar', horizontal: true, title: 'Sessions by page', dimension: dim('Page', ['Home', 'Pricing', 'Blog', 'Signup']), measure: { name: 'Sessions', format: 'number' }, series: [{ name: 'Sessions', shape: [100, 64, 41, 22] }] } },
    { type: 'line', label: 'Line chart', fix: true, data: 'dimension (periods in order), measure, series; refLines',
      example: { type: 'line', title: 'Orders by month', dimension: dim('Month', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']), measure: { name: 'Orders', format: 'integer' }, series: [{ name: 'Orders', shape: [40, 52, 48, 70, 66, 100] }] } },
    { type: 'area', label: 'Area chart', fix: true, data: 'as line; stacked for several series',
      example: { type: 'area', title: 'Visits by month', dimension: dim('Month', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']), measure: { name: 'Visits', format: 'number' }, series: [{ name: 'Visits', shape: [30, 45, 60, 52, 80, 100] }] } },
    { type: 'combo', label: 'Combo (bars and a line)', data: 'as column; each series has kind bar or line, and a line may have its own measure (its own axis)',
      example: { type: 'combo', title: 'Revenue and margin', dimension: dim('Quarter', ['Q1', 'Q2', 'Q3', 'Q4']), measure: money('Revenue'), series: [{ name: 'Revenue', kind: 'bar', shape: [60, 75, 90, 100] }, { name: 'Margin', kind: 'line', measure: { name: 'Margin', format: 'percent' }, shape: [40, 55, 50, 70] }] } },
    { type: 'pie', label: 'Pie chart', fix: true, data: 'dimension, measure, one series',
      example: { type: 'pie', title: 'Sales by channel', dimension: dim('Channel', ['Online', 'Stores', 'Partners']), measure: money('Sales'), series: [{ name: 'Sales', shape: [100, 60, 25] }] } },
    { type: 'donut', label: 'Donut chart', fix: true, data: 'as pie',
      example: { type: 'donut', title: 'Tickets by priority', dimension: dim('Priority', ['High', 'Medium', 'Low']), measure: { name: 'Tickets', format: 'integer' }, series: [{ name: 'Tickets', shape: [40, 100, 70] }] } },
    { type: 'treemap', label: 'Treemap', fix: true, data: 'dimension, measure, one series',
      example: { type: 'treemap', title: 'Cost by department', dimension: dim('Department', ['Operations', 'Sales', 'Technology', 'Finance']), measure: money('Cost'), series: [{ name: 'Cost', shape: [100, 70, 55, 20] }] } },
    { type: 'funnel', label: 'Funnel', fix: true, data: 'dimension (stages in order), measure, one series',
      example: { type: 'funnel', title: 'Sales pipeline', dimension: dim('Stage', ['Lead', 'Qualified', 'Proposal', 'Won']), measure: { name: 'Deals', format: 'integer' }, series: [{ name: 'Deals', shape: [100, 60, 32, 14] }] } },
    { type: 'waterfall', label: 'Waterfall', data: 'dimension (steps), measure, one series of signed steps; the last a total (0)',
      example: { type: 'waterfall', title: 'Revenue to profit', dimension: dim('Step', ['Revenue', 'Costs', 'Opex', 'Profit']), measure: money('Amount'), series: [{ name: 'Amount', shape: [100, -40, -25, 0] }] } },
    { type: 'scatter', label: 'Scatter plot', fix: true, data: 'xMeasure, yMeasure, points [x, y] each 0-100',
      example: { type: 'scatter', title: 'Price and volume', xMeasure: money('Price'), yMeasure: { name: 'Units', format: 'integer' }, points: [[10, 80], [25, 65], [40, 60], [55, 42], [70, 35], [85, 20], [30, 72], [60, 48]] } },
    { type: 'bubble', label: 'Bubble chart', data: 'as scatter, points [x, y, size]',
      example: { type: 'bubble', title: 'Stores: sales and margin', xMeasure: money('Sales'), yMeasure: { name: 'Margin', format: 'percent' }, points: [[20, 35, 30], [48, 50, 60], [62, 58, 80], [78, 66, 90], [35, 42, 45]] } },
    { type: 'heatmap', label: 'Heatmap', fix: true, data: 'rows and columns (members), matrix of 0-100 shades, null for an empty cell',
      example: { type: 'heatmap', title: 'Visits by day and hour', measure: { name: 'Visits', format: 'number' }, rows: dim('Day', ['Mon', 'Tue', 'Wed']), columns: dim('Hour', ['9am', '12pm', '3pm', '6pm']), matrix: [[40, 80, 70, 30], [45, 90, 75, 35], [30, 60, 55, 20]] } },
    { type: 'gauge', label: 'Gauge', fix: true, data: 'measure, shapeValue 0-100, optional min and max',
      example: { type: 'gauge', title: 'Target attainment', shapeValue: 72, measure: { name: 'Attainment', format: 'percent' } } },
    { type: 'boxplot', label: 'Box plot', data: 'dimension, measure, boxes [min, q1, median, q3, max] each 0-100',
      example: { type: 'boxplot', title: 'Delivery time by region', dimension: dim('Region', ['North', 'South', 'East']), measure: { name: 'Days', format: 'integer' }, boxes: [[10, 25, 40, 55, 80], [15, 30, 45, 60, 90], [5, 20, 30, 45, 70]] } },
    { type: 'histogram', label: 'Histogram', data: 'dimension (bins in order), measure, one series',
      example: { type: 'histogram', title: 'Orders by size', dimension: dim('Order size', ['0-50', '50-100', '100-200', '200-500', '500+']), measure: { name: 'Orders', format: 'integer' }, series: [{ name: 'Orders', shape: [60, 100, 70, 30, 8] }] } },
    { type: 'sankey', label: 'Sankey (flows)', data: 'nodes (names), links [source, target, shape 0-100]',
      example: { type: 'sankey', title: 'Where the budget goes', nodes: ['Budget', 'People', 'Programs', 'Salaries', 'Campaigns'], links: [{ source: 0, target: 1, shape: 60 }, { source: 0, target: 2, shape: 40 }, { source: 1, target: 3, shape: 60 }, { source: 2, target: 4, shape: 40 }] } },
    { type: 'gantt', label: 'Gantt / timeline', fix: true, data: 'tasks [name, start, end] on a 0-100 time scale, timeLabels',
      example: { type: 'gantt', title: 'Project plan', tasks: [{ name: 'Design', start: 0, end: 25 }, { name: 'Build', start: 20, end: 65 }, { name: 'Test', start: 55, end: 85 }, { name: 'Launch', start: 85, end: 95 }], timeLabels: ['Q1', 'Q2', 'Q3', 'Q4'] } },
    { type: 'table', label: 'Table', fix: true, data: 'columns (name, kind: category, person, org, id, number, currency, percent…), rowCount',
      example: { type: 'table', title: 'Top accounts', rowCount: 4, columns: [{ name: 'Account', kind: 'org' }, { name: 'Region', kind: 'category', members: ['North', 'South', 'East'] }, { name: 'Revenue', kind: 'currency', currency: '$' }] } },
    { type: 'pivot', label: 'Matrix (pivot)', fix: true, data: 'rowDims and colDims (each a dimension), measures; subtotals, grandTotal',
      example: { type: 'pivot', title: 'Sales by region and quarter', rowDims: [dim('Region', ['North', 'South'])], colDims: [dim('Quarter', ['Q1', 'Q2', 'Q3', 'Q4'])], measures: [money('Sales')], grandTotal: true } },
    { type: 'text', label: 'Text', fix: true, data: 'content: only words visible and not covered',
      example: { type: 'text', title: 'Notes', content: 'Figures are invented for this example.' } },
    { type: 'map', label: 'Map', data: 'basemap (world, europe, usa, india, brazil), mapKind (filled or points), dimension (places), measure, series',
      example: { type: 'map', basemap: 'world', mapKind: 'filled', title: 'Customers by country', dimension: dim('Country', ['United States', 'Germany', 'India', 'Brazil', 'Japan']), measure: { name: 'Customers', format: 'integer' }, series: [{ name: 'Customers', shape: [100, 45, 60, 30, 25] }] } },
    { type: 'placeholder', label: 'Something else', fix: true, data: 'originalType: what it looked like',
      example: { type: 'placeholder', title: 'A visual not drawn', originalType: 'visual' } },
  ];
  const TYPES = ENTRIES.map((e) => e.type);
  const byType = Object.fromEntries(ENTRIES.map((e) => [e.type, e]));
  /** A one-row spec per example, ready for the replica engine (ids and spans filled in). */
  const exampleSpec = (e, i) => ({ title: e.label, rows: [{ height: 'm', visuals: [Object.assign({ id: 'v' + (i + 1), span: 12 }, e.example)] }] });
  const api = { ENTRIES, TYPES, label: (t) => (byType[t] ? byType[t].label : t), fixTypes: () => ENTRIES.filter((e) => e.fix).map((e) => [e.type, e.label]), exampleSpec };
  global.VSCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
