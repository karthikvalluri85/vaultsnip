/**
 * Smart data injection (Feature 6), built as web/lib/vs-faker.js (window.VSFaker).
 * Replaces the replica's neutral placeholders ("Person 3", "Company 01", "[Client]", "Item 2", "TKN-4F2A") with realistic
 * synthetic values chosen from context:
 *   - what a value is comes from its column or dimension name and kind (an "Account manager" gets a person's name,
 *     a "Customer" column a company, "Email" an address that matches the person in the same row, "Order ID" ORD-48213);
 *   - which locale comes from the dashboard itself (a UK map or a £ measure gives British names and towns);
 *   - every value is seeded from the replica's seed and its position, so it is stable on screen and in exports, and
 *     "Regenerate data" draws new ones.
 * Values are made up by Faker (MIT) from its name lists. Emails use only the reserved example.com/.net/.org domains
 * (RFC 2606) and phone numbers only ranges set aside for fiction, so no generated contact detail can reach anyone.
 * Runs on the device, no network calls. Generic mode never uses it.
 */
import type { Faker, LocaleDefinition } from '@faker-js/faker';
// The package's main entry builds a Faker for every locale (several MB); the base entry carries the same class without them.
import { faker as baseFaker } from '@faker-js/faker/locale/base';
import slim from './faker-locales.json';

const DATA = slim as unknown as Record<string, LocaleDefinition>;
const FakerClass = baseFaker.constructor as typeof Faker;
// Keep in sync with LOCALES in tools/build-faker.mjs.
export const LOCALES = ['en', 'en_US', 'en_GB', 'en_IN', 'en_CA', 'en_AU', 'en_ZA', 'de', 'fr', 'es', 'es_MX', 'it', 'pt_BR', 'ja', 'zh_CN'] as const;

const hashStr = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ---------- context: locale and roles ---------- */

const BY_MAP: Record<string, string> = {
  usa: 'en_US', uk: 'en_GB', india: 'en_IN', canada: 'en_CA', australia: 'en_AU', 'south-africa': 'en_ZA', germany: 'de',
  france: 'fr', spain: 'es', mexico: 'es_MX', italy: 'it', brazil: 'pt_BR', japan: 'ja', china: 'zh_CN',
};
// Longer symbols first, so "R$" is not read as "R".
const BY_CURRENCY: [RegExp, string][] = [
  [/R\$|BRL/i, 'pt_BR'], [/A\$|AUD/i, 'en_AU'], [/C\$|CAD/i, 'en_CA'], [/MX\$|MXN/i, 'es_MX'], [/£|GBP/i, 'en_GB'], [/₹|INR|Rs\.?/i, 'en_IN'],
  [/¥|JPY/i, 'ja'], [/CNY|RMB|元/i, 'zh_CN'], [/^R$|ZAR/i, 'en_ZA'], [/€|EUR/i, 'de'], [/\$|USD/i, 'en_US'],
];

type Spec = { rows?: { visuals?: Record<string, unknown>[] }[] };

/** The locale a dashboard points to: the country map it shows, else the currency it uses, else US English. */
export function localeFor(spec: unknown): string {
  const visuals = ((spec as Spec)?.rows || []).flatMap((r) => r?.visuals || []).filter(Boolean);
  for (const v of visuals) { const b = String(v.basemap || '').toLowerCase(); if (v.type === 'map' && BY_MAP[b]) return BY_MAP[b]; }
  const currencies: string[] = [];
  const add = (m: unknown) => { const c = m && (m as { currency?: unknown }).currency; if (c) currencies.push(String(c).trim()); };
  visuals.forEach((v) => { [v.measure, v.xMeasure, v.yMeasure].forEach(add); (Array.isArray(v.columns) ? v.columns : []).forEach(add); });
  for (const c of currencies) { const hit = BY_CURRENCY.find(([re]) => re.test(c)); if (hit) return hit[1]; }
  return 'en_US';
}

export type Role = 'person' | 'company' | 'email' | 'phone' | 'city' | 'country' | 'state' | 'product' | 'id';

