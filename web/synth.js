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
    // text the page reader missed but the second look read (web/app.js, secondLook): replaced by what it read
    if (m.read) return fakeDate(m.read, 1) ? 'date' : kindOf({ text: m.read, type: '' });
    if (!m.text || m.text === '(table column)') return 'unread';
    if (fakeDate(m.text, 1)) return 'date';
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
      id: 't' + (i + 1), mask: m, original: m.read || m.text || '', kind: kindOf(m),
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
  // Dates. Every date on a page moves back by the same made-up number of months (dateShift(seed)), in its own format:
  // "Nov 2025" → "Jul 2025", "2026-05-01" → "2026-01-01", "10/30/2026" → "06/30/2026", "Oct 1, 2026" → "Jun 1, 2026".
  // One shift for the whole page keeps an axis of dates in order with its spacing, and a range ("Oct 1 – Oct 31") a
  // range; the day of the month stays (shortened if the new month is shorter), so every date is a real one.
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthOf = s => {
    const l = String(s).toLowerCase().replace(/\.$/, '');
    return l.length >= 3 && /^[a-z]+$/.test(l) ? MONTHS.findIndex(m => m.startsWith(l)) : -1;
  };
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // a month written as the original wrote its own: full or short, upper, capitalised or lower case, with its dot
  function monthName(i, like) {
    const dot = /\.$/.test(like) ? '.' : '', bare = like.replace(/\.$/, ''), full = MONTHS[i];
    let n = bare.length > 4 && MONTHS.includes(bare.toLowerCase()) ? full : full.slice(0, 3);
    if (bare.length === 4 && /^sept$/i.test(bare) && i === 8) n = 'sept';
    if (bare === bare.toUpperCase()) n = n.toUpperCase();
    else if (/^[A-Z]/.test(bare)) n = n[0].toUpperCase() + n.slice(1);
    return n + dot;
  }
  const dateShift = seed => 1 + (((seed >>> 0) % 997) % 5);   // 1 to 5 months back
  const DATES = {
    iso: /^((?:19|20)\d{2})([-/.])(\d{1,2})(?:\2(\d{1,2}))?$/,                                  // 2026-05-01, 2026-05
    num: /^(\d{1,2})([-/.])(\d{1,2})\2((?:19|20)?\d{2})$/,                                     // 30/10/2026, 10-30-26
    monYear: /^(\d{1,2})([-/.])((?:19|20)\d{2})$/,                                              // 11/2025, 11-2025
    monYY: /^(0[1-9]|1[0-2])([-/])(\d{2})$/,                                                    // 11-25 (not 10.25, a number)
    nameYear: /^([A-Za-z]{3,9}\.?)([\s\-/]*['’]?)((?:19|20)\d{2}|\d{2})$/,                      // Nov 2025, Nov-25, Nov '25
    nameDay: /^([A-Za-z]{3,9}\.?)(\s*)(\d{1,2})(st|nd|rd|th)?(?:(,?\s*)((?:19|20)\d{2}))?$/,     // Oct 1, 2026 · Oct 1
    dayName: /^(\d{1,2})(st|nd|rd|th)?([\s\-/.]+)([A-Za-z]{3,9}\.?)(?:([\s\-/.,]+)((?:19|20)\d{2}|\d{2}))?$/,   // 30-Sep-2026 · 1 Oct
  };
  // day-month or month-day for dates written in numbers only: a first number over 12 is a day, a second over 12 makes
  // the first the month. texts: every date on the page, which share one order.
  function dateOrder(texts) {
    let dmy = 0, mdy = 0;
    (texts || []).forEach(t => { const m = DATES.num.exec(String(t).trim().replace(/[.,;:)]+$/, '')); if (m) { if (+m[1] > 12) dmy++; if (+m[3] > 12) mdy++; } });
    return dmy > mdy ? 'dmy' : 'mdy';
  }
  // The same date moved back by the page's shift, in the same format; null when the text is not a date.
  function fakeDate(text, seed, order) {
    const raw = String(text).trim(), pre = /^[([]*/.exec(raw)[0], post = /[.,;:)\]]*$/.exec(raw.slice(pre.length))[0];
    // (the reader often reads the O of Oct as a zero)
    const t = raw.slice(pre.length, raw.length - post.length).replace(/\b0(ct|ctober)\b/gi, 'O$1'), pad = (n, w) => String(n).padStart(w, '0');
    const back = typeof seed === 'function' ? 1 + Math.floor(seed() * 5) : dateShift(seed);
    // year, month (0-11) and day moved back; the day stays unless the new month is shorter
    const move = (y, mo, d) => {
      const k = y * 12 + mo - back, ny = Math.floor(k / 12), nm = k - ny * 12;
      return [ny, nm, d == null ? null : Math.min(d, daysIn(ny, nm))];
    };
    const yy = (s, y) => (s.length === 2 ? pad(y % 100, 2) : String(y));
    const fullYear = s => (s.length === 2 ? 2000 + +s : +s);
    const ok = (mo, d) => mo >= 0 && mo < 12 && (d == null || (d >= 1 && d <= 31));
    let m, out = null;
    if ((m = DATES.iso.exec(t)) && ok(+m[3] - 1, m[4] ? +m[4] : null)) {
      const [y, mo, d] = move(+m[1], +m[3] - 1, m[4] ? +m[4] : null);
      out = y + m[2] + pad(mo + 1, m[3].length) + (d == null ? '' : m[2] + pad(d, m[4].length));
    } else if ((m = DATES.num.exec(t))) {
      // the page's order, unless this date can only be read the other way
      const dm = +m[1] > 12 || (order === 'dmy' && +m[3] <= 12), [ds, ms] = dm ? [m[1], m[3]] : [m[3], m[1]];
      if (!ok(+ms - 1, +ds)) return null;
      // zero-padded only when the original was ("05/10/2026"; "10/25/2026" is written "5/25/2026" in the same style)
      const zero = /^0/.test(m[1]) || /^0/.test(m[3]), [y, mo, d] = move(fullYear(m[4]), +ms - 1, +ds);
      const D = zero ? pad(d, 2) : String(d), M = zero ? pad(mo + 1, 2) : String(mo + 1);
      out = (dm ? D + m[2] + M : M + m[2] + D) + m[2] + yy(m[4], y);
    } else if ((m = DATES.monYear.exec(t) || DATES.monYY.exec(t)) && ok(+m[1] - 1)) {
      const [y, mo] = move(fullYear(m[3]), +m[1] - 1);
      out = (/^0/.test(m[1]) || m[0] === DATES.monYY.exec(t)?.[0] ? pad(mo + 1, 2) : String(mo + 1)) + m[2] + yy(m[3], y);
    } else if ((m = DATES.nameYear.exec(t)) && monthOf(m[1]) >= 0) {
      const [y, mo] = move(fullYear(m[3]), monthOf(m[1]));
      out = monthName(mo, m[1]) + m[2] + yy(m[3], y);
    } else if ((m = DATES.nameDay.exec(t)) && monthOf(m[1]) >= 0 && ok(0, +m[3])) {
      // without a year ("Oct 1"), only the day moves: the month is usually written plainly elsewhere on the page
      const [y, mo, d] = m[6] ? move(+m[6], monthOf(m[1]), +m[3]) : [0, monthOf(m[1]), dayOn(+m[3], seed)];
      out = monthName(mo, m[1]) + (m[2] || ' ') + pad(d, m[3].length) + (m[4] || '') + (m[6] ? m[5] + y : '');   // ("Oct7," was read without its space)
    } else if ((m = DATES.dayName.exec(t)) && monthOf(m[4]) >= 0 && ok(0, +m[1])) {
      const [y, mo, d] = m[6] ? move(fullYear(m[6]), monthOf(m[4]), +m[1]) : [0, monthOf(m[4]), dayOn(+m[1], seed)];
      out = pad(d, m[1].length) + (m[2] || '') + m[3] + monthName(mo, m[4]) + (m[6] ? m[5] + yy(m[6], y) : '');
    }
    return out == null ? null : pre + out + post;
  }
  // A day of the month beside a month name that stays readable ("Oct" · "31,"): another valid day, a few days on,
  // so a range keeps its order ("Oct 1 – Oct 31" → "Oct 4 – Oct 28").
  function dayOn(d, seed) { const j = 2 + (((typeof seed === 'function' ? 1 : seed) >>> 0) % 4); return d + j <= 28 ? d + j : Math.max(1, d - j); }
  function fakeDay(text, seed) {
    const m = /^(\D*)(\d{1,2})(\D*)$/.exec(String(text).trim());
    if (!m || +m[2] < 1 || +m[2] > 31) return null;
    return m[1] + String(dayOn(+m[2], seed)).padStart(m[2].length, '0') + m[3];
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
  const HONORIFICS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof'], SUFFIXES = ['Jr', 'Sr', 'II', 'III', 'IV', 'MD', 'PhD', 'DDS', 'DVM'];
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
    const out = new Map(), order = dateOrder(toks.map(t => t.original));
    // a number just after a month name that stays readable on the same line is a day of that month
    // (or just before it: "13" · "Oct 2026")
    const afterMonth = t => {
      const m = t.mask, cy = m.y + m.h / 2;
      return (t.visible || []).some(w => monthOf(w.text.replace(/[.,]$/, '')) >= 0 && Math.abs(w.y + w.h / 2 - cy) < Math.max(m.h, w.h) * 0.6
        && ((w.x + w.w <= m.x + 2 && m.x - (w.x + w.w) < Math.max(m.h, w.h) * 1.2) || (w.x >= m.x + m.w - 2 && w.x - (m.x + m.w) < Math.max(m.h, w.h) * 1.2)));
    };
    // letters inside a number or a code ("bf_koelpin_50", "/customers/koelpin/case-study") would show the name the mask
    // hid: each run of three letters or more that is not a safe word becomes a plain word, the same one wherever the
    // same run appears on the page
    const safe = helpers && helpers.safeWord ? helpers.safeWord : () => false;
    const letters = text => String(text).replace(/\p{L}{3,}/gu, run => {
      if (safe(run)) return run;
      const w = poolWord(run.length, seeded(hash(run.toLowerCase()) ^ seed), run.toLowerCase());
      return run === run.toUpperCase() ? w.toUpperCase() : /^\p{Lu}/u.test(run) ? w[0].toUpperCase() + w.slice(1) : w;
    });
    const make = (t, key, r) => {
      const label = t.kind === 'number' || t.kind === 'unread' || t.kind === 'email' ? '' : labelFor(t.mask, t.visible || []);
      const role = roleOf(label);
      let s = '';
      if (t.kind === 'unread') return '';
      if (t.kind !== 'email' && (s = fakeDate(t.original, seed, order))) return s;           // a date, moved by the page's shift
      if (t.kind === 'number' && afterMonth(t) && (s = fakeDay(t.original, seed))) return s;  // a day beside its month
      // (a weak reading, see app.js, is written only on an axis; a tick misread with a stray letter, "4s" for "45",
      // takes its scale's value alone)
      if (t.kind === 'number' && t.mask.weak && axes.get(t.mask) == null) return '';
      if (t.kind === 'number' && axes.get(t.mask) != null && /^\d+[A-Za-z]$/.test(t.original.trim()) && !/[kKmMbB]$/.test(t.original.trim())) return String(axes.get(t.mask));
      if (t.kind === 'number') return letters(helpers && helpers.fakeValue ? helpers.fakeValue(t.original, hash(t.original + '|' + t.bbox[0] + '|' + t.bbox[1]) ^ seed, axes.get(t.mask)) : t.original.replace(/\d/g, () => String(Math.floor(r() * 10))));
      if (t.kind === 'email') return email(t.original, r);
      // a title or a suffix of a name stays a title or a suffix ("Ms." → "Dr.", "Jr." → "Sr.")
      const bare = t.original.trim().replace(/\.$/, ''), dot = /\.$/.test(t.original.trim()) ? '.' : '';
      for (const set of [HONORIFICS, SUFFIXES]) if (set.some(h => h.toLowerCase() === bare.toLowerCase())) {
        const other = set.filter(h => h.toLowerCase() !== bare.toLowerCase() && Math.abs(h.length - bare.length) <= 1);
        return other[Math.floor(r() * other.length)] + dot;
      }
      // an ID keeps the prefix its whole column shares ("INV-", "EMP-": a kind of record, not whose) and its length
      const idm = /^([A-Z]{2,5})([-_ ]?)(\d{3,})$/.exec(t.original.trim());
      if (t.kind === 'id' && idm && (prefixes.get(idm[1]) || 0) >= 3) {
        let d; do d = String(1 + Math.floor(r() * 9)) + Array.from({ length: idm[3].length - 1 }, () => Math.floor(r() * 10)).join(''); while (d === idm[3]);
        return idm[1] + idm[2] + d;
      }
      if (faker && t.kind === 'id') return faker.id(label || t.context || 'ID', key);
      if (faker) {
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
      return s || word(t.original, r);
    };
    // A made-up value that repeats a word standing right beside it ("West" · "West Mckenzie", or two halves of one
    // client name each becoming "Beer Group") reads as a mistake: such a value is drawn again.
    const prefixes = new Map();
    toks.forEach(t => { const m = /^([A-Z]{2,5})[-_ ]?\d{3,}$/.exec(t.original.trim()); if (t.kind === 'id' && m) prefixes.set(m[1], (prefixes.get(m[1]) || 0) + 1); });
    const made = [];
    const besideWords = t => {
      const m = t.mask, cy = m.y + m.h / 2, reach = Math.max(m.h, 8) * 1.5;
      const near = b => Math.abs(b.y + b.h / 2 - cy) < Math.max(m.h, b.h) * 0.6 && (Math.abs(m.x - (b.x + b.w)) < reach || Math.abs(b.x - (m.x + m.w)) < reach);
      return (t.visible || []).filter(near).map(w => w.text).concat(made.filter(d => near(d.mask)).map(d => d.s))
        .join(' ').toLowerCase().split(/[^\p{L}]+/u).filter(w => w.length >= 3);
    };
    toks.forEach(t => {
      const r = seeded(hash(t.id + '|' + t.original) ^ seed);
      let s = make(t, t.id + '|' + t.original, r);
      if (s && t.kind !== 'number' && t.kind !== 'date') {
        const near = new Set(besideWords(t)), clash = v => String(v).toLowerCase().split(/[^\p{L}]+/u).some(w => w.length >= 3 && near.has(w));
        for (let i = 1; i <= 8 && clash(s); i++) s = make(t, t.id + '|' + t.original + '~' + i, seeded(hash(t.id + '~' + i) ^ seed)) || s;
      }
      made.push({ mask: t.mask, s });
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
        bbox: t.bbox, x: t.mask.x, y: t.mask.y, w: t.mask.w, h: t.mask.h, slant: t.mask.slant || null, fromRegion: !!t.mask.read
      };
    });
  }

  const api = { kindOf, contextFor, tokens, local, combine, word, labelFor, roleOf, fakeDate, fakeDay, dateOrder, dateShift, monthOf, POOL };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSSynth = api;
})(typeof window !== 'undefined' ? window : globalThis);
