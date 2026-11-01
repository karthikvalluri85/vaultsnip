/* VaultSnip: synthetic text for the in-place replica (web/inpaint.js).
   Decides what goes back into each masked box, on this device: numbers of the same size (axis ticks on an even new
   scale), made-up people, companies and IDs, emails at reserved example domains, and made-up words of the same length and
   capitalisation for anything else. The hidden text never leaves the device; nothing is sent anywhere.
   Works in a page (window.VSSynth) and in Node for the unit tests (module.exports). */
(function (global) {
  'use strict';

  const KIND = {
    'Number or money': 'number', 'Client name': 'client', 'Email': 'email', 'Identifier': 'id',
    'Name in comment': 'person', 'Name in context': 'person', 'Text not on allowlist': 'text',
    'Added after check': 'text', 'Added by you': 'text', 'Unread text': 'unread'
  };
  const hasDigit = s => /\d/.test(s || '');
  function kindOf(m) {
    if (!m.text || m.text === '(table column)') return 'unread';
    if (m.type === 'Number or money' || (hasDigit(m.text) && /^[^A-Za-z]*\d[\d,.\s]*[^A-Za-z]{0,3}[A-Za-z%°]{0,4}$/.test(m.text.trim()))) return 'number';
    return KIND[m.type] || 'text';
  }

  // Visible words near a box: same line to the left or right, then the line(s) above. Words under any active mask are not
  // visible, so they are never used.
  function contextFor(m, visible) {
    const cy = m.y + m.h / 2, near = [];
    visible.forEach(w => {
      const wy = w.y + w.h / 2, dx = w.x + w.w < m.x ? m.x - (w.x + w.w) : w.x > m.x + m.w ? w.x - (m.x + m.w) : 0;
      const sameLine = Math.abs(wy - cy) < Math.max(m.h, w.h) * 0.6;
      const above = wy < cy && cy - wy < Math.max(m.h, w.h) * 3.5 && w.x < m.x + m.w + m.h * 4 && w.x + w.w > m.x - m.h * 4;
      if (sameLine && dx < m.h * 8) near.push([dx, w]);
      else if (above) near.push([m.h * 2 + (cy - wy) + dx * 0.5, w]);
    });
    near.sort((a, b) => a[0] - b[0]);
    const pick = near.slice(0, 6).map(n => n[1]).sort((a, b) => (Math.round(a.y / 8) - Math.round(b.y / 8)) || a.x - b.x);
    return pick.map(w => w.text).join(' ').slice(0, 120);
  }

  // masks: the active masks; words: every OCR word. Returns the tokens kept on the device (with the hidden text) and the
  // request that may be sent (without it).
  function tokens(masks, words) {
    const covered = w => masks.some(m => w.x + w.w / 2 > m.x && w.x + w.w / 2 < m.x + m.w && w.y + w.h / 2 > m.y && w.y + w.h / 2 < m.y + m.h);
    const visible = (words || []).filter(w => w.text && !covered(w));
    return masks.map((m, i) => ({
      id: 't' + (i + 1), mask: m, original: m.text || '', kind: kindOf(m),
      bbox: [Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h)],
      context: contextFor(m, visible), visible
    }));
  }
  /* ---------- on-device values ---------- */
  // Real, neutral English words by length, for hidden text that is neither a name nor a number. A made-up word built
  // from syllables ("Wynr", "Belnekalob") gives a replica away at a glance; a plain word of the same length does not.
  // None is a brand, a person or a place.
  const POOL = (`
ox ivy elm oak ash bay fig sun sky sea dew
amber birch cedar coral delta ember flint grove haven ivory jasper lumen maple noble ocean pearl quartz raven slate terra umber
vista willow aspen basil cliff drift fable glade harbor indigo juniper kestrel lagoon meadow nectar orchid prairie quill ridge
summit timber upland valley walnut yarrow zephyr bramble canyon dune estuary fern garnet heather inlet jade kelp linden marsh
north south east west alpha bravo crest field stone brook river cove pine moss frost light bright clear swift steady even
signal anchor beacon compass harvest lantern meridian horizon keystone mosaic pinnacle quarry rapids sterling tundra uplift
vertex wayfare atlas cobalt dawn falcon granite hollow island jetty kindle lattice marble nimbus opal pillar rover sable
tidal velvet wharf yonder zenith arbor blossom cascade daybreak evergreen foothill gateway highland ironwood junction
lakeside moonlight northwind orchard parkway riverside seaside sunrise thistle waterfall woodland
plain open fair calm warm cool fresh solid level prime core main front point range scope frame
standard balanced regional seasonal general premium classic central coastal national western eastern northern southern
`).split(/\s+/).filter(Boolean);
  const byLength = list => { const by = {}; list.forEach(w => { (by[w.length] = by[w.length] || []).push(w); }); return by; };
  const BYLEN = byLength(POOL);
  // a pool word of n letters (or the nearest length there is); long runs are joined from two words
  function poolWord(n, r, not, by = BYLEN) {
    for (const d of [0, 1, -1, 2, -2]) {
      const list = (by[n + d] || []).filter(w => w !== not);
      if (list.length) return list[Math.floor(r() * list.length)];
    }
    if (n > 13) { const a = Math.ceil(n / 2); return poolWord(a, r, not, by) + poolWord(n - a, r, not, by); }
    return (BYLEN[2] || ['ox'])[0];
  }
  function word(text, r) {
    // a real word of the same length and capitalisation for each word of the original ("Acme Corp" → "Cove Tide")
    const by = BYLEN;
    return String(text).split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part) || !/\p{L}/u.test(part)) return part;
      const letters = part.replace(/[^\p{L}]/gu, ''), n = letters.length;
      let w = poolWord(Math.max(2, n), r, letters.toLowerCase(), by);
      if (part === part.toUpperCase() && n > 1) w = w.toUpperCase();
      else if (/^\p{Lu}/u.test(part)) w = w[0].toUpperCase() + w.slice(1);
      return part.replace(/\p{L}+(?:[\p{L}'’-]*\p{L})?/u, w);
    }).join('');
  }
  // A date keeps its format with a made-up date near it ("30-Sep-2026" → "14-Aug-2026", "2026-09-30" → "2026-08-14").
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DATE = [
    /^(\d{1,2})([-\s/.])([A-Za-z]{3,9})\2((?:19|20)\d{2})([.,]?)$/,            // 30-Sep-2026, 30 Sep 2026
    /^([A-Za-z]{3,9})\s(\d{1,2}),?\s((?:19|20)\d{2})([.,]?)$/,                  // Sep 30, 2026
    /^((?:19|20)\d{2})([-/.])(\d{1,2})\2(\d{1,2})([.,]?)$/,                     // 2026-09-30
    /^(\d{1,2})([-/.])(\d{1,2})\2((?:19|20)?\d{2})([.,]?)$/,                   // 30/09/2026
  ];
  function fakeDate(text, r) {
    const t = String(text).trim(), pad = (n, w) => String(n).padStart(w, '0');
    const day = () => 1 + Math.floor(r() * 28), mon = k => (k + 1 + Math.floor(r() * 10)) % 12;
    let m;
    if ((m = DATE[0].exec(t))) {
      const i = MON.findIndex(x => m[3].toLowerCase().startsWith(x.toLowerCase())); if (i < 0) return null;
      const name = MON[mon(i)], upper = m[3] === m[3].toUpperCase();
      return pad(day(), m[1].length) + m[2] + (upper ? name.toUpperCase() : name) + m[2] + m[4] + m[5];
    }
    if ((m = DATE[1].exec(t))) {
      const i = MON.findIndex(x => m[1].toLowerCase().startsWith(x.toLowerCase())); if (i < 0) return null;
      return MON[mon(i)] + ' ' + day() + (t.includes(',') ? ', ' : ' ') + m[3] + m[4];
    }
    if ((m = DATE[2].exec(t))) return m[1] + m[2] + pad(1 + Math.floor(r() * 12), m[3].length) + m[2] + pad(day(), m[4].length) + m[5];
    if ((m = DATE[3].exec(t))) return pad(day(), m[1].length) + m[2] + pad(1 + Math.floor(r() * 12), m[3].length) + m[2] + m[4] + m[5];
    return null;
  }
  // Where a hidden box sits decides what replaces it: the label just before it on the same line ("Prepared by", "Owner:"),
  // or the header of its table column (the nearest line above, over the same columns, that names a kind of value).
  const PERSON_CUE = /\b(manager|owner|rep|agent|assignee|contact|employee|author|reviewer|analyst|engineer|seller|buyer|approver|recruiter|lead|prepared by|owned by|created by|assigned to|advisor|consultant|director|physician|doctor|nurse|user name|full name)\b/i;
  const PLACE_DIM = /^(regions?|territor(y|ies)|areas?|zones?|locations?|markets?|sites?|cit(y|ies)|towns?)$/;
  function roleOf(label) {
    const l = String(label || '').toLowerCase().trim();
    if (!l) return null;
    // a chart titled "Leads by Region" labels its bars with regions: the words after "by" name the dimension
    const by = /\b(prepared|owned|created|assigned|submitted|approved|reported|managed) by\b/.test(l) ? null : l.match(/\bby\s+([a-z][a-z ]*)$/);
    if (by) {
      const dim = by[1].trim();
      if (PLACE_DIM.test(dim.split(' ').pop())) return 'city';
      return roleOf(dim);
    }
    if (PERSON_CUE.test(l)) return 'person';
    const f = global.VSFaker;
    return f && f.columnRole ? f.columnRole(l, 'text') : null;
  }
  function labelFor(m, visible) {
    const cy = m.y + m.h / 2;
    // same line, just to the left (within a few letter widths)
    const left = visible.filter(w => Math.abs(w.y + w.h / 2 - cy) < Math.max(m.h, w.h) * 0.6 && w.x + w.w <= m.x + 2 && m.x - (w.x + w.w) < m.h * 6)
      .sort((a, b) => b.x - a.x).slice(0, 3).reverse().map(w => w.text).join(' ');
    if (roleOf(left)) return left;
    // the column header: lines above that overlap the box's columns, nearest first
    const above = visible.filter(w => w.y + w.h <= m.y + 2 && m.y - w.y < m.h * 24 && w.x < m.x + m.w + m.h && w.x + w.w > m.x - m.h);
    const lines = new Map();
    above.forEach(w => { const k = Math.round((w.y + w.h / 2) / Math.max(4, m.h * 0.6)); (lines.get(k) || lines.set(k, []).get(k)).push(w); });
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, ws]) => ws.sort((a, b) => a.x - b.x).map(w => w.text).join(' '));
    return ordered.find(t => roleOf(t)) || left || '';
  }
  const titleWords = s => String(s).trim().split(/\s+/).filter(w => /^[A-Z][A-Za-z'’.-]*$/.test(w));
  // Several draws, keeping the one closest to the original's length, so a made-up name fits its box without squeezing.
  function fitted(make, original, key) {
    const L = original.length, max = L * 1.15 + 1;
    // never reuse a word of the hidden text (a made-up name that shares the real surname is not made up)
    const own = new Set(original.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3));
    let best = null, bestD = Infinity;
    for (let i = 0; i < 16; i++) {
      const v = make(i ? key + '#' + i : key);
      if (!v || v.toLowerCase() === original.toLowerCase()) continue;
      if (v.toLowerCase().split(/[^a-z]+/).some(w => own.has(w))) continue;
      // longer than the original costs more than shorter: it would have to be squeezed into the box
      const d = v.length > L ? 2 * (v.length - L) : L - v.length;
      if (d < bestD) { best = v; bestD = d; }
      if (d <= Math.max(1, L * 0.1)) break;
    }
    // still too long: drop trailing words while it is longer than its box allows
    if (best && best.length > max) {
      const parts = best.split(' ');
      while (parts.length > 1 && parts.join(' ').length > max) parts.pop();
      best = parts.join(' ');
    }
    return best && best.length <= max ? best : null;
  }
  // an address of about the same length as the hidden one (which the reader may have cut short), at a reserved domain
  function email(text, r) {
    const domain = ['example.com', 'example.org', 'example.net'][Math.floor(r() * 3)];
    const n = Math.max(3, String(text).length - domain.length - 1);
    let local = poolWord(Math.min(n, 9), r);
    while (local.length < n) local += '.' + poolWord(Math.min(9, Math.max(2, n - local.length - 1)), r);
    return local.slice(0, n).replace(/\.$/, 'x') + '@' + domain;
  }
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // helpers: { fakeValue(text, seed, exact), axisFactors(masks) } from the app, so numbers here match the masked image
  function local(toks, helpers, seed) {
    seed = seed >>> 0;
    // the dashboard's own visible words set the style of made-up organisations (a hospital list gets hospital names)
    const seen = toks.length && toks[0].visible ? toks[0].visible.map(w => w.text) : [];
    const fopts = o => Object.assign({ seed, spec: seen }, o);
    let faker = global.VSFaker && global.VSFaker.create ? global.VSFaker.create(fopts()) : null;
    // revenue and margin appear on every sales page: bank and fund names only for pages that are about finance
    if (faker && faker.industry === 'finance' && !/\b(portfolio|aum|loans?|deposits?|funds?|trading|credit|interest|assets?|equity|yield|nav|bank|banking)\b/i.test(seen.join(' ')))
      faker = global.VSFaker.create(fopts({ industry: 'general' }));
    const nums = toks.filter(t => t.kind === 'number').map(t => t.mask);
    const axes = helpers && helpers.axisFactors ? helpers.axisFactors(nums) : new Map();
    const out = new Map();
    toks.forEach(t => {
      const key = t.id + '|' + t.original, r = seeded(hash(key) ^ seed);
      const label = t.kind === 'number' || t.kind === 'unread' || t.kind === 'email' ? '' : labelFor(t.mask, t.visible || []);
      const role = roleOf(label);
      let s = '';
      if (t.kind === 'unread') s = '';
      else if (t.kind === 'number') s = helpers && helpers.fakeValue ? helpers.fakeValue(t.original, hash(t.original + '|' + t.bbox[0] + '|' + t.bbox[1]) ^ seed, axes.get(t.mask)) : t.original.replace(/\d/g, () => String(Math.floor(r() * 10)));
      else if (t.kind === 'email') s = email(t.original, r);
      else if ((s = fakeDate(t.original, r))) { /* a date of the same format */ }
      else if (faker && t.kind === 'id') s = faker.id(label || t.context || 'ID', key);
      else if (faker) {
        // what the text is: its own kind first (a client, a person), then its label or column, then its shape
        const words = titleWords(t.original), n = t.original.trim().split(/\s+/).length;
        // a fragment the reader cut short ("ww)", "RN") keeps its own shape: a full name would not fit its box
        const want = t.original.replace(/[^A-Za-z]/g, '').length < 4 ? null
          // a place column or axis outranks the reader's guess that a town name is a person's
          : role && /^(city|country|state)$/.test(role) ? role
          : t.kind === 'client' ? 'company' : t.kind === 'person' ? 'person'
          : role && /^(person|company|city|country|state|product)$/.test(role) ? role
          : words.length >= 2 && words.length === n ? 'company'
          : words.length === 1 && n === 1 && t.original.length >= 4 ? 'city' : null;
        if (want) s = fitted(k => faker.value(want, k, { columnName: label }), t.original, key) || '';
        // a one-word name: a surname of about its length reads more naturally than a town where a town makes no sense
        if (!s && want === 'city') s = fitted(k => faker.person(k).split(' ').pop(), t.original, key) || '';
      }
      if (!s && t.kind !== 'unread' && t.kind !== 'number') s = word(t.original, r);
      out.set(t.id, { synthetic: s });
    });
    return out;
  }

  // The replacement map, kept on this device: [{original, synthetic, bbox, kind, context}].
  function combine(toks, values) {
    return toks.map(t => {
      const v = values.get(t.id) || { synthetic: '' };
      return {
        id: t.id, original: t.original, synthetic: v.synthetic, kind: t.kind, context: t.context,
        bbox: t.bbox, x: t.mask.x, y: t.mask.y, w: t.mask.w, h: t.mask.h
      };
    });
  }

  const api = { kindOf, contextFor, tokens, local, combine, word, labelFor, roleOf, fakeDate, POOL };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSSynth = api;
})(typeof window !== 'undefined' ? window : globalThis);
