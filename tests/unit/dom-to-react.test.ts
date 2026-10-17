import { describe, expect, it } from 'vitest';
import { COMPONENTS_TSX, pageTsx, TYPES_TS, useReplicaTs, type PageLayout } from '../../src/exporters/dom-to-react';

const layout: PageLayout = {
  title: 'Sales */ {evil}',
  filters: true,
  cards: [
    { vid: 'k1', component: 'kpi', span: 3, height: 120, title: 'Net Revenue' },
    { vid: 'c1', component: 'chart', span: 9, height: 340, title: 'Revenue */ by {month}' },
    { vid: 't"1', component: 'table', span: 12, height: 0, title: 'Top accounts' },
    { vid: 'p1', component: 'placeholder', span: 6, height: 200, title: '' },
  ],
};

describe('DOM to React (Feature 8)', () => {
  const src = pageTsx(layout, { name: 'SalesReplica', mode: 'structure', seed: 42, realistic: true });

  it('writes one typed component per card, in page order, with its span', () => {
    const cards = [...src.matchAll(/<(\w+Card) v=\{r\.visual\(("(?:[^"\\]|\\.)*"), "(\w+)"\)\} span=\{(\d+)\}/g)].map((m) => [m[1], JSON.parse(m[2]), m[3], +m[4]]);
    expect(cards).toEqual([['KpiCard', 'k1', 'kpi', 3], ['ChartCard', 'c1', 'chart', 9], ['TableCard', 't"1', 'table', 12], ['PlaceholderCard', 'p1', 'placeholder', 6]]);
    expect(src).toMatch(/<ChartCard [^\n]*height=\{340\} onToggle=\{r\.toggle\}/);
    expect(src).toMatch(/import \{ Replica, Header, Ribbon, FilterBar, Grid, Footer, KpiCard, ChartCard, TableCard, PlaceholderCard \} from '\.\/components';/);
    expect(src).toMatch(/<FilterBar /);
    expect(pageTsx({ ...layout, filters: false }, { name: 'X', mode: 'shape', seed: 1, realistic: false })).not.toMatch(/<FilterBar /);
  });

  it('takes its defaults from the export: seed, privacy level, realistic names', () => {
    expect(src).toMatch(/export default function SalesReplica\(\{ seed = 42, mode = "structure", realistic = true \}: SalesReplicaProps\)/);
  });

  it('keeps page text from breaking out of comments or JSX', () => {
    expect(src).not.toMatch(/\*\/ by|\{evil\}|\{month\}/);
    expect(src).toMatch(/\{\/\* Revenue \* \/ by month \*\/\}/);
  });

  it('loads the name generator and the search box only when they are shipped', () => {
    const both = useReplicaTs({ mode: 'shape', faker: true, search: true });
    expect(both).toMatch(/import '\.\/vaultsnip-faker\.js';\nimport '\.\/vaultsnip-search\.js';\nimport '\.\/vaultsnip-replica\.js';/);
    expect(both).toMatch(/realistic: realistic, filters/);
    const none = useReplicaTs({ mode: 'generic', faker: false, search: false });
    expect(none).not.toMatch(/vaultsnip-faker|vaultsnip-search/);
    expect(none).toMatch(/realistic: false, filters/);
    expect(none).toMatch(/export const EXPORTED: Mode = "generic";/);
  });

  it('draws everything from the model: no values in the components or types', () => {
    expect(COMPONENTS_TSX).toMatch(/c\.setOption\(v\.option as echarts\.EChartsOption, true\)/);
    expect(COMPONENTS_TSX).toMatch(/SYNTHETIC DATA/);
    expect(TYPES_TS).toMatch(/export type VisualModel = KpiModel \| ChartModel \| TableModel \| FeedModel \| TextModel \| PlaceholderModel;/);
  });
});
