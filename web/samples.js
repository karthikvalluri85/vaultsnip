/* Bundled samples. All companies, people and figures are fictional.
   Sample 1 runs the full local redaction pipeline on a real image, then uses this
   pre-built spec instead of calling Claude, so no key is needed. */
window.DSC_SAMPLES = [
  {
    id: 'sales',
    name: 'EMEA sales dashboard',
    blurb: 'Runs the full local redaction demo on a real screenshot: OCR, masking, re-scan gate, then the replica.',
    image: 'samples/kestrelmoor.png',
    clientNames: 'Kestrelmoor',
    spec: {
      title: '[Client] | EMEA Sales Performance', subtitle: 'YTD Jan–Sep 2026',
      theme: { primary: '#4e79a7', secondary: '#f28e2b' },
      filters: [{ label: 'Country', members: ['Germany', 'UK', 'France', 'Italy', 'Spain', 'Netherlands', 'Nordics'] }],
      rows: [
        { height: 's', visuals: [
          { id: 'k1', type: 'kpi', span: 3, title: 'Net Revenue', measure: { name: 'Net Revenue', format: 'currency', currency: '€' } },
          { id: 'k2', type: 'kpi', span: 3, title: 'Units Sold', measure: { name: 'Units Sold', format: 'number' } },
          { id: 'k3', type: 'kpi', span: 3, title: 'Gross Margin', measure: { name: 'Gross Margin', format: 'percent' } },
          { id: 'k4', type: 'kpi', span: 3, title: 'Active Accounts', measure: { name: 'Active Accounts', format: 'integer', scaleHint: 200 } }] },
        { height: 'm', visuals: [
          { id: 'c1', type: 'column', span: 6, title: 'Net Revenue by Country', valueLabels: true,
            dimension: { name: 'Country', members: ['Germany', 'UK', 'France', 'Italy', 'Spain', 'Netherlands', 'Nordics'] },
            measure: { name: 'Net Revenue', format: 'currency', currency: '€' }, series: [{ name: 'Net Revenue', shape: [100, 79, 65, 51, 42, 31, 23] }] },
          { id: 'c2', type: 'line', span: 6, title: 'Monthly Net Revenue',
            dimension: { name: 'Month', members: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'] },
            measure: { name: 'Net Revenue', format: 'currency', currency: '€' }, series: [{ name: 'Net Revenue', shape: [30, 38, 55, 43, 50, 63, 40, 34, 100] }] }] },
        { height: 'm', visuals: [
          { id: 't1', type: 'table', span: 12, title: 'Top 5 Accounts', rowCount: 5, sorted: true, columns: [
            { name: 'Account', kind: 'org', placeholder: 'Account' }, { name: 'Account ID', kind: 'id' }, { name: 'Account Manager', kind: 'person' },
            { name: 'Country', kind: 'category', members: ['Germany', 'UK', 'France', 'Italy'] }, { name: 'Net Revenue', kind: 'currency', currency: '€' }] }] }
      ]
    }
  },
  {
    id: 'web',
    name: 'Web analytics overview',
    blurb: 'Opens the replica straight away: trend lines, donut, ranked bars, day-by-hour heatmap and a funnel.',
    spec: {
      title: '[Client] | Website Performance', subtitle: 'Last 12 weeks',
      filters: [{ label: 'Channel', members: ['Organic', 'Paid search', 'Direct', 'Social', 'Email', 'Referral'] }],
      rows: [
        { height: 's', visuals: [
          { id: 'k1', type: 'kpi', span: 3, title: 'Sessions', measure: { name: 'Sessions', format: 'number' }, sparkline: true },
          { id: 'k2', type: 'kpi', span: 3, title: 'Users', measure: { name: 'Users', format: 'number' }, sparkline: true },
          { id: 'k3', type: 'kpi', span: 3, title: 'Bounce rate', measure: { name: 'Bounce rate', format: 'percent' } },
          { id: 'k4', type: 'kpi', span: 3, title: 'Conversion rate', measure: { name: 'Conversion rate', format: 'percent' }, sparkline: true }] },
        { height: 'm', visuals: [
          { id: 'l1', type: 'line', span: 8, title: 'Sessions and users by week',
            dimension: { name: 'Week', members: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'] },
            measure: { name: 'Sessions', format: 'number' },
            series: [{ name: 'Sessions', shape: [62, 66, 64, 70, 74, 71, 78, 83, 80, 88, 94, 100] }, { name: 'Users', shape: [44, 46, 45, 50, 52, 50, 55, 58, 57, 62, 66, 70] }] },
          { id: 'd1', type: 'donut', span: 4, title: 'Sessions by channel',
            dimension: { name: 'Channel', members: ['Organic', 'Paid search', 'Direct', 'Social', 'Email', 'Referral'] },
            measure: { name: 'Sessions', format: 'number' }, series: [{ name: 'Sessions', shape: [100, 62, 48, 30, 18, 12] }] }] },
        { height: 'm', visuals: [
          { id: 'b1', type: 'bar', horizontal: true, span: 4, title: 'Top landing pages',
            dimension: { name: 'Page', members: ['/home', '/pricing', '/blog/guide', '/features', '/signup', '/contact'] },
            measure: { name: 'Sessions', format: 'number' }, series: [{ name: 'Sessions', shape: [100, 58, 44, 39, 30, 17] }] },
          { id: 'h1', type: 'heatmap', span: 5, title: 'Sessions by day and hour', measure: { name: 'Sessions', format: 'number' },
            rows: { name: 'Day', members: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
            columns: { name: 'Hour', members: ['00', '03', '06', '09', '12', '15', '18', '21'] },
            matrix: [[5, 3, 12, 70, 85, 80, 55, 25], [6, 3, 14, 75, 90, 84, 58, 27], [5, 2, 13, 78, 95, 88, 60, 28], [6, 3, 12, 74, 92, 86, 57, 26], [7, 4, 11, 66, 80, 70, 45, 30], [12, 6, 8, 30, 45, 50, 48, 35], [10, 5, 7, 25, 40, 46, 50, 32]] },
          { id: 'f1', type: 'funnel', span: 3, title: 'Checkout funnel',
            dimension: { name: 'Step', members: ['Visit', 'Product view', 'Add to cart', 'Checkout', 'Purchase'] },
            measure: { name: 'Users', format: 'number' }, series: [{ name: 'Users', shape: [100, 64, 28, 16, 9] }] }] }
      ]
    }
  },
  {
    id: 'finance',
    name: 'Finance and operations report',
    blurb: 'A non-BI style report: waterfall, treemap, bubble, gauge, stacked columns, box plot, Sankey and a table.',
    spec: {
      title: '[Client] | Monthly Finance & Operations Review', subtitle: 'FY26, period 6',
      filters: [{ label: 'Segment', members: ['Retail', 'Wholesale', 'Online'] }],
      rows: [
        { height: 's', visuals: [
          { id: 'k1', type: 'kpi', span: 3, title: 'Revenue', measure: { name: 'Amount', format: 'currency', currency: '$' } },
          { id: 'k2', type: 'kpi', span: 3, title: 'EBITDA margin', measure: { name: 'EBITDA margin', format: 'percent' } },
          { id: 'k3', type: 'kpi', span: 3, title: 'Cash on hand', measure: { name: 'Cash on hand', format: 'currency', currency: '$' } },
          { id: 'k4', type: 'kpi', span: 3, title: 'Headcount', measure: { name: 'Headcount', format: 'integer', scaleHint: 900 } }] },
        { height: 'm', visuals: [
          { id: 'w1', type: 'waterfall', span: 7, title: 'Revenue to EBITDA',
            dimension: { name: 'Step', members: ['Revenue', 'COGS', 'Opex', 'Marketing', 'R&D', 'Other', 'EBITDA'] },
            measure: { name: 'Amount', format: 'currency', currency: '$' }, series: [{ name: 'Amount', shape: [100, -38, -18, -9, -11, -4, 0] }] },
          { id: 'g1', type: 'gauge', span: 5, title: 'Target attainment', shapeValue: 78, measure: { name: 'Attainment', format: 'percent' } }] },
        { height: 'm', visuals: [
          { id: 's1', type: 'column', stacked: true, span: 6, title: 'Revenue by quarter and segment',
            dimension: { name: 'Quarter', members: ['Q1', 'Q2', 'Q3', 'Q4'] }, measure: { name: 'Revenue', format: 'currency', currency: '$' },
            series: [{ name: 'Retail', shape: [50, 54, 58, 66] }, { name: 'Wholesale', shape: [30, 31, 29, 34] }, { name: 'Online', shape: [14, 18, 22, 30] }] },
          { id: 'tm', type: 'treemap', span: 6, title: 'Operating cost by department',
            dimension: { name: 'Department', members: ['Operations', 'Sales', 'Technology', 'Marketing', 'Finance', 'HR', 'Legal'] },
            measure: { name: 'Cost', format: 'currency', currency: '$' }, series: [{ name: 'Cost', shape: [100, 72, 64, 40, 22, 18, 12] }] }] },
        { height: 'm', visuals: [
          { id: 'bu', type: 'bubble', span: 6, title: 'Stores: sales vs margin', xMeasure: { name: 'Sales', format: 'currency', currency: '$' }, yMeasure: { name: 'Margin', format: 'percent' },
            points: [[20, 35, 30], [35, 42, 45], [48, 50, 60], [55, 38, 40], [62, 58, 80], [70, 47, 55], [78, 66, 90], [85, 54, 70], [40, 61, 35], [28, 52, 25], [90, 72, 100], [66, 30, 50]] },
          { id: 'bx', type: 'boxplot', span: 6, title: 'Delivery time by region', dimension: { name: 'Region', members: ['North', 'South', 'East', 'West'] }, measure: { name: 'Days', format: 'integer', scaleHint: 40 } }] },
        { height: 'm', visuals: [
          { id: 'sk', type: 'sankey', span: 6, title: 'Where the budget goes', nodes: ['Budget', 'People', 'Programs', 'Salaries', 'Contractors', 'Campaigns', 'Tools'],
            links: [{ source: 0, target: 1, shape: 60 }, { source: 0, target: 2, shape: 40 }, { source: 1, target: 3, shape: 45 }, { source: 1, target: 4, shape: 15 }, { source: 2, target: 5, shape: 25 }, { source: 2, target: 6, shape: 15 }] },
          { id: 'tb', type: 'table', span: 6, title: 'Open purchase orders', rowCount: 6, sorted: true, columns: [
            { name: 'PO number', kind: 'id' }, { name: 'Supplier', kind: 'org', placeholder: 'Supplier' }, { name: 'Owner', kind: 'person' },
            { name: 'Due', kind: 'date' }, { name: 'Amount', kind: 'currency', currency: '$' }] }] }
      ]
    }
  }
];
