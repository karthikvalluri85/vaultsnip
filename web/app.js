/* VaultSnip: app pipeline.
   capture -> local OCR -> mask everything except an allowlist -> independent re-scan gate
   -> human approval of the exact payload -> layout spec from Claude or OpenAI (your key) -> synthetic replica -> export.
   Nothing is persisted except, optionally, your API key (only if you tick "remember"). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const isExt = !!(window.chrome && chrome.runtime && chrome.runtime.id);

  /* ---------------- state (memory only) ---------------- */
  const S = {
    img: null,            // HTMLCanvasElement of the source
    words: [],            // OCR words {text, conf, x, y, w, h}
    masks: [],            // {x,y,w,h,type,text,on,src}
    flags: [],            // verification findings
    gate: 'pending',      // pending | dirty | pass | review | blocked
    sample: null,         // sample object when running a sample
    spec: null, mode: 'shape', seed: 4127,
    view: 'orig',
    provider: 'anthropic', key: null, model: 'claude-sonnet-5-5',
    sessionAllow: new Set(),
    keepComments: false, comments: [], commentVocab: new Set()
  };
  try {
    const k = localStorage.getItem('dsc-key'), m = localStorage.getItem('dsc-model'), p = localStorage.getItem('dsc-provider');
    if (k) { S.key = k; S.provider = (p && VSLLM.PROVIDERS[p]) ? p : (VSLLM.detect(k) || 'anthropic'); S.model = m || VSLLM.PROVIDERS[S.provider].defaultModel; }
  } catch (e) { /* storage unavailable */ }
  const providerName = () => VSLLM.PROVIDERS[S.provider].short;
  function remember(on) {
    try {
      if (on && S.key) { localStorage.setItem('dsc-key', S.key); localStorage.setItem('dsc-model', S.model); localStorage.setItem('dsc-provider', S.provider); }
      else if (!on) ['dsc-key', 'dsc-model', 'dsc-provider'].forEach(k => localStorage.removeItem(k));
    } catch (e) { /* storage unavailable */ }
  }

  /* ---------------- AI key panel (shared by the send dialog and the key dialog) ---------------- */
  function keyPanel(host, id) {
    const P = VSLLM.PROVIDERS;
    host.className = 'kp';
    host.innerHTML = `
      <label class="f" for="${id}-p">AI provider<select id="${id}-p">${Object.keys(P).map(k => `<option value="${k}">${P[k].name}</option>`).join('')}</select></label>
      <label class="f" for="${id}-k">API key<input type="password" id="${id}-k" autocomplete="off" spellcheck="false"></label>
      <div class="kp-row"><label class="f" for="${id}-m">Model<input type="text" id="${id}-m" list="${id}-ml" autocomplete="off" spellcheck="false"><datalist id="${id}-ml"></datalist></label>
        <button class="btn" type="button" id="${id}-c">Check key</button></div>
      <p class="note" id="${id}-s" role="status" aria-live="polite"></p>
      <p class="note" id="${id}-h"></p>
      <label class="note"><input type="checkbox" id="${id}-r"> Remember the key on this device</label>`;
    const el = n => document.getElementById(id + '-' + n);
    const show = () => {
      const p = P[el('p').value];
      el('k').placeholder = p.keyHint;
      el('h').innerHTML = `The key goes only to <b>${p.host}</b>. No key yet? <a href="${p.keyUrl}" target="_blank" rel="noopener">Create one</a> (about 2 minutes).`;
    };
    let typedModel = false;
    el('m').addEventListener('input', () => { typedModel = true; });
    el('p').addEventListener('change', () => { el('m').value = P[el('p').value].defaultModel; el('ml').innerHTML = ''; el('s').textContent = ''; typedModel = false; show(); });
    el('k').addEventListener('input', () => {
      const d = VSLLM.detect(el('k').value);
      if (d && d !== el('p').value) { el('p').value = d; if (!typedModel) el('m').value = P[d].defaultModel; el('ml').innerHTML = ''; show(); el('s').textContent = 'This looks like ' + P[d].name + ' key.'; }
    });
    async function check() {
      const key = el('k').value.trim(), prov = el('p').value;
      if (!key) { el('s').textContent = 'Paste a key first.'; return false; }
      el('s').textContent = 'Checking the key with ' + P[prov].host + '…'; el('c').disabled = true;
      try {
        const r = await VSLLM.models(prov, key);
        el('ml').innerHTML = r.ids.map(i => `<option value="${i}"></option>`).join('');
        if (!r.ids.includes(el('m').value.trim())) el('m').value = r.suggested;
        el('s').innerHTML = `<span class="ok">✓ Key works.</span> ${r.ids.length} models available; using <b>${el('m').value}</b>.`;
        return true;
      } catch (e) { el('s').textContent = e.message; return false; }
      finally { el('c').disabled = false; }
    }
    el('c').onclick = check;
    return {
      fill() {
        el('p').value = S.provider; el('k').value = S.key || ''; el('m').value = S.model; el('s').textContent = ''; typedModel = false; show();
        try { el('r').checked = !!localStorage.getItem('dsc-key'); } catch (e) { el('r').checked = false; }
      },
      read() {
        const key = el('k').value.trim();
        return { provider: el('p').value, key: key || null, model: el('m').value.trim() || P[el('p').value].defaultModel, remember: el('r').checked };
      },
      check
    };
  }
  const kpSend = keyPanel($('kp-send'), 'kps'), kpDlg = keyPanel($('kp-dlg'), 'kpd');
  // From the key dialog, unticking "remember" also forgets a previously remembered key.
  function applyKey(v, fromDialog) { S.provider = v.provider; S.key = v.key; S.model = v.model; if (v.remember) remember(true); else if (fromDialog) remember(false); }

  /* ---------------- allowlist: everything else is masked ---------------- */
  const ALLOW = new Set((`
a an and or of the to in on at by for from with per vs versus via all any each other others total totals subtotal grand
top bottom first last next previous prior current new old high medium low average avg mean median min max sum count share rate ratio index
revenue sales net gross margin profit loss income cost costs expense expenses spend budget forecast actual actuals target targets plan variance
growth change delta trend trends performance overview summary dashboard report reports scorecard kpi kpis metric metrics measure value values amount amounts
units unit orders order customers customer accounts account clients client users user sessions session visitors visits pageviews views page pages
bounce conversion conversions clicks click impressions ctr cpc cpm roi roas leads lead pipeline opportunities deals bookings quota attainment
region regions country countries city cities state states territory market markets segment segments channel channels category categories product products brand brands
department departments team teams owner manager managers name names id type types status priority stage stages step steps source sources item items
date dates day days week weeks weekly month months monthly quarter quarters quarterly year years yearly annual period periods time hour hours today ytd mtd qtd ly py yoy mom wow fy
jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december
mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday
emea apac amer latam na eu uk us usa europe asia africa america americas oceania middle east west north south central global worldwide international domestic
germany france italy spain netherlands belgium switzerland austria sweden norway denmark finland nordics ireland portugal poland greece czechia hungary romania
india china japan korea singapore australia canada mexico brazil argentina chile colombia indonesia thailand vietnam malaysia philippines turkey israel uae saudi arabia egypt nigeria kenya
retail wholesale online offline direct indirect organic paid search social email referral display affiliate partner partners
open closed pending active inactive won lost churn churned returning retention acquisition onboarding support tickets ticket backlog sla
operations ops finance hr legal marketing technology engineering it procurement supply chain logistics inventory stock warehouse delivery shipping
cash flow ebitda ebit opex capex cogs arr mrr ltv cac nps csat headcount fte hiring attrition
filter filters select selected show hide all none more less other others yes no n/a na unknown
as of data source sources updated last refreshed prepared confidential internal only use
crash crashes free install installs uninstalls download downloads rating ratings review reviews release releases version versions build builds device devices
app apps android ios web mobile desktop tablet platform platforms browser health quality issue issues cluster clusters error errors uptime latency usage
daily weekly stickiness adoption feature features cohort cohorts signup signups trial trials paid activation activated retained engagement engaged
flow flows first response responses resolution resolved solved handle handling tier tiers agent agents leaderboard queue queues reason reasons contact contacts volume
score scores distribution promoter promoters passive passives detractor detractors survey surveys theme themes comment comments verbatim verbatims voice feedback
pricing price prices model models seat seats discount discounts scenario scenarios assumption assumptions list scope roadmap
sprint sprints story stories points velocity burndown committed completed carry over bug bugs task tasks spike done blocked progress todo epic epics
experiment experiments variant variants control treatment lift interval significant significance confidence
median p50 p75 p90 p95 percent percentage minutes minute min mins seconds second sec secs ms
`).split(/\s+/).filter(Boolean));

  const TYPES = {
    'Client name': '#4a3aa7',
    'Number or money': '#eb6834',
    'Identifier': '#2a78d6',
    'Email': '#e34948',
    'Name in comment': '#a1338f',
    'Text not on allowlist': '#1baf7a',
    'Added by you': '#14181e',
    'Added after check': '#b03c38'
  };

  function clientNames() { return $('client-names').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean); }
  function extraAllow() { return new Set($('extra-allow').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)); }

  function classify(text) {
    const raw = text.trim();
    const clean = raw.replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, '');
    if (!clean) return null;
    const low = clean.toLowerCase();
    if (clientNames().some(n => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return 'Client name';
    if (/\w@\w/.test(raw) || (/@/.test(raw) && /\./.test(raw))) return 'Email';
    if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return null;
    if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return 'Identifier';
    if (/[\d€$£¥₹%]/.test(clean)) return 'Number or money';
    if (clean.length <= 1) return null;
    if (ALLOW.has(low) || S.sessionAllow.has(low) || extraAllow().has(low)) return null;
    const parts = low.split(/[-/&]/).filter(Boolean);
    if (parts.length > 1 && parts.every(p => ALLOW.has(p) || extraAllow().has(p))) return null;
    return 'Text not on allowlist';
  }

  /* ---------------- OCR (local, Tesseract in WASM) ---------------- */
  let workerP = null;
  function worker() {
    if (!workerP) {
      workerP = Tesseract.createWorker('eng', 1, {
        workerPath: 'lib/worker.min.js', corePath: 'lib/core', langPath: (window.VAULTSNIP_CONFIG && window.VAULTSNIP_CONFIG.langPath) || 'lang',
        workerBlobURL: false, gzip: true, cacheMethod: 'write',
        logger: m => { if (m.status && typeof m.progress === 'number') setStatus(`${humanStatus(m.status)} ${Math.round(m.progress * 100)}%`, true); }
      }).then(async w => { await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' }); return w; });
    }
    return workerP;
  }
  function humanStatus(s) {
    if (/loading language|loading tesseract|initializ/i.test(s)) return 'Loading the on-device text reader (first run only)…';
    if (/recognizing/i.test(s)) return 'Reading text on this device…';
    return s;
  }
  // Image filters per pass. "contrast" finds short, isolated tokens ("0%", "$1M", single digits in coloured pills)
  // that the plain passes miss; "block" (page segmentation 6) reads tight table rows and badges.
  const FILTERS = { normal: 'grayscale(1)', inverted: 'invert(1) grayscale(1)', contrast: 'grayscale(1) contrast(2.2)', block: 'grayscale(1) contrast(2.2)' };
  function prep(src, scale, kind) {
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.filter = FILTERS[kind] || FILTERS.normal;
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function ocr(src, scale, kind) {
    kind = kind === true ? 'inverted' : (kind || 'normal');
    const invert = kind === 'inverted';
    const w = await worker();
    if (kind === 'block') await w.setParameters({ tessedit_pageseg_mode: '6' });
    let data;
    try { ({ data } = await w.recognize(prep(src, scale, kind), {}, { tsv: true, text: false, blocks: false, hocr: false })); }
    finally { if (kind === 'block') await w.setParameters({ tessedit_pageseg_mode: '11' }); }
    const out = [];
    (data.tsv || '').split('\n').forEach(line => {
      const c = line.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const text = c.slice(11).join('\t').trim(); const conf = parseFloat(c[10]);
      if (!text || conf < 30) return;
      out.push({ text, conf, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale, line: `${c[2]}-${c[3]}-${c[4]}`, inv: invert, pass: kind });
    });
    return out;
  }
  // Several passes, merged: a word found by a later pass is kept only if no earlier pass found it.
  async function readAll(src, passes) {
    let all = [];
    for (const [scale, kind] of passes) {
      const got = await ocr(src, scale, kind);
      all = all.concat(got.filter(w => !all.some(v => overlap(v, w) > 0.3)));
    }
    return plausible(all);
  }
  // C: the reader sometimes sees chart graphics as giant "words" (10-25x taller than real text, low confidence).
  // Masking those would hide whole charts, so they are dropped. Real large text (KPI numbers, titles) is kept:
  // it contains digits, or is read with high confidence at a sensible size.
  function plausible(words) {
    const hs = words.map(w => w.h).sort((a, b) => a - b);
    const med = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
    return words.filter(w => {
      const tall = w.h / med, hasDigit = /\d/.test(w.text), letters = (w.text.match(/[A-Za-z]/g) || []).length;
      if (tall > 8 && !(hasDigit && w.conf >= 90)) return false;
      if (tall > 3 && !hasDigit && (w.conf < 80 || letters < 3)) return false;
      if (tall > 4 && w.conf < 70) return false;                                   // tall, unsure "digits" drawn by chart shapes
      const chars = Math.max(1, w.text.replace(/\s/g, '').length);
      if (w.w > w.h * chars * 2.5 && w.w > med * 12 && w.conf < 85) return false;   // far too wide for its few characters
      return true;
    });
  }
  const overlap = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ix * iy / Math.min(a.w * a.h || 1, b.w * b.h || 1);
  };

  /* ---------------- customer comments ---------------- */
  // On voice-of-customer and support screens the wording of a comment is the insight; who wrote it is the
  // sensitive part. When the user opts in, ordinary words inside comments stay readable, while names,
  // companies, emails, numbers and IDs inside them stay masked. Off by default.
  const STARTERS = new Set((`
i i'm i've i'd i'll we we're we've we'd we'll you you're your our ours my mine me us they they're their them it it's its this that these those there here
he she his her him who what when where why how which whose whom if once since after before until while because although though unless whether
the a an and but or so yet also still just only even very really quite too much many most more less some any every each all both either neither
no not never always often sometimes usually again already almost perhaps maybe please thanks thank sorry hello hi ok okay yes
is are was were be been being am has have had do does did don't doesn't didn't can can't cannot could couldn't would wouldn't should shouldn't
will won't shall may might must need needs needed want wants wish hope love loved like liked hate hated enjoy prefer think feel felt find found
good great excellent amazing awesome brilliant outstanding fantastic superb perfect nice fine decent solid easy simple clear fast quick smooth
bad poor terrible awful horrible slow hard difficult confusing clunky buggy broken expensive cheap overall honestly frankly generally mostly
best worst better worse new old first last next another other same different whole entire half overall finally recently lately today yesterday
export exports reporting dashboard dashboards invoice invoices invoicing billing payment payments approval approvals integration integrations
login sign setup set up search notifications notification alerts alert sync syncing upload uploads checkout onboarding training documentation docs
customer service staff agent team people everyone nobody someone something nothing everything anything
`).split(/\s+/).filter(Boolean));
  const OPEN_Q = /^["“‘'«„]/, CLOSE_Q = /["”’'»][.,!?]?$/;
  const core = t => String(t).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const normW = t => core(t).toLowerCase().replace(/’/g, "'");
  const lowerWord = c => /^\p{Ll}[\p{Ll}'’-]*$/u.test(c);
  const COMMON_END = /(ing|ed|ly|tion|sion|ment|ness|ity|able|ible|ful|less|ous|ive|est)$/;
  const knownWord = lc => ALLOW.has(lc) || STARTERS.has(lc) || S.sessionAllow.has(lc) || extraAllow().has(lc);
  // a capitalised word that opens a sentence is kept only when it is an ordinary word, never a likely name
  const startWordOk = c => { const lc = c.toLowerCase().replace(/’/g, "'"); return knownWord(lc) || (lc.length > 5 && COMMON_END.test(lc)) || (/s$/.test(lc) && knownWord(lc.slice(0, -1))); };

  // Words on the same baseline form a band; a band splits into lines wherever there is a wide horizontal gap.
  function textLines(words) {
    const bands = [];
    words.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2)).forEach(w => {
      const cy = w.y + w.h / 2;
      const b = bands.find(b => Math.abs(b.cy - cy) < Math.min(b.mh, w.h) * 0.7);
      if (b) b.words.push(w); else bands.push({ cy, mh: w.h, words: [w] });
    });
    const lines = [];
    bands.forEach(b => {
      const ws = b.words.sort((a, c) => a.x - c.x);
      const mh = ws.map(w => w.h).sort((a, c) => a - c)[Math.floor(ws.length / 2)];
      let cur = null;
      ws.forEach(w => {
        if (cur && w.x - cur.right < mh * 2.5) { cur.words.push(w); cur.right = Math.max(cur.right, w.x + w.w); cur.top = Math.min(cur.top, w.y); cur.bottom = Math.max(cur.bottom, w.y + w.h); }
        else lines.push(cur = { words: [w], mh, left: w.x, right: w.x + w.w, top: w.y, bottom: w.y + w.h });
      });
    });
    return lines.sort((a, b) => a.top - b.top || a.left - b.left);
  }
  // A comment line starts with an opening quote, or reads as a sentence (7+ words, mostly lower case, with punctuation),
  // or continues the comment on the line above.
  function findComments(words) {
    words.forEach(w => { delete w.cmStart; delete w.inCm; });
    const out = []; let blocks = 0;
    textLines(words).forEach(l => {
      const toks = l.words.map(w => w.text), cores = toks.map(core).filter(Boolean);
      if (!cores.length) return;
      const lowers = cores.filter(lowerWord).length;
      const quoted = OPEN_Q.test(toks[0]) && cores.length >= 3;
      const prose = cores.length >= 7 && lowers / cores.length >= 0.6 && /[.,!?;]/.test(toks.join(' '));
      const prev = out.find(c => c.open && Math.abs(c.left - l.left) < c.mh * 2 && l.top - c.bottom > -2 && l.top - c.bottom < c.mh * 1.2);
      const cont = !quoted && prev && lowers / cores.length >= 0.4;
      if (!(quoted || prose || cont)) return;
      if (prev) prev.open = false;
      if (!cont) blocks++;
      l.open = !CLOSE_Q.test(toks[toks.length - 1]);
      let start = true;
      l.words.forEach(w => { w.inCm = true; w.cmStart = start || OPEN_Q.test(w.text); const c = core(w.text); start = /[.!?]["”’)]*$/.test(w.text) || (start && !c); });
      out.push(l);
    });
    out.blocks = blocks;
    return out;
  }
  function commentType(w) {
    const t = classify(w.text), c = core(w.text);
    if (t && t !== 'Text not on allowlist') return t;           // names you listed, emails, IDs, numbers and money
    if (!t || !c || lowerWord(c) || /^I(['’]\w+)?$/.test(c)) return null;
    return w.cmStart && startWordOk(c) ? null : 'Name in comment';
  }
  const inComment = w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return S.comments.some(l => cx >= l.left - 4 && cx <= l.right + 4 && cy >= l.top - 4 && cy <= l.bottom + 4); };
  // The replica may only quote words that were readable in the approved image; anything else becomes "[…]".
  function scrubQuote(q) {
    const names = clientNames();
    const ok = w => S.commentVocab.has(w) || knownWord(w);
    return String(q == null ? '' : q).slice(0, 400).split(/\s+/).filter(Boolean).map(tok => {
      if (/^\[(…|\.\.\.|hidden|redacted|masked|client|name)\]\W*$/i.test(tok)) return '[…]';
      const lc = normW(tok);
      if (!lc) return tok;
      if (/\d|@|https?:|www\./i.test(tok)) return '[…]';
      if (names.some(n => lc.includes(n) || n.split(/\s+/).includes(lc))) return '[…]';
      if (ok(lc) || (/[-']/.test(lc) && lc.split(/[-']/).filter(Boolean).every(ok))) return tok;
      return '[…]';
    }).join(' ').replace(/(\[…\][^\s\p{L}\p{N}]*\s*){2,}/gu, '[…] ').replace(/\s+([.,!?;:])/g, '$1').trim();
  }
  function scrubVerbatims(spec) {
    (spec.rows || []).forEach(r => (r.visuals || []).forEach(v => (v.type === 'table' && Array.isArray(v.columns) ? v.columns : []).forEach(c => {
      if (!/^(verbatim|quote|comment)s?$/i.test(String(c.kind || ''))) return;
      if (!S.keepComments || !Array.isArray(c.values)) { delete c.values; return; }
      c.values = c.values.slice(0, 25).map(scrubQuote);
    })));
    return spec;
  }

  /* ---------------- masks ---------------- */
  function buildMasks(words) {
    const keep = S.keepComments;
    S.commentVocab = new Set();
    const flagged = words.map(w => {
      const type = keep && w.inCm ? commentType(w) : classify(w.text);
      if (keep && w.inCm && !type && normW(w.text)) S.commentVocab.add(normW(w.text));
      return Object.assign({}, w, { type });
    }).filter(w => w.type);
    flagged.sort((a, b) => (Math.round(a.y / 8) - Math.round(b.y / 8)) || (a.x - b.x));
    const groups = [];
    flagged.forEach(w => {
      const g = groups[groups.length - 1];
      const sameLine = g && Math.abs((g.y + g.h / 2) - (w.y + w.h / 2)) < Math.max(g.h, w.h) * 0.6;
      if (g && g.type === w.type && sameLine && w.x - (g.x + g.w) < Math.max(14, w.h * 1.2) && w.x >= g.x) {
        const x2 = Math.max(g.x + g.w, w.x + w.w), y1 = Math.min(g.y, w.y), y2 = Math.max(g.y + g.h, w.y + w.h);
        g.text += ' ' + w.text; g.w = x2 - g.x; g.y = y1; g.h = y2 - y1;
      } else groups.push({ x: w.x, y: w.y, w: w.w, h: w.h, type: w.type, text: w.text, on: true, src: 'auto' });
    });
    return groups.map(g => { const p = Math.max(3, g.h * 0.18); return Object.assign(g, { x: g.x - p, y: g.y - p, w: g.w + 2 * p, h: g.h + 2 * p }); });
  }
  function maskedCanvas(scale) {
    scale = scale || 1;
    const c = document.createElement('canvas');
    c.width = Math.round(S.img.width * scale); c.height = Math.round(S.img.height * scale);
    const x = c.getContext('2d');
    x.drawImage(S.img, 0, 0, c.width, c.height);
    x.fillStyle = '#787c82';
    S.masks.filter(m => m.on).forEach(m => x.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale));
    return c;
  }

  /* ---------------- verification gate (independent re-scan) ---------------- */
  async function verify() {
    S.gate = 'running'; renderGate();
    setStatus('Checking the masked image again (four independent passes)…', true);
    const m2 = maskedCanvas(1);
    const all = await readAll(m2, [[2, 'normal'], [1.5, 'inverted'], [3, 'contrast'], [3, 'block']]);
    const active = S.masks.filter(m => m.on);
    const flags = [];
    all.forEach(w => {
      if (w.conf < 45) return;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      if (active.some(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h)) return;
      const t = classify(w.text);
      if (!t) return;
      if (t === 'Text not on allowlist' && S.keepComments && inComment(w)) {
        const c = core(w.text);
        if (lowerWord(c) || S.commentVocab.has(normW(c))) { S.commentVocab.add(normW(c)); return; }   // ordinary comment wording you chose to keep
      }
      if (t === 'Text not on allowlist' && (w.text.match(/[A-Za-z]/g) || []).length <= 2 && !/\d/.test(w.text)) return; // fragments like "El", "oy" carry no information
      if (flags.some(f => overlap(f, w) > 0.3)) return;
      flags.push({ x: w.x - 3, y: w.y - 3, w: w.w + 6, h: w.h + 6, text: w.text, type: t, severity: t === 'Text not on allowlist' ? 'review' : 'block', resolved: false });
    });
    S.flags = flags;
    updateGate();
    setStatus(flags.length ? `Check found ${flags.length} item${flags.length > 1 ? 's' : ''} to resolve.` : 'Check passed. Nothing readable is left outside the masks.', false);
    draw();
  }
  function updateGate() {
    const open = S.flags.filter(f => !f.resolved);
    S.gate = open.some(f => f.severity === 'block') ? 'blocked' : open.length ? 'review' : 'pass';
    renderGate();
  }
  function renderGate() {
    const g = $('gate');
    const map = {
      pending: ['pending', 'Not run yet', 'The check re-reads the masked image on this device.'],
      running: ['pending', 'Checking…', 'Re-reading the masked image on this device.'],
      dirty: ['pending', 'Masks changed', 'Re-run the check before sending.'],
      pass: ['pass', 'Pass', S.flags.length ? 'Every finding is resolved. You can preview what is sent.' : 'Nothing readable is left outside the masks.'],
      review: ['review', 'Review needed', 'Unlisted words are still readable. Mask them or mark them safe.'],
      blocked: ['blocked', 'Blocked', 'Numbers or IDs are still readable. Mask them before sending.']
    }[S.gate];
    g.className = 'gate ' + map[0];
    g.innerHTML = `<b>${map[1]}</b><span>${map[2]}</span>`;
    $('btn-send').disabled = S.gate !== 'pass';
    $('btn-recheck').disabled = S.gate === 'running';
    const fl = $('flags');
    fl.innerHTML = '';
    const openFlags = S.flags.filter(f => !f.resolved);
    if (openFlags.length > 1) {
      const all = document.createElement('button'); all.type = 'button'; all.className = 'btn'; all.textContent = `Mask all ${openFlags.length} findings`;
      all.onclick = () => { openFlags.forEach(f => { S.masks.push({ x: f.x, y: f.y, w: f.w, h: f.h, type: 'Added after check', text: f.text, on: true, src: 'check' }); f.resolved = true; }); updateGate(); renderTypes(); draw(); };
      fl.appendChild(all);
    }
    S.flags.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'flag';
      d.innerHTML = `<span class="sw" style="background:${f.severity === 'block' ? 'var(--bad)' : 'var(--warn)'}"></span><code></code>`;
      d.querySelector('code').textContent = f.resolved ? `${f.text} (resolved)` : f.text;
      if (!f.resolved) {
        const mk = document.createElement('button'); mk.type = 'button'; mk.textContent = 'Mask it';
        mk.onclick = () => { S.masks.push({ x: f.x, y: f.y, w: f.w, h: f.h, type: 'Added after check', text: f.text, on: true, src: 'check' }); f.resolved = true; updateGate(); renderTypes(); draw(); };
        d.appendChild(mk);
        if (f.severity === 'review') {
          const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = 'Safe to keep';
          ok.onclick = () => { S.sessionAllow.add(f.text.toLowerCase().replace(/[^\w-]/g, '')); f.resolved = true; updateGate(); draw(); };
          d.appendChild(ok);
        }
      }
      fl.appendChild(d);
    });
  }

  /* ---------------- review canvas ---------------- */
  const rc = $('review-canvas');
  function draw() {
    if (!S.img) return;
    rc.width = S.img.width; rc.height = S.img.height;
    const x = rc.getContext('2d');
    if (S.view === 'mask') { x.drawImage(maskedCanvas(1), 0, 0); return; }
    x.drawImage(S.img, 0, 0);
    const lw = Math.max(2, S.img.width / 600);
    S.masks.forEach(m => {
      const col = TYPES[m.type] || '#14181e';
      x.lineWidth = lw; x.strokeStyle = col; x.setLineDash(m.on ? [] : [6, 4]);
      x.globalAlpha = m.on ? 0.22 : 0; x.fillStyle = col; x.fillRect(m.x, m.y, m.w, m.h);
      x.globalAlpha = 1; x.strokeRect(m.x, m.y, m.w, m.h);
    });
    if (S.keepComments) { x.setLineDash([3, 3]); x.lineWidth = lw; x.strokeStyle = '#0d6b5d'; S.comments.forEach(l => x.strokeRect(l.left - 4, l.top - 3, l.right - l.left + 8, l.bottom - l.top + 6)); }
    x.setLineDash([4, 3]);
    S.flags.filter(f => !f.resolved).forEach(f => { x.lineWidth = lw * 1.5; x.strokeStyle = f.severity === 'block' ? '#b03c38' : '#a55d00'; x.strokeRect(f.x, f.y, f.w, f.h); });
    x.setLineDash([]);
    if (drag && drag.moved) { x.lineWidth = lw; x.strokeStyle = '#14181e'; x.setLineDash([6, 4]); x.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); x.setLineDash([]); }
  }
  function renderTypes() {
    const counts = {};
    S.masks.filter(m => m.on).forEach(m => counts[m.type] = (counts[m.type] || 0) + 1);
    $('types').innerHTML = Object.keys(TYPES).filter(t => counts[t]).map(t => `<div><span class="sw" style="background:${TYPES[t]}"></span><span>${t}</span><b>${counts[t]}</b></div>`).join('') || '<div class="hint">Nothing masked yet.</div>';
  }
  let drag = null;
  function pt(e) { const r = rc.getBoundingClientRect(); return { x: (e.clientX - r.left) * rc.width / r.width, y: (e.clientY - r.top) * rc.height / r.height }; }
  rc.addEventListener('pointerdown', e => { if (S.view !== 'orig' || !S.img) return; const p = pt(e); drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false }; rc.setPointerCapture(e.pointerId); });
  rc.addEventListener('pointermove', e => { if (!drag) return; const p = pt(e); drag.x1 = p.x; drag.y1 = p.y; if (Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) > 8) drag.moved = true; draw(); });
  rc.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) {
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w > 4 && h > 4) S.masks.push({ x, y, w, h, type: 'Added by you', text: '(drawn box)', on: true, src: 'manual' });
    } else {
      const hit = S.masks.slice().reverse().find(m => d.x0 >= m.x && d.x0 <= m.x + m.w && d.y0 >= m.y && d.y0 <= m.y + m.h);
      if (!hit) { draw(); return; }
      hit.on = !hit.on;
    }
    S.gate = 'dirty'; renderGate(); renderTypes(); draw();
  });

  /* ---------------- status ---------------- */
  function setStatus(t, busy) { $('status-text').textContent = t; $('status').querySelector('.spinner').hidden = !busy; }

  /* ---------------- screens ---------------- */
  function show(id) { ['s-drop', 's-crop', 's-review', 's-replica'].forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); }

  async function loadImage(src) {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That file could not be read as an image.')); img.src = src; });
    const maxD = 2200, k = Math.min(1, maxD / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  async function startReview(canvas) {
    S.img = canvas; S.masks = []; S.flags = []; S.gate = 'pending'; S.view = 'orig'; S.spec = null;
    S.keepComments = false; S.comments = []; S.commentVocab = new Set(); $('keep-comments').checked = false; $('cm-panel').hidden = true;
    setView('orig');
    show('s-review'); renderGate(); renderTypes(); draw();
    $('btn-reapply').disabled = true;
    try {
      setStatus('Loading the on-device text reader…', true);
      S.words = await readAll(canvas, [[1.5, 'normal'], [1.5, 'inverted'], [3, 'contrast']]);
      S.comments = findComments(S.words);
      S.masks = buildMasks(S.words);
      if (S.comments.length) { $('cm-count').textContent = S.comments.blocks + ' comment' + (S.comments.blocks === 1 ? '' : 's'); $('cm-panel').hidden = false; }
      renderTypes(); draw();
      setStatus(`Read ${S.words.length} words. Masked ${S.masks.length} regions.`, false);
      $('btn-reapply').disabled = false;
      await verify();
    } catch (err) {
      console.error(err);
      setStatus('The on-device reader could not start: ' + (err && err.message || err), false);
      if (window.VSFeedback) VSFeedback.problem(err, 'On-device reader');
    }
  }

  function setView(v) {
    S.view = v;
    $('v-orig').setAttribute('aria-pressed', String(v === 'orig'));
    $('v-mask').setAttribute('aria-pressed', String(v === 'mask'));
    rc.style.cursor = v === 'orig' ? 'crosshair' : 'default';
    draw();
  }
  $('v-orig').onclick = () => setView('orig');
  $('v-mask').onclick = () => setView('mask');
  $('btn-recheck').onclick = () => verify();
  $('keep-comments').onchange = async e => {
    S.keepComments = e.target.checked;
    const manual = S.masks.filter(m => m.src !== 'auto');
    S.masks = buildMasks(S.words).concat(manual);
    S.gate = 'dirty'; renderTypes(); draw(); await verify();
  };
  $('btn-reapply').onclick = async () => {
    const manual = S.masks.filter(m => m.src !== 'auto');
    S.masks = buildMasks(S.words).concat(manual);
    S.gate = 'dirty'; renderTypes(); draw(); await verify();
  };

  /* ---------------- Screen 1 ---------------- */
  $('btn-try').onclick = () => {
    const box = $('samples');
    box.hidden = false;
    box.innerHTML = '';
    window.DSC_SAMPLES.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'sample';
      d.innerHTML = `<span class="tag">${s.image ? 'Full redaction demo' : 'Replica only'}</span><h3></h3><p></p><button class="btn ${i === 0 ? 'primary' : ''}" type="button">${s.image ? 'Run the demo' : 'Open replica'}</button>`;
      d.querySelector('h3').textContent = s.name; d.querySelector('p').textContent = s.blurb;
      d.querySelector('button').onclick = () => openSample(s);
      box.appendChild(d);
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  async function openSample(s) {
    S.sample = s;
    if (s.image) {
      $('client-names').value = s.clientNames || '';
      await startReview(await loadImage(s.image));
    } else {
      S.spec = s.spec; S.seed = 4127; showReplica();
    }
  }
  const drop = $('drop'), file = $('file');
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) useFile(f); };
  file.onchange = () => { if (file.files[0]) useFile(file.files[0]); file.value = ''; };
  window.addEventListener('paste', e => { if ($('s-drop').hidden) return; const it = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/')); if (it) useFile(it.getAsFile()); });
  async function useFile(f) {
    if (!/^image\/(png|jpeg)$/.test(f.type)) { alert('Please use a PNG or JPG image.'); return; }
    if (f.size > 10 * 1024 * 1024) { alert('Please use an image under 10 MB.'); return; }
    S.sample = null; $('client-names').value = '';
    const url = URL.createObjectURL(f);
    try { await startReview(await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  }

  /* ---------------- payload preview + send ---------------- */
  $('btn-send').onclick = () => {
    const c = maskedCanvas(1);
    const url = c.toDataURL('image/png');
    S.payload = url;
    $('payload-img').src = url;
    $('pf-contents').textContent = 'The masked image above and fixed instructions. No original image, no OCR text.' + (S.keepComments ? ' Customer comments are readable, with names, companies, emails and numbers in them masked.' : '');
    $('pf-size').textContent = Math.round(url.length * 0.75 / 1024) + ' KB';
    const isSample = !!S.sample;
    $('pf-dest').textContent = isSample ? 'Nothing is sent: this sample uses a bundled spec' : (S.key ? VSLLM.PROVIDERS[S.provider].host + ' (' + S.model + '), using your key' : 'The AI provider you choose below, using your key');
    $('keybox').hidden = isSample || !!S.key;
    kpSend.fill();
    $('send-err').hidden = true;
    $('btn-confirm').disabled = false;
    $('btn-confirm').textContent = isSample ? 'Build replica' : 'Send and build replica';
    $('dlg-send').showModal();
  };
  $('btn-confirm').onclick = async () => {
    const err = $('send-err'); err.hidden = true;
    if (S.sample) { $('dlg-send').close(); S.spec = S.sample.spec; S.seed = 4127; showReplica(); return; }
    if (!S.key) {
      const v = kpSend.read();
      if (!v.key) { err.textContent = 'Add your Claude or OpenAI API key to continue, or try a sample instead.'; err.hidden = false; return; }
      applyKey(v);
      $('pf-dest').textContent = VSLLM.PROVIDERS[S.provider].host + ' (' + S.model + '), using your key';
    }
    $('btn-confirm').disabled = true; $('btn-confirm').textContent = 'Asking ' + providerName() + ' for the layout…';
    try {
      S.spec = scrubVerbatims(await askModel(S.payload));
      S.seed = 1000 + Math.floor(Math.random() * 9000);
      $('dlg-send').close();
      showReplica();
    } catch (e) {
      err.textContent = e.message || String(e); err.hidden = false;
      if (e.status === 401) { S.key = null; $('keybox').hidden = false; kpSend.fill(); }
      if (window.VSFeedback) { VSFeedback.note(e, providerName() + ' request (' + S.model + ')'); err.insertAdjacentHTML('beforeend', ' <button type="button" class="linkbtn" data-feedback="bug">Report this</button>'); }
      $('btn-confirm').disabled = false; $('btn-confirm').textContent = 'Try again';
    }
  };

  const SYSTEM = `You convert a screenshot of a dashboard or report into a JSON layout spec for a synthetic replica.
Grey boxes cover redacted text. Never guess, reconstruct or mention redacted content. Never output a real value (the only text you copy is visible labels and visible comment wording, as described below).
Rules:
- Output JSON only, no prose, matching this shape:
{"title":string,"subtitle":string,"theme":{"primary":"#hex","secondary":"#hex"},
 "filters":[{"label":string,"members":[string]}],
 "rows":[{"height":"s"|"m"|"l","visuals":[VISUAL]}]}
VISUAL fields: "id", "type", "span" (1-12 grid columns; a row's spans sum to 12), "title",
 "measure":{"name":string,"format":"currency"|"number"|"percent"|"integer","currency":"$"|"€"|"£"|"₹"|"","scaleHint":number (optional: a plausible typical magnitude for this kind of measure, e.g. 40 for days, 900 for headcount; never copy a visible value)},
 "dimension":{"name":string,"members":[string]}, "series":[{"name":string,"shape":[0-100 per member],"kind":"bar"|"line"}],
 "horizontal":bool, "stacked":bool, "stackedPercent":bool, "valueLabels":bool, "sparkline":bool.
Types: kpi, bar, column, line, area, combo, pie, donut, treemap, funnel, waterfall, scatter, bubble, heatmap, gauge, boxplot, histogram, sankey, gantt, table, text, map, placeholder.
 Orientation: "column" = vertical bars rising from the x-axis (categories along the bottom). "bar" = horizontal bars (categories down the left side) and must have "horizontal":true. Never send "column" with "horizontal":true.
 Stacking: "stacked":true only when segments sit on top of each other in one bar. Bars side by side for each category are grouped: "stacked":false. Include one entry in "series" for every legend item.
 heatmap: "rows":{"name","members"},"columns":{"name","members"},"matrix":[[0-100]].
 scatter/bubble: "xMeasure","yMeasure","points":[[x0-100,y0-100,size0-100]].
 gauge: "shapeValue":0-100 (needle or arc position), plus "min" and "max" when the scale is not 0-100 (for example -100 and 100 for NPS). waterfall: series shape signed -100..100, last member is the total (0).
 sankey: "nodes":[string],"links":[{"source":index,"target":index,"shape":0-100}].
 gantt (also roadmaps and timelines): "tasks":[{"name":string,"start":0-100,"end":0-100}] in top-to-bottom order, positions measured along the time axis; "timeLabels":[string] for the visible time-axis labels, left to right.
 map: "basemap":"world"|"europe"|"usa"|"canada"|"mexico"|"brazil"|"uk"|"france"|"germany"|"italy"|"spain"|"india"|"china"|"japan"|"australia"|"south-africa" (the closest outline to what is shown),
  "mapKind":"filled"|"bubble"|"density"|"flow". filled: "dimension":{"name","members":[regions that are shaded]} with series shape = relative colour intensity.
  bubble/density: "points":[{"name":string,"lat":number,"lon":number,"shape":0-100}] for each marker or hotspot, placed by where it sits on the map (if its label is masked, name it "Location N").
  flow: "points" for the endpoints plus "flows":[{"from":name,"to":name,"shape":0-100}].
  Recognise shaded regions from the geography itself and use their standard English names (country, state or province), even when labels are masked; region names are not sensitive.
 table: "columns":[{"name":string,"kind":"text"|"org"|"person"|"id"|"category"|"date"|"number"|"currency"|"percent"|"verbatim","members":[string],"scaleHint":number (optional, a plausible typical value for that column, e.g. 4.5 for a 5-point rating, 50 for a price per seat)}],"rowCount":int,"sorted":bool. Put the column that labels each row first, as kind "category" with its members in row order.
 Customer comments (verbatims, quotes, reviews, free-text feedback), whether in a table or a list with a name line above each: make a table with one row per comment and a column of kind "verbatim" holding "values":[string], the readable wording of each comment in order, copied word for word. Write […] wherever a grey box covers words inside a comment; never fill them in. If a comment is entirely covered, use an empty string. Give the commenter and company columns kinds "person" and "org", and any score badge kind "number".
 Any number column in a table may add "shape":[0-100 per row]: the relative size from a visible in-cell bar, or from a badge colour when the number is covered (green = high, amber = middle, red = low). Omit it when there is no visual cue.
 placeholder: "originalType":string for anything else.
- Titles and labels: copy only text that is visible and not covered. If part of a title is covered, write [Client] for it. If axis or legend labels are covered, use "Item 1", "Item 2"…
- Shapes: estimate each mark's relative size from the visible geometry, largest = 100. For lines use relative height within the plot. Do not read numbers.
- Keep the visual order and approximate widths of the original. Use at most 20 visuals.`;

  // Sends only the approved, masked image to the provider the user chose (see llm.js).
  async function askModel(dataUrl, retryNote) {
    const text = await VSLLM.ask({ provider: S.provider, key: S.key, model: S.model, system: SYSTEM, prompt: retryNote || 'Return the JSON spec for this masked screenshot.', imageDataUrl: dataUrl });
    const spec = parseSpec(text);
    if (!spec) {
      if (retryNote) throw new Error(providerName() + ' returned a layout that could not be read. Try again, or pick a stronger model.');
      return askModel(dataUrl, 'Your previous answer was not valid JSON in the required shape. Return only the JSON object.');
    }
    return spec;
  }
  function parseSpec(text) {
    try {
      const s = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const o = JSON.parse(s);
      if (!o || !Array.isArray(o.rows) || !o.rows.length) return null;
      o.rows.forEach(r => { r.visuals = (r.visuals || []).filter(v => v && v.type); });
      return o;
    } catch (e) { return null; }
  }

  /* ---------------- Screen 3 ---------------- */
  const MODE_HELP = {
    shape: 'Keeps the layout, labels, rankings and trends of the original. Every value is generated and rescaled. Use for internal reviews.',
    structure: 'Keeps the layout and labels. Values and trends are random. Use when sharing with vendors or prospects.',
    generic: 'Keeps only the layout. Titles, labels and metric names are replaced too. Use for public demos.'
  };
  function showReplica() {
    show('s-replica');
    $('modehelp').textContent = MODE_HELP[S.mode];
    document.querySelectorAll('#modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    DSCReplica.render($('replica'), S.spec, { mode: S.mode, seed: S.seed, resetSelection: true });
    $('export-note').textContent = '';
  }
  $('modes').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.mode; showReplica(); };
  $('btn-regen').onclick = () => { S.seed = 1000 + Math.floor(Math.random() * 9000); DSCReplica.render($('replica'), S.spec, { mode: S.mode, seed: S.seed }); };
  $('btn-restart').onclick = () => { S.img = null; S.spec = null; S.masks = []; S.words = []; S.flags = []; S.payload = null; show('s-drop'); };
  $('btn-export').onclick = async () => {
    try {
      const mapNames = DSCReplica.mapsUsed(S.spec);
      const [echartsSrc, replicaSrc, ...mapSrcs] = await Promise.all([fetch('lib/echarts.min.js').then(r => r.text()), fetch('replica.js').then(r => r.text())]
        .concat(mapNames.map(n => fetch('maps/' + n + '.json').then(r => { if (!r.ok) throw new Error('map ' + n); return r.text(); }))));
      const maps = {}; mapNames.forEach((n, i) => { maps[n] = mapSrcs[i]; });
      const html = DSCReplica.exportHtml(S.spec, { mode: S.mode, seed: S.seed }, { echarts: echartsSrc, replica: replicaSrc, maps });
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dashboard-replica-synthetic.html';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      $('export-note').textContent = 'Exported. The file works offline and contains only generated values.';
    } catch (e) {
      $('export-note').textContent = 'Export needs the app to be served over http(s), not opened as a local file.';
      if (window.VSFeedback) VSFeedback.problem(e, 'Export');
    }
  };

  /* ---------------- key dialog ---------------- */
  $('btn-key').onclick = () => { kpDlg.fill(); $('dlg-key').showModal(); };
  $('key-save').onclick = () => applyKey(kpDlg.read(), true);
  $('key-clear').onclick = () => { S.key = null; remember(false); kpDlg.fill(); $('dlg-key').close(); };

  /* ---------------- extension snip + crop ---------------- */
  const cc = $('crop-canvas'); let cropImg = null, sel = null;
  function drawCrop() {
    const x = cc.getContext('2d'); x.drawImage(cropImg, 0, 0);
    if (sel) { x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 0, cc.width, cc.height); const r = norm(sel); x.drawImage(cropImg, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); x.strokeStyle = '#43b8a5'; x.lineWidth = 3; x.strokeRect(r.x, r.y, r.w, r.h); }
  }
  const norm = s => ({ x: Math.min(s.x0, s.x1), y: Math.min(s.y0, s.y1), w: Math.abs(s.x1 - s.x0), h: Math.abs(s.y1 - s.y0) });
  function cpt(e) { const r = cc.getBoundingClientRect(); return { x: (e.clientX - r.left) * cc.width / r.width, y: (e.clientY - r.top) * cc.height / r.height }; }
  let cdrag = false;
  cc.addEventListener('pointerdown', e => { const p = cpt(e); sel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; cdrag = true; cc.setPointerCapture(e.pointerId); });
  cc.addEventListener('pointermove', e => { if (!cdrag) return; const p = cpt(e); sel.x1 = p.x; sel.y1 = p.y; drawCrop(); });
  cc.addEventListener('pointerup', () => { cdrag = false; const r = norm(sel || { x0: 0, y0: 0, x1: 0, y1: 0 }); $('crop-use').disabled = !(r.w > 20 && r.h > 20); });
  $('crop-all').onclick = () => startReview(cropImg);
  $('crop-use').onclick = () => { const r = norm(sel); const c = document.createElement('canvas'); c.width = Math.round(r.w); c.height = Math.round(r.h); c.getContext('2d').drawImage(cropImg, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); startReview(c); };
  async function startCrop(dataUrl) {
    cropImg = await loadImage(dataUrl); sel = null;
    cc.width = cropImg.width; cc.height = cropImg.height; drawCrop(); $('crop-use').disabled = true; show('s-crop');
  }
  if (isExt && location.hash === '#snip') {
    chrome.runtime.sendMessage({ type: 'dsc-get-snip' }, resp => { if (resp && resp.dataUrl) startCrop(resp.dataUrl); });
  }

  // expose for tests
  window.__DSC = S;
  S.test = { classify, plausible, findComments, commentType, scrubQuote, buildMasks };
})();
