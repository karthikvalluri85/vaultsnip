import { describe, expect, it } from 'vitest';
import { chartTerms, highlight, makeIndex, search, type Doc } from '../../src/replica/search';

describe('replica search (Feature 7)', () => {
  it('reads the names a chart shows, not its numbers', () => {
    const t = chartTerms({
      xAxis: [{ type: 'category', data: ['W1', 'W2', { value: 'W3' }] }, { type: 'value' }],
      yAxis: { type: 'value', data: ['100', '200'] },
      legend: [{ data: ['Sessions', 'Users'] }],
      series: [
        { name: 'Sessions', type: 'line', data: [1, 2, 3] },
        { name: 'series0', type: 'pie', data: [{ name: 'Paid search', value: 4 }, { name: 'Organic', value: 6 }, 7] },
        { type: 'map', data: [{ name: 'India', label: 'India · Bengaluru', value: 3 }] },
        { type: 'sankey', nodes: [{ name: 'Visit' }, { name: 'Checkout' }] },
      ],
    });
    expect(t.category).toEqual(['W1', 'W2', 'W3', 'Paid search', 'Organic', 'India · Bengaluru', 'Visit', 'Checkout']);
    expect(t.series).toEqual(['Sessions', 'Users']);
    expect(chartTerms(null)).toEqual({ category: [], series: [] });
  });

  it('marks the matched words and escapes the rest', () => {
    expect(highlight('Paid <b>search</b>', ['search'])).toBe('Paid &lt;b&gt;<mark>search</mark>&lt;/b&gt;');
    expect(highlight('Sessions by week', ['sess', 'session'])).toBe('<mark>Session</mark>s by week');
    expect(highlight('a.b', ['.'])).toBe('a<mark>.</mark>b');
    expect(highlight('plain', [])).toBe('plain');
  });

  const docs: Doc[] = [
    { id: 0, card: -1, visual: 'Website Performance', field: 'title', text: 'Website Performance' },
    { id: 1, card: -1, visual: 'Filters', field: 'filter', text: 'Paid search', filter: ['channel', 'Paid search'] },
    { id: 2, card: 3, visual: 'Top landing pages', field: 'category', text: '/pricing' },
    { id: 3, card: 4, visual: 'Sessions by channel', field: 'category', text: 'Paid search' },
    { id: 4, card: 4, visual: 'Sessions by channel', field: 'series', text: 'Paid search' },
    { id: 5, card: 6, visual: 'Top accounts', field: 'cell', text: 'Kuschmann GmbH' },
  ];
  const ms = makeIndex(docs);

  it('finds by prefix and despite typos', () => {
    expect(search(ms, 'pric').map((r) => r.text)).toEqual(['/pricing']);
    expect(search(ms, 'pricng').map((r) => r.text)).toEqual(['/pricing']);
    expect(search(ms, 'kuschman').map((r) => r.visual)).toEqual(['Top accounts']);
  });

  it('lists each value once per visual, keeps filter actions, and needs every word', () => {
    const r = search(ms, 'paid search');
    expect(r.map((x) => [x.card, x.text])).toEqual(expect.arrayContaining([[-1, 'Paid search'], [4, 'Paid search']]));
    expect(r.filter((x) => x.card === 4)).toHaveLength(1);
    expect(r.find((x) => x.card === -1)!.filter).toEqual(['channel', 'Paid search']);
    expect(search(ms, 'paid pricing')).toEqual([]);
    expect(search(ms, '   ')).toEqual([]);
  });

  it('limits the result list', () => {
    const many = makeIndex(Array.from({ length: 30 }, (_, i) => ({ id: i, card: i, visual: 'V' + i, field: 'cell' as const, text: 'Item ' + i })));
    expect(search(many, 'item')).toHaveLength(8);
    expect(search(many, 'item', 3)).toHaveLength(3);
  });
});
