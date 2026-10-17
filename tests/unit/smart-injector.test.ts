import { describe, expect, it } from 'vitest';
import { columnRole, create, idPrefix, isPlaceholder, localeFor, localeForPlace } from '../../src/replica/smart-injector';

const mapSpec = (basemap: string) => ({ rows: [{ visuals: [{ id: 'm', type: 'map', basemap }] }] });
const moneySpec = (currency: string) => ({ rows: [{ visuals: [{ id: 'k', type: 'kpi', measure: { name: 'Revenue', format: 'currency', currency } }] }] });

describe('smart data injection (Feature 6): context', () => {
  it('picks the locale from the map first, then the currency', () => {
    expect(localeFor(mapSpec('uk'))).toBe('en_GB');
    expect(localeFor(mapSpec('india'))).toBe('en_IN');
    expect(localeFor(mapSpec('world'))).toBe('en_US');
    expect(localeFor(moneySpec('£'))).toBe('en_GB');
    expect(localeFor(moneySpec('R$'))).toBe('pt_BR');
    expect(localeFor(moneySpec('€'))).toBe('de');
    expect(localeFor(moneySpec('$'))).toBe('en_US');
    expect(localeFor({ rows: [{ visuals: [...mapSpec('japan').rows[0].visuals, ...moneySpec('$').rows[0].visuals] }] })).toBe('ja');
    expect(localeFor(null)).toBe('en_US');
  });

  it('reads what a column holds from its name and kind', () => {
    expect(columnRole('Account manager', 'person')).toBe('person');
    expect(columnRole('Customer', 'org')).toBe('company');
    expect(columnRole('Customer name', 'text')).toBe('company');
    expect(columnRole('Contact email', 'text')).toBe('email');
    expect(columnRole('Email', 'person')).toBe('email');
    expect(columnRole('Phone', 'text')).toBe('phone');
    expect(columnRole('City', 'text')).toBe('city');
    expect(columnRole('Order ID', 'id')).toBe('id');
    expect(columnRole('Product', 'text')).toBe('product');
    expect(columnRole('Notes', 'text')).toBeNull();
    expect(columnRole('Revenue', 'currency')).toBeNull();
  });

  it('builds ID prefixes from the column name', () => {
    expect(idPrefix('Order ID')).toBe('ORD');
    expect(idPrefix('Invoice #')).toBe('INV');
    expect(idPrefix('Ticket')).toBe('TCK');
    expect(idPrefix('ID')).toBe('ID');
  });

  it('recognises covered labels, and nothing else', () => {
    expect(['[Client]', 'Item 2', 'Customer 3', 'Location 4'].every(isPlaceholder)).toBe(true);
    expect(['Paid search', 'EMEA', 'Q3 2025', 'Acme Corp'].some(isPlaceholder)).toBe(false);
  });
});

describe('smart data injection (Feature 6): values', () => {
  const a = create({ seed: 4127, locale: 'en_US' });

  it('is deterministic for a seed and changes with a new seed', () => {
    const b = create({ seed: 4127, locale: 'en_US' }), c = create({ seed: 9001, locale: 'en_US' });
    const keys = ['t|0', 't|1', 't|2', 't|3', 't|4'];
    expect(keys.map(k => a.person(k))).toEqual(keys.map(k => b.person(k)));
    expect(keys.map(k => a.person(k))).not.toEqual(keys.map(k => c.person(k)));
    expect(new Set(keys.map(k => a.company(k))).size).toBeGreaterThan(1);
  });

  it('makes values that look like what the column holds', () => {
    expect(a.person('k')).toMatch(/^\S+ \S+/);
    expect(a.cell('Order ID', 'id', 'r1')).toMatch(/^ORD-\d{5}$/);
    expect(a.city('k').length).toBeGreaterThan(1);
    expect(a.cell('Notes', 'text', 'r1')).toBeNull();
  });

  it('ties an email to the person in the same row', () => {
    const name = a.person('row7|1');
    const email = a.cell('Email', 'text', 'row7|2', 'row7|1')!;
    const [first, last] = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/\s+/);
    expect(email.startsWith(first.replace(/[^a-z]/g, ''))).toBe(true);
    expect(email).toContain(last.replace(/[^a-z]+/g, '.').replace(/\.$/, ''));
  });

  it('never makes a contact detail that can reach anyone', () => {
    const us = create({ seed: 1, locale: 'en_US' }), gb = create({ seed: 1, locale: 'en_GB' }), ja = create({ seed: 1, locale: 'ja' });
    for (let i = 0; i < 40; i++) {
      for (const inj of [us, gb, ja]) expect(inj.email('e' + i, inj.person('p' + i))).toMatch(/^[a-z0-9.]+@example\.(com|net|org)$/);
      expect(us.phone('p' + i)).toMatch(/^\+1 555-01\d\d$/);
      expect(gb.phone('p' + i)).toMatch(/^07700 900\d{3}$/);
    }
  });

  it('fills covered labels from their dimension, and leaves real labels alone', () => {
    expect(a.member('Sales rep', 'Item 1', 0)).toMatch(/^\S+ \S+/);
    expect(a.member('Region', '[Client]', 0)).toBe(a.company('member|region|0'));
    expect(a.member('Customer', 'Item 2', 1)).not.toBeNull();
    expect(a.member('Channel', 'Item 1', 0)).toBeNull();
    expect(a.member('Customer', 'Acme Corp', 0)).toBeNull();
  });

  it('replaces [Client] with one company everywhere on the page', () => {
    const t = a.text('[Client] | Website Performance');
    expect(t).not.toMatch(/\[client\]/i);
    expect(t.endsWith(' | Website Performance')).toBe(true);
    expect(a.text('Revenue for [client]')).toBe('Revenue for ' + t.replace(' | Website Performance', ''));
  });

  it('reads a row\'s country to pick the locale for that row', () => {
    expect(localeForPlace('UK')).toBe('en_GB');
    expect(localeForPlace('United States')).toBe('en_US');
    expect(localeForPlace('Österreich')).toBe('de');
    expect(localeForPlace('EMEA')).toBeNull();
    const eu = create({ seed: 3, locale: 'de' });
    // the same row key in a Japanese row gives a Japanese name, in an unknown region the page locale's
    expect(eu.cell('Account Manager', 'person', 'r1|2', undefined, 'Japan')).toMatch(/[぀-ヿ一-龯]/);
    expect(eu.cell('Account Manager', 'person', 'r1|2', undefined, 'EMEA')).toBe(eu.person('r1|2'));
    expect(eu.phone('p', 'UK')).toMatch(/^07700 900\d{3}$/);
    // a Country column is not re-localised by its own value
    expect(eu.cell('Country', 'text', 'r1|3', undefined, 'Japan')).toBe(eu.country('r1|3'));
  });

  it('uses the dashboard locale for names', () => {
    const jp = create({ seed: 5, spec: mapSpec('japan') });
    expect(jp.locale).toBe('ja');
    expect(jp.person('x')).toMatch(/[぀-ヿ一-龯]/);
  });
});
