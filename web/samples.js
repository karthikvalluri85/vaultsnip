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
    blurb: 'Opens the replica straight away: trend lines, donut, ranked bars, heatmap, funnel, plus world, city and density maps.',
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
            measure: { name: 'Users', format: 'number' }, series: [{ name: 'Users', shape: [100, 64, 28, 16, 9] }] }] },
        { height: 'l', visuals: [
          { id: 'm1', type: 'map', basemap: 'world', mapKind: 'filled', span: 5, title: 'Sessions by country',
            dimension: { name: 'Country', members: ['United States', 'United Kingdom', 'Germany', 'India', 'Canada', 'France', 'Australia', 'Brazil', 'Japan', 'Netherlands', 'Nordics'] },
            measure: { name: 'Sessions', format: 'number' }, series: [{ name: 'Sessions', shape: [100, 46, 41, 38, 27, 24, 18, 15, 13, 11, 9] }] },
          { id: 'm2', type: 'map', basemap: 'europe', mapKind: 'bubble', span: 4, title: 'Sessions by city (Europe)', dimension: { name: 'City' },
            measure: { name: 'Sessions', format: 'number' }, points: [
              { name: 'London', lat: 51.5, lon: -0.13, shape: 100 }, { name: 'Paris', lat: 48.86, lon: 2.35, shape: 64 }, { name: 'Berlin', lat: 52.52, lon: 13.4, shape: 58 },
              { name: 'Madrid', lat: 40.42, lon: -3.7, shape: 41 }, { name: 'Milan', lat: 45.46, lon: 9.19, shape: 33 }, { name: 'Amsterdam', lat: 52.37, lon: 4.9, shape: 37 },
              { name: 'Stockholm', lat: 59.33, lon: 18.07, shape: 22 }, { name: 'Warsaw', lat: 52.23, lon: 21.01, shape: 19 }, { name: 'Dublin', lat: 53.35, lon: -6.26, shape: 26 }] },
          { id: 'm3', type: 'map', basemap: 'india', mapKind: 'density', span: 3, title: 'App opens (India)', dimension: { name: 'Metro' },
            measure: { name: 'App opens', format: 'number' }, points: [
              { name: 'Bengaluru', lat: 12.97, lon: 77.59, shape: 100 }, { name: 'Mumbai', lat: 19.08, lon: 72.88, shape: 86 }, { name: 'Delhi', lat: 28.61, lon: 77.21, shape: 90 },
              { name: 'Hyderabad', lat: 17.39, lon: 78.49, shape: 62 }, { name: 'Chennai', lat: 13.08, lon: 80.27, shape: 55 }, { name: 'Pune', lat: 18.52, lon: 73.86, shape: 48 },
              { name: 'Kolkata', lat: 22.57, lon: 88.36, shape: 40 }, { name: 'Ahmedabad', lat: 23.02, lon: 72.57, shape: 30 }] }] }
      ]
    }
  },
  {
    id: 'finance',
    name: 'Finance and operations report',
    blurb: 'A non-BI style report: waterfall, treemap, bubble, gauge, box plot, Sankey, a table, a US state map and a flow map.',
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
            { name: 'Due', kind: 'date' }, { name: 'Amount', kind: 'currency', currency: '$' }] }] },
        { height: 'l', visuals: [
          { id: 'mu', type: 'map', basemap: 'usa', mapKind: 'filled', span: 6, title: 'Revenue by state',
            dimension: { name: 'State', members: ['California', 'Texas', 'New York', 'Florida', 'Illinois', 'Washington', 'Georgia', 'Ohio', 'Arizona', 'Colorado', 'Massachusetts', 'North Carolina', 'Alaska', 'Hawaii'] },
            measure: { name: 'Revenue', format: 'currency', currency: '$' }, series: [{ name: 'Revenue', shape: [100, 84, 72, 61, 44, 38, 33, 30, 26, 24, 22, 28, 6, 9] }] },
          { id: 'mf', type: 'map', basemap: 'usa', mapKind: 'flow', span: 6, title: 'Shipments from distribution centres', dimension: { name: 'Site' },
            measure: { name: 'Shipments', format: 'integer', scaleHint: 1200 }, points: [
              { name: 'Memphis DC', lat: 35.15, lon: -90.05 }, { name: 'Reno DC', lat: 39.53, lon: -119.81 }, { name: 'Allentown DC', lat: 40.6, lon: -75.49 },
              { name: 'Seattle', lat: 47.61, lon: -122.33 }, { name: 'Los Angeles', lat: 34.05, lon: -118.24 }, { name: 'Denver', lat: 39.74, lon: -104.99 },
              { name: 'Dallas', lat: 32.78, lon: -96.8 }, { name: 'Chicago', lat: 41.88, lon: -87.63 }, { name: 'Atlanta', lat: 33.75, lon: -84.39 },
              { name: 'Miami', lat: 25.76, lon: -80.19 }, { name: 'New York', lat: 40.71, lon: -74.01 }, { name: 'Boston', lat: 42.36, lon: -71.06 }],
            flows: [
              { from: 'Reno DC', to: 'Seattle', shape: 55 }, { from: 'Reno DC', to: 'Los Angeles', shape: 100 }, { from: 'Reno DC', to: 'Denver', shape: 35 },
              { from: 'Memphis DC', to: 'Dallas', shape: 70 }, { from: 'Memphis DC', to: 'Chicago', shape: 80 }, { from: 'Memphis DC', to: 'Atlanta', shape: 60 }, { from: 'Memphis DC', to: 'Miami', shape: 45 },
              { from: 'Allentown DC', to: 'New York', shape: 90 }, { from: 'Allentown DC', to: 'Boston', shape: 40 }, { from: 'Allentown DC', to: 'Chicago', shape: 25 }] }] }
      ]
    }
  }
];
