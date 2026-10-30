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
      context: contextFor(m, visible)
    }));
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

  const api = { kindOf, contextFor, tokens, local, combine, word };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSSynth = api;
})(typeof window !== 'undefined' ? window : globalThis);
