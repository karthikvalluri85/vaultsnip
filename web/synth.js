/* VaultSnip: context synthesizer.
   Decides what synthetic text goes back into each masked box of the in-place replica (web/inpaint.js).
   The AI provider, when the user sends to one, is a contextual data generator only: it gets each box's kind, position,
   the visible, unmasked labels near it and either a number's pattern ("$99.9M") or, for other text, only its length;
   never the hidden text. It returns a replacement per box. The hidden text stays on the device; the replacement map pairs it with the answer here.
   Without a provider, or for any answer that fails the checks, values are made on the device.
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
  // Digits become 9, letters A or a; everything else (currency, %, separators) stays.
  const shapeOf = s => String(s || '').replace(/\d/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[^\x00-\x7F]/g, c => (/\p{L}/u.test(c) ? (c === c.toUpperCase() ? 'A' : 'a') : c));
  // A number's pattern for the provider: digits become 9; a short unit right after the digits (K, M, bn, %, min, h)
  // stays, so the answer can keep it; any other letter becomes A or a.
  const numberShape = s => {
    const unit = /(\d\s?)([A-Za-z]{1,4})(\W*)$/.exec(String(s || ''));
    const head = unit ? String(s).slice(0, unit.index + unit[1].length) : String(s || '');
    return shapeOf(head) + (unit ? unit[2] + shapeOf(unit[3]) : '');
  };
  // The skeleton a number must keep: digit runs (with their separators) collapsed to one #.
  const skeleton = s => String(s || '').trim().replace(/\d[\d,]*(?:\.\d+)?/g, '#').replace(/\s+/g, ' ');

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
      shape: m.text && m.text !== '(table column)' ? (kindOf(m) === 'number' ? numberShape(m.text) : shapeOf(m.text)) : '',
      bbox: [Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h)],
      context: contextFor(m, visible)
    }));
  }
  // What may leave the device, per box: its id, kind, position, the visible words beside it, and either a number's
  // pattern ("$99.9M") or, for a name or any other text, only how many characters fit. Never the hidden text, and
  // nothing for a box whose text was not read.
  function request(toks, size) {
    return {
      image: { width: size.width, height: size.height },
      tokens: toks.filter(t => t.kind !== 'unread').map(t => Object.assign({ id: t.id, kind: t.kind },
        t.kind === 'number' ? { shape: t.shape } : { chars: t.original.length }, { bbox: t.bbox, context: t.context }))
    };
  }

  const SYSTEM = `You are a contextual data generator for VaultSnip. A dashboard screenshot has had its sensitive text hidden; you write the synthetic text that will be drawn back into each hidden box, in place, so the dashboard reads as a believable, internally consistent example.
You are not a frontend developer: never describe layout, charts or code.
Input: JSON {"image":{"width","height"},"tokens":[{"id","kind","shape","bbox":[x,y,w,h],"context"}]}.
- kind: number (a value, amount, percentage, count, date or time), client (the customer's own name), person, email, id (an identifier or code), text (any other word or label).
- shape (numbers only): the hidden value's characters with every digit as 9; currency signs, %, separators, spaces and a short unit suffix (K, M, B, min, h) are as in the original; any other letter is A or a.
- chars (everything else): how many characters the hidden text had, so the replacement fits the box.
You are never given the hidden text.
- context: visible labels next to or above the box (for example a KPI title or a column header).
An image of the masked dashboard may be attached: hidden boxes show as covered areas. Use it only to understand what each box is.
Rules:
- Output JSON only: {"replacements":[{"id":string,"synthetic":string,"note":string}]}, one entry per input token, same ids.
- Numbers match the shape: same currency sign, unit suffix, decimal places and separators, and the same number of digits before the decimal point. Other text has about "chars" characters, so it fits the box.
- Keep the numbers mathematically coherent: a total equals the sum of its parts; a margin or rate equals its numerator over its denominator; percentages of one whole add to 100 or less; values that share a column or an axis stay in a sensible order and scale; a change (+/-) agrees with the values it compares; dates stay valid.
- Names, companies and emails are fictitious: emails only at example.com, example.org or example.net. Never use a real company's or person's name.
- For text, choose a plausible label for its context with about the same length and capitalisation.
- note: at most 12 words saying what the value represents and any invariant it satisfies (e.g. "Q3 revenue; = sum of regions").`;

  function parse(text) {
    try {
      const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const list = Array.isArray(o) ? o : o && Array.isArray(o.replacements) ? o.replacements : null;
      if (!list) return null;
      const map = new Map();
      list.forEach(r => { if (r && typeof r.id === 'string' && typeof r.synthetic === 'string') map.set(r.id, { synthetic: r.synthetic.trim(), note: typeof r.note === 'string' ? r.note.slice(0, 160) : '' }); });
      return map;
    } catch (e) { return null; }
  }

  // An answer is used only when it could not be the hidden text and fits the box's shape.
  function acceptable(t, s) {
    if (!s || s.length > Math.max(4, Math.round(t.original.length * 1.6) + 2)) return false;
    const low = s.toLowerCase(), orig = t.original.toLowerCase().trim();
    if (orig && (low === orig || (orig.length > 3 && low.includes(orig)))) return false;
    if (t.kind === 'number') {
      if (skeleton(s) !== skeleton(t.original)) return false;
      const v = parseFloat((s.match(/\d[\d,]*(?:\.\d+)?/) || ['0'])[0].replace(/,/g, ''));
      if (/%/.test(s) && v > 100 && !(parseFloat(t.original.replace(/,/g, '').replace(/[^\d.]/g, '')) > 100)) return false;
    }
    if (t.kind === 'email' && !/@example\.(com|org|net)$/i.test(s)) return false;
    return true;
  }

  /* ---------- on-device values ---------- */
  const SYL = ['ka', 'ver', 'lo', 'mi', 'ra', 'den', 'sol', 'tra', 'ne', 'qu', 'vel', 'ori', 'tan', 'bel', 'cor', 'wyn', 'ash', 'mar', 'ton', 'lis'];
  function word(text, r) {
    // a made-up word of the same length and capitalisation for each word of the original ("Acme Corp" → "Veltor Kami")
    return String(text).split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part) || !/[A-Za-z]/.test(part)) return part;
      const n = part.replace(/[^A-Za-z]/g, '').length;
      let w = '';
      while (w.length < n) w += SYL[Math.floor(r() * SYL.length)];
      w = w.slice(0, Math.max(2, n));
      if (part === part.toUpperCase() && n > 1) w = w.toUpperCase();
      else if (/^[A-Z]/.test(part)) w = w[0].toUpperCase() + w.slice(1);
      return part.replace(/[A-Za-z]+(?:[A-Za-z'’-]*[A-Za-z])?/, w);
    }).join('');
  }
  // an address of about the same length as the hidden one (which the reader may have cut short), at a reserved domain
  function email(text, r) {
    const domain = ['example.com', 'example.org', 'example.net'][Math.floor(r() * 3)];
    const n = Math.max(3, String(text).length - domain.length - 1);
    let local = '';
    while (local.length < n) local += SYL[Math.floor(r() * SYL.length)];
    return local.slice(0, n) + '@' + domain;
  }
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // helpers: { fakeValue(text, seed, exact), axisFactors(masks) } from the app, so numbers here match the masked image
  function local(toks, helpers, seed) {
    seed = seed >>> 0;
    const faker = global.VSFaker && global.VSFaker.create ? global.VSFaker.create({ seed }) : null;
    const nums = toks.filter(t => t.kind === 'number').map(t => t.mask);
    const axes = helpers && helpers.axisFactors ? helpers.axisFactors(nums) : new Map();
    const out = new Map();
    toks.forEach(t => {
      const key = t.id + '|' + t.original, r = seeded(hash(key) ^ seed);
      let s = '';
      if (t.kind === 'unread') s = '';
      else if (t.kind === 'number') s = helpers && helpers.fakeValue ? helpers.fakeValue(t.original, hash(t.original + '|' + t.bbox[0] + '|' + t.bbox[1]) ^ seed, axes.get(t.mask)) : t.original.replace(/\d/g, () => String(Math.floor(r() * 10)));
      else if (faker && t.kind === 'person') s = faker.person(key);
      else if (faker && t.kind === 'client') s = faker.company(key);
      else if (t.kind === 'email') s = email(t.original, r);
      else if (faker && t.kind === 'id') s = faker.id(t.context || 'ID', key);
      else s = word(t.original, r);
      // a made-up name far longer than the text it replaces would not fit its box: a word of the same length instead
      if (t.kind !== 'number' && t.kind !== 'email' && s.length > t.original.length * 1.4 + 2) s = word(t.original, r);
      out.set(t.id, { synthetic: s, note: '', axis: axes.has(t.mask) });
    });
    return out;
  }

  // The replacement map: [{original, synthetic, bbox, kind, context, note, source}]. Axis ticks always use the
  // on-device even scale, so an axis can never come out of order whatever the answer was.
  function combine(toks, answer, fallback) {
    return toks.map(t => {
      const a = answer && answer.get(t.id), f = fallback.get(t.id);
      const ai = a && !(f && f.axis) && t.kind !== 'unread' && acceptable(t, a.synthetic);
      const use = ai ? a : f || { synthetic: '', note: '' };
      return {
        id: t.id, original: t.original, synthetic: use.synthetic, note: use.note || '', kind: t.kind, context: t.context,
        bbox: t.bbox, x: t.mask.x, y: t.mask.y, w: t.mask.w, h: t.mask.h, source: ai ? 'ai' : 'device'
      };
    });
  }

  const api = { SYSTEM, kindOf, shapeOf, skeleton, contextFor, tokens, request, parse, acceptable, local, combine, word };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSSynth = api;
})(typeof window !== 'undefined' ? window : globalThis);
