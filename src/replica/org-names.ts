/**
 * Convincing synthetic organisation names (Feature 6, Phase 0 of the key-free roadmap).
 * A masked hospital should become "Riverbend Health System", not "Item 1" or "Gutmann Inc": the kind of organisation
 * comes from the dimension or column name, and the naming style from the dashboard's own visible words (its industry).
 * Names are assembled from Faker's seeded city and surname lists and the word lists below; every name is checked
 * against well-known real brands and drawn again if it matches one.
 */

export type Industry = 'healthcare' | 'insurance' | 'finance' | 'retail' | 'technology' | 'logistics' | 'education' | 'manufacturing' | 'general';
export type Entity = 'provider' | 'payer' | 'pharmacy' | 'bank' | 'fund' | 'school' | 'store' | 'carrier' | 'agency' | 'manufacturer' | 'company';

/** Plural and singular read the same: "Top Accounts" is an account, "Facilities" a facility. */
export function singular(text: string): string {
  return String(text || '').toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/).map((w) => (w.length < 4 ? w
    : w.endsWith('ies') ? w.slice(0, -3) + 'y'
    : /(ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2)
    : /[^su]s$/.test(w) ? w.slice(0, -1) : w)).join(' ');
}

// Order matters: the first match wins ("health plan" is a payer before "plan" could mean a product).
const ENTITY_BY_NAME: [Entity, RegExp][] = [
  ['payer', /\b(payer|payor|insurer|health plan|insurance (company|carrier|provider)|underwriter)\b/],
  ['provider', /\b(hospital|health system|clinic|practice|provider|facility|medical (center|group)|care site|physician group|health center|surgery center)\b/],
  ['pharmacy', /\b(pharmacy|drugstore|dispensary)\b/],
  ['bank', /\b(bank|lender|credit union)\b/],
  ['fund', /\b(fund|asset manager|investment firm)\b/],
  ['school', /\b(school|university|college|campus|school district|academy)\b/],
  ['store', /\b(store|retailer|outlet|shop|dealership|branch)\b/],
  ['carrier', /\b(carrier|shipper|forwarder|3pl|courier)\b/],
  ['agency', /\b(agency)\b/],
  ['manufacturer', /\b(manufacturer|maker|oem|plant operator)\b/],
  ['company', /\b(company|customer|client|account|vendor|supplier|partner|organi[sz]ation|brand|merchant|employer|business|firm|tenant|payee|distributor|reseller|competitor)\b/],
];

/** The kind of organisation a dimension or column name refers to, or null when it names no organisation. */
export function entityOf(name: string): Entity | null {
  const n = singular(name);
  // "Provider name" in a healthcare report can be a clinician; those are handled as people (PHYSICIAN)
  if (PHYSICIAN.test(n)) return null;
  const hit = ENTITY_BY_NAME.find(([, re]) => re.test(n));
  return hit ? hit[0] : null;
}

/** Clinicians: shown as "Dr. First Last". */
export const PHYSICIAN = /\b(physician|doctor|clinician|surgeon|attending|prescriber|rendering provider|referring provider)\b/;

const INDUSTRY_WORDS: [Industry, RegExp][] = [
  ['healthcare', /\b(patient|clinic|hospital|admission|readmission|encounter|diagnos[ie]s|physician|nurse|bed|icd|medication|prescription|lab test|care|health|medical|discharge|length of stay|surgery|appointment|visit|provider)\b/g],
  ['insurance', /\b(premium|policy|policie|underwriting|loss ratio|claim|payer|broker|coverage|insured|deductible)\b/g],
  ['finance', /\b(portfolio|aum|loan|deposit|fund|trading|credit|interest|asset|equity|yield|nav|bank|revenue|ebitda|margin|cogs|expense|budget|cash)\b/g],
  ['retail', /\b(store|sku|basket|shopper|merchandise|inventory|footfall|aov|unit sold|pos|order|product|category|discount|return)\b/g],
  ['technology', /\b(mrr|arr|churn|subscription|user|session|signup|dau|mau|uptime|ticket|api|saas|deployment|crash|install|release|page view|bounce)\b/g],
  ['logistics', /\b(shipment|freight|carrier|delivery|warehouse|on time|route|fleet|pallet|transit|lane)\b/g],
  ['education', /\b(student|enrollment|enrolment|course|grade|gpa|school|campus|faculty|attendance|graduation)\b/g],
  ['manufacturing', /\b(production|defect|downtime|plant|oee|scrap|machine|throughput|supplier quality|work order)\b/g],
];

/** The industry a dashboard's visible words point to; "general" when no industry stands out. */
export function industryOf(texts: readonly string[]): Industry {
  const t = singular(texts.join(' '));
  let best: Industry = 'general', score = 1;   // at least two hits are needed
  for (const [ind, re] of INDUSTRY_WORDS) {
    const n = (t.match(re) || []).length;
    // healthcare beats finance on a tie: a hospital dashboard also talks about revenue
    if (n > score || (n === score && n > 1 && ind === 'healthcare')) { best = ind; score = n; }
  }
  return best;
}

/** Every piece of text a dashboard spec shows (titles, labels, names), to read its industry from. */
export function specTexts(spec: unknown): string[] {
  const out: string[] = [];
  const walk = (o: unknown, key = '') => {
    if (typeof o === 'string') { if (!/^(type|kind|format|id|basemap|mapKind|originalType|currency|unit)$/.test(key)) out.push(o); }
    else if (Array.isArray(o)) { if (key !== 'values') o.forEach((x) => walk(x, key)); }   // customer comment wording is not used
    else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => walk(v, k));
  };
  walk(spec);
  return out;
}

