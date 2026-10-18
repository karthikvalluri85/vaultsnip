import { describe, expect, it } from 'vitest';
import { entityOf, industryOf, looksReal, orgName, singular, specTexts, type Picker } from '../../src/replica/org-names';
import { columnRole, create } from '../../src/replica/smart-injector';

const healthcare = { title: '[Client] | Patient Outcomes', rows: [{ visuals: [
  { id: 'k', type: 'kpi', title: 'Readmission rate', measure: { name: 'Readmissions', format: 'percent' } },
  { id: 'b', type: 'bar', title: 'Encounters by Hospital', dimension: { name: 'Hospital', members: ['Item 1', 'Item 2', 'Item 3'] } },
  { id: 't', type: 'table', title: 'Top Providers', columns: [{ name: 'Health System', kind: 'org' }, { name: 'Attending Physician', kind: 'person' }, { name: 'Payer', kind: 'text' }] },
] }] };

describe('organisation kinds and industries (Phase 0)', () => {
  it('reads plurals as singulars', () => {
    expect(singular('Top Accounts')).toBe('top account');
    expect(singular('Facilities')).toBe('facility');
    expect(singular('Pharmacies')).toBe('pharmacy');
    expect(singular('Branches')).toBe('branch');
    expect(singular('Status')).toBe('status');
  });

  it('recognises the kind of organisation a dimension names', () => {
    expect(['Hospital', 'Health System', 'Clinic', 'Provider', 'Facilities', 'Practice'].map(entityOf)).toEqual(Array(6).fill('provider'));
    expect(['Payer', 'Insurer', 'Health Plan'].map(entityOf)).toEqual(['payer', 'payer', 'payer']);
    expect(entityOf('Bank')).toBe('bank');
    expect(entityOf('Top Accounts')).toBe('company');
    expect(entityOf('Region')).toBeNull();
    expect(entityOf('Attending Physician')).toBeNull();   // a clinician is a person
  });

  it('turns these dimensions into organisation roles, clinicians into people', () => {
    expect(['Hospital', 'Payer', 'Top Accounts', 'Health Plan', 'Facility'].map((n) => columnRole(n, 'category'))).toEqual(Array(5).fill('company'));
    expect(columnRole('Attending Physician', 'text')).toBe('person');
    expect(columnRole('Provider ID', 'text')).toBe('id');
    expect(columnRole('Region', 'category')).toBeNull();
  });

  it('reads the industry from the dashboard\'s own words', () => {
    expect(industryOf(specTexts(healthcare))).toBe('healthcare');
    expect(industryOf(['Portfolio AUM', 'Loan book', 'Deposits by branch'])).toBe('finance');
    expect(industryOf(['MRR', 'Churn', 'Active users', 'Sessions'])).toBe('technology');
    expect(industryOf(['Region'])).toBe('general');
  });

  it('never produces a well-known real organisation', () => {
    expect(looksReal('Cerner Health')).toBe(true);
    expect(looksReal('Riverbend Health System')).toBe(false);
    let i = 0;
    const p: Picker = { pick: (l) => l[i++ % l.length], city: () => 'Cerner', last: () => 'Kaiser' };   // a hostile picker
    expect(looksReal(orgName(p, 'provider', 'healthcare'))).toBe(false);
  });
});

describe('injector with industry-style names (Phase 0)', () => {
  const inj = create({ seed: 4127, spec: healthcare, locale: 'en_US' });
  const HEALTH = /Health|Medical|Hospital|Clinic|Care|Practice|Life Sciences/;

  it('names covered hospitals like hospitals, not "Item 1"', () => {
    expect(inj.industry).toBe('healthcare');
    const names = [0, 1, 2].map((i) => inj.member('Hospital', 'Item ' + (i + 1), i));
    names.forEach((n) => expect(n).toMatch(HEALTH));
    expect(new Set(names).size).toBe(3);
  });

  it('styles payers, clinicians and the covered client for the industry', () => {
    expect(inj.member('Payer', 'Item 1', 0)).toMatch(/Plan|Benefits|Insurance|Assurance/);
    expect(inj.cell('Attending Physician', 'person', 'r1|1')).toMatch(/^Dr\. \S+ \S+/);
    expect(inj.cell('Health System', 'org', 'r1|0')).toMatch(HEALTH);
    expect(inj.text('[Client] | Patient Outcomes')).toMatch(new RegExp('^(.*(' + HEALTH.source + ').*) \\| Patient Outcomes$'));
    expect(inj.member('Top Accounts', 'Item 1', 0)).not.toBeNull();
  });

  it('stays the same for the same seed and changes with a new one', () => {
    const again = create({ seed: 4127, spec: healthcare, locale: 'en_US' }), other = create({ seed: 99, spec: healthcare, locale: 'en_US' });
    expect(again.member('Hospital', 'Item 1', 0)).toBe(inj.member('Hospital', 'Item 1', 0));
    expect([0, 1, 2].map((i) => other.member('Hospital', 'Item', i))).not.toEqual([0, 1, 2].map((i) => inj.member('Hospital', 'Item', i)));
  });

  it('leaves dimensions that name no organisation alone', () => {
    expect(inj.member('Region', 'Item 1', 0)).toBeNull();
  });
});