const ROLE_BY_NAME: [Role, RegExp][] = [
  ['email', /e-?mail/],
  ['phone', /phone|mobile|\btel\b|telephone|cell/],
  ['id', /\b(id|ref|reference|number|no|code|sku)\b|#/],
  ['city', /\b(city|town)\b/],
  ['country', /\b(country|nation|market)\b/],
  ['state', /\b(state|province|county)\b/],
  ['product', /\b(product|plan|offering|item name|model)\b/],
  ['company', /\b(company|customer|client|account|vendor|supplier|partner|organi[sz]ation|brand|merchant|employer|business|firm|tenant)\b/],
  ['person', /\b(name|owner|rep|agent|manager|assignee|contact|user|employee|author|reviewer|lead|advisor|analyst|engineer|seller|buyer|requester|approver|recruiter|candidate|member|person|people|staff)\b/],
];

/** What a column or dimension holds, from its kind and name; null when the name says nothing a fake value could fill. */
export function columnRole(name: string, kind = 'text'): Role | null {
  const n = String(name || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (kind === 'id') return 'id';
  const byName = ROLE_BY_NAME.find(([, re]) => re.test(n));
  if (kind === 'person') return byName && (byName[0] === 'email' || byName[0] === 'phone') ? byName[0] : 'person';
  if (kind === 'org') return 'company';
  if (kind !== 'text' && kind !== 'category') return null;
  if (!byName) return null;
  // "Customer name" or "Account name" is the company, "Customer email" the email
  if (byName[0] === 'person' && /\b(customer|client|account|company|vendor|partner|brand)\b/.test(n)) return 'company';
  return byName[0] === 'id' && kind === 'category' ? null : byName[0];
}

const ID_SKIP = new Set(['ID', 'NO', 'NUM', 'NUMBER', 'REF', 'REFERENCE', 'CODE', 'THE', 'OF']);
/** A short, readable ID prefix from a column name: "Order ID" → ORD, "Invoice #" → INV, "Support ticket" → SPP. */
export function idPrefix(name: string): string {
  const words = String(name || '').normalize('NFKD').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter((w) => w && !ID_SKIP.has(w));
  const w = words[0] || 'ID';
  const skeleton = (w[0] + w.slice(1).replace(/[AEIOU]/g, '')).slice(0, 3);
  return skeleton.length >= 3 ? skeleton : w.slice(0, 3);
}

// Placeholders the replica or the AI uses for covered labels.
const PLACEHOLDER = /^\s*\[?\s*(client|customer|company|account|item|person|user|rep|owner|product|location|city|name|entity|vendor|partner)\s*\]?\s*\d*\s*$/i;
export const isPlaceholder = (s: unknown) => PLACEHOLDER.test(String(s ?? ''));
const CLIENT_TOKEN = /\[(client|customer|company|account)\]/gi;

/* ---------- the injector ---------- */


// Country and region names a row or dimension may carry, to the locale whose names fit there.
const BY_PLACE: [RegExp, string][] = [
  [/^(united states( of america)?|usa|u\.s\.a?\.?|us|america)$/, 'en_US'], [/^(united kingdom|uk|u\.k\.|great britain|britain|england|scotland|wales|northern ireland)$/, 'en_GB'],
  [/^(india|bharat)$/, 'en_IN'], [/^canada$/, 'en_CA'], [/^australia$/, 'en_AU'], [/^(south africa|rsa)$/, 'en_ZA'],
  [/^(germany|deutschland|austria|österreich|switzerland|schweiz|dach)$/, 'de'], [/^(france|belgium|belgique|luxembourg)$/, 'fr'],
  [/^(spain|españa)$/, 'es'], [/^(mexico|méxico)$/, 'es_MX'], [/^(italy|italia)$/, 'it'], [/^(brazil|brasil)$/, 'pt_BR'],
  [/^(japan|nippon)$/, 'ja'], [/^(china|prc)$/, 'zh_CN'],
];
/** The locale for a country or region name, or null when it names none of them. */
export function localeForPlace(place: unknown): string | null {
  const p = String(place ?? '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const hit = p && BY_PLACE.find(([re]) => re.test(p));
  return hit ? hit[1] : null;
}

export interface InjectorOptions { seed: number; spec?: unknown; locale?: string }

/** Every generator takes an optional `place` (a row's country, for example) that picks the locale for that one value. */
export interface Injector {
  readonly locale: string;
  person(key: string, place?: string): string;
  company(key: string, place?: string): string;
  email(key: string, person?: string): string;
  phone(key: string, place?: string): string;
  city(key: string, place?: string): string;
  country(key: string, place?: string): string;
  state(key: string, place?: string): string;
  product(key: string, place?: string): string;
  id(columnName: string, key: string): string;
  /** A value for a role; null when the role is unknown. */
  value(role: Role | null, key: string, o?: { columnName?: string; person?: string; place?: string }): string | null;
  /** A table cell from its column's name and kind. `rowPersonKey` ties an email to the row's person; `place` is the row's country. */
  cell(columnName: string, kind: string, key: string, rowPersonKey?: string, place?: string): string | null;
  /** A realistic label for a covered member ("[Client]", "Item 2"), from its dimension name; null to keep it. */
  member(dimName: string, raw: unknown, index: number): string | null;
  /** Text with "[Client]" tokens replaced, the same company everywhere on the page. */
  text(s: string): string;
}

export function create(o: InjectorOptions): Injector {
  const locale = o.locale && DATA[o.locale] ? o.locale : localeFor(o.spec);
  const seed = Number.isFinite(o.seed) ? o.seed : 4127;
  const fakers = new Map<string, Faker>();
  const fakerFor = (code: string) => {
    let f = fakers.get(code);
    if (!f) { f = new FakerClass({ locale: code === 'en' ? [DATA.en] : [DATA[code], DATA.en] }); fakers.set(code, f); }
    return f;
  };
  const cache = new Map<string, string>();
  // one value per kind, key and locale, seeded from the replica's seed: stable on screen, new after "Regenerate data"
  const draw = (kind: string, key: string, place: string | undefined, make: (f: Faker, code: string) => string) => {
    const code = localeForPlace(place) || locale;
    const k = kind + '|' + code + '|' + key;
    let v = cache.get(k);
    if (v == null) { const f = fakerFor(code); f.seed(hashStr(seed + '|' + k)); v = make(f, code); cache.set(k, v); }
    return v;
  };
  const ascii = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

  const inj: Injector = {
    locale,
    person: (key, place) => draw('person', key, place, (f, code) => (code === 'ja' || code === 'zh_CN' ? `${f.person.lastName()} ${f.person.firstName()}` : `${f.person.firstName()} ${f.person.lastName()}`)),
    company: (key, place) => draw('company', key, place, (f) => f.company.name()),
    email: (key, person) => draw('email', key + '|' + (person || ''), undefined, (f) => {
      const local = ascii(person || '') || 'user' + f.number.int({ min: 10, max: 9999 });
      return `${local}@example.${f.helpers.arrayElement(['com', 'net', 'org'])}`;
    }),
    // Ofcom keeps 07700 900000-900999 for drama in the UK; 555-0100 to 555-0199 is fictional in North America.
    phone: (key, place) => draw('phone', key, place, (f, code) => (code === 'en_GB' ? `07700 900${String(f.number.int({ min: 0, max: 999 })).padStart(3, '0')}` : `+1 555-01${String(f.number.int({ min: 0, max: 99 })).padStart(2, '0')}`)),
    city: (key, place) => draw('city', key, place, (f) => f.location.city()),
    country: (key, place) => draw('country', key, place, (f) => f.location.country()),
    state: (key, place) => draw('state', key, place, (f) => (f.definitions.location?.state ? f.location.state() : f.location.city())),
    product: (key, place) => draw('product', key, place, (f) => (f.definitions.commerce?.product_name ? f.commerce.productName() : f.commerce.department())),
    id: (columnName, key) => draw('id', columnName + '|' + key, undefined, (f) => `${idPrefix(columnName)}-${f.number.int({ min: 10000, max: 99999 })}`),
    value(role, key, { columnName = '', person, place } = {}) {
      switch (role) {
        case 'person': return inj.person(key, place);
        case 'company': return inj.company(key, place);
        case 'email': return inj.email(key, person);
        case 'phone': return inj.phone(key, place);
        case 'city': return inj.city(key, place);
        case 'country': return inj.country(key, place);
        case 'state': return inj.state(key, place);
        case 'product': return inj.product(key, place);
        case 'id': return inj.id(columnName, key);
        default: return null;
      }
    },
    cell(columnName, kind, key, rowPersonKey, place) {
      const role = columnRole(columnName, kind);
      // a country column names the place itself, so it is not used to pick its own locale
      return inj.value(role, key, { columnName, place: role === 'country' ? undefined : place, person: role === 'email' && rowPersonKey ? inj.person(rowPersonKey, place) : undefined });
    },
    member(dimName, raw, index) {
      if (!isPlaceholder(raw)) return null;
      const r = String(raw);
      const role = columnRole(dimName, 'text') || (/client|customer|company|account|vendor|partner|entity/i.test(r) ? 'company' : /person|user|rep|owner|name/i.test(r) ? 'person' : /city|location/i.test(r) ? 'city' : /product|item/i.test(r) && /product|plan|sku|item/i.test(dimName) ? 'product' : null);
      if (!role || role === 'email' || role === 'phone' || role === 'id') return null;
      return inj.value(role, 'member|' + String(dimName).toLowerCase() + '|' + index);
    },
    text: (s) => String(s ?? '').replace(CLIENT_TOKEN, () => inj.company('client')),
  };
  return inj;
}