// Neutral place-like words for names; combined with city and surname lists they make plausible, invented names.
const NATURE = ['Riverbend', 'Larkspur', 'Clearwater', 'Northgate', 'Maplewood', 'Silverline', 'Cedar Ridge', 'Bluestone', 'Harborview', 'Oakmont',
  'Willow Creek', 'Brightwater', 'Ashford', 'Fairhaven', 'Pinecrest', 'Stonebridge', 'Meadowbrook', 'Lakeshore', 'Foxglove', 'Juniper',
  'Copperfield', 'Westbrook', 'Hollowell', 'Amberly', 'Kingsmere', 'Redfern', 'Thornbury', 'Glenbrook', 'Sandpiper', 'Larchmont'];
const SAINTS = ['Adeline', 'Fintan', 'Mirabel', 'Ottilie', 'Perpetua', 'Theodora', 'Isidore', 'Leocadia', 'Remigius', 'Seraphina', 'Wilfrid', 'Euphemia'];

const BY_ENTITY: Record<Exclude<Entity, 'company'>, string[]> = {
  provider: ['{N} Health System', '{L} Medical Group', 'St. {S} Regional Hospital', '{C} Community Hospital', '{N} Medical Center', '{N} Family Practice', '{C} Health Partners', '{N} Care Clinic'],
  payer: ['{N} Health Plan', '{C} Benefits Group', '{L} Mutual Insurance', '{N} Assurance', '{N} Care Plan'],
  pharmacy: ['{L} Pharmacy', '{N} Drug & Wellness', '{C} Apothecary'],
  bank: ['{C} Savings Bank', '{N} Federal Credit Union', '{L} & {L2} Bank', '{N} Trust'],
  fund: ['{L} Capital Partners', '{N} Asset Management', '{N} Growth Fund'],
  school: ['{C} Academy', '{N} College', '{L} Preparatory School', '{C} Unified School District'],
  store: ['{N} Market', '{L} & Sons Outfitters', '{C} General Store', '{N} Goods Co.'],
  carrier: ['{N} Logistics', '{L} Freight', '{C} Express', '{N} Transport'],
  agency: ['{N} Agency', '{L} Partners', '{N} Creative'],
  manufacturer: ['{L} Industries', '{N} Manufacturing', '{N} Works'],
};
const BY_INDUSTRY: Record<Industry, string[]> = {
  healthcare: ['{N} Health', '{L} Medical', '{N} Life Sciences', '{N} Health Technologies', '{N} Care Group'],
  insurance: BY_ENTITY.payer,
  finance: ['{L} Capital Partners', '{N} Financial', '{C} Savings Bank', '{N} Asset Management'],
  retail: BY_ENTITY.store,
  technology: ['{N} Labs', '{L} Software', '{N} Systems', '{N} Analytics', '{N} Cloud'],
  logistics: BY_ENTITY.carrier,
  education: BY_ENTITY.school,
  manufacturing: BY_ENTITY.manufacturer,
  general: ['{N} Holdings', '{L} Group', '{N} Partners', '{L} & {L2}', '{N} Enterprises'],
};

// Well-known real organisations, never to be produced by chance (whole-word match on the generated name).
const BRANDS = ['cerner', 'oracle', 'epic', 'meditech', 'allscripts', 'kaiser', 'mayo', 'cleveland clinic', 'johns hopkins', 'hca', 'unitedhealth', 'optum',
  'anthem', 'elevance', 'aetna', 'cigna', 'humana', 'centene', 'blue cross', 'blue shield', 'cvs', 'walgreens', 'rite aid', 'walmart', 'amazon', 'costco',
  'target', 'google', 'alphabet', 'microsoft', 'apple', 'meta', 'jpmorgan', 'chase', 'goldman', 'morgan stanley', 'wells fargo', 'bank of america', 'citi',
  'blackrock', 'vanguard', 'fidelity', 'fedex', 'ups', 'dhl', 'maersk', 'harvard', 'stanford', 'oxford', 'cambridge', 'pfizer', 'johnson & johnson', 'novartis',
  'roche', 'merck', 'siemens', 'general electric', 'ibm', 'salesforce', 'sap', 'summit health', 'mount sinai', 'sutter', 'providence', 'ascension', 'tenet'];
/** True when a generated name contains a well-known real organisation's name. */
export function looksReal(name: string): boolean {
  const n = ' ' + name.toLowerCase().replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  return BRANDS.some((b) => n.includes(' ' + b + ' '));
}

/** The random choices a name needs; the injector backs them with a seeded Faker. */
export interface Picker { pick<T>(list: readonly T[]): T; city(): string; last(): string }

/** A synthetic organisation name for this kind of entity in this industry. */
export function orgName(p: Picker, entity: Entity, industry: Industry, fallback?: () => string): string {
  const templates = entity !== 'company' ? BY_ENTITY[entity] : BY_INDUSTRY[industry];
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = industry === 'general' && entity === 'company' && fallback && attempt % 2 === 1 ? null : p.pick(templates);
    const name = t === null ? fallback!() : t.replace('{N}', p.pick(NATURE)).replace('{S}', p.pick(SAINTS)).replace('{C}', p.city()).replace('{L2}', p.last()).replace('{L}', p.last());
    if (!looksReal(name)) return name;
  }
  return `${p.pick(NATURE)} Holdings`;
}
