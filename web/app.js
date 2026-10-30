/* VaultSnip: app pipeline.
   capture -> local OCR -> mask everything except an allowlist -> independent re-scan gate
   -> human approval of the exact payload -> in-place replica: the original picture with every sensitive text replaced by
   synthetic text (written by Claude or OpenAI with your key, or on this device) -> export.
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
    fid: null, seed: 4127,  // fid: the in-place replica (canvas and patches)
    view: 'orig',
    provider: 'anthropic', key: null, model: 'claude-sonnet-5-5',
    sessionAllow: new Set(),
    fakeNumbers: true,   // numbers in the masked image become invented values of the same size (switchable)
    keepComments: false, comments: [], commentVocab: new Set(),
    ctx: { on: true, lines: null, scores: null, state: 'idle' },  // on-device name check (lib/vs-context.js, ml/)
    // on-device text-region detector: text the reader missed is masked. limit: the detector's input size (longest side);
    // minConf: how sure the reader must be of a kept word for it to account for its region
    unread: { on: true, regions: null, state: 'idle', limit: 1536, minConf: 60, reader: true }
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
quantity quantities qty subcategory subcategories store stores identifier detail details invoice invoices balance balances tax taxes shipping shipped freight description descriptions group groups subgroup parameter parameters fiscal employee employees line lines code codes number numbers
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
    'Added after check': '#b03c38',
    'Name in context': '#9a5b00',
    'Unread text': '#6b4fa0',
    'Kept by you': '#5b6470'
  };
  // The same categories in plain words, for the review pane
  const LABELS = {
    'Client name': 'Client names',
    'Number or money': 'Numbers and amounts',
    'Identifier': 'IDs and codes',
    'Email': 'Email addresses',
    'Name in comment': 'Names in customer comments',
    'Text not on allowlist': 'Words not on the safe list',
    'Added by you': 'Boxes you drew',
    'Added after check': 'Hidden after the check',
    'Name in context': 'Names spotted by on-device AI',
    'Unread text': 'Text the reader could not read',
    'Kept by you': 'Kept visible by you'
  };
  const label = t => (t === 'Number or money' && S.fakeNumbers ? 'Numbers (replaced with invented values)' : LABELS[t] || t);
  // a decision the user made, as opposed to one the rules made
  const byUser = m => m.userOff || m.src === 'manual' || m.src === 'check' || m.src === 'user';

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
    // period and rank labels BI tools use: rolling windows (L12M, R12M, T12M, L30D, P3M), quarter and fiscal ranges
    // (Q1-Q3, FY25-26, 2025-26) and rank markers (#1). They name a time window or a position, never a value.
    if (/^[lrtpn]\d{1,3}[dwmqy]$/i.test(clean) || /^q[1-4][-–]q[1-4]$/i.test(clean) || /^fy\d{2}[-–/]\d{2}$/i.test(clean)
      || /^(19|20)\d{2}[-–/]((19|20)?\d{2})$/.test(clean) || /^#\d{1,2}$/.test(clean)) return null;
    if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return 'Identifier';
    if (/[\d€$£¥₹%]/.test(clean)) return 'Number or money';
    if (clean.length <= 1) return null;
    if (ALLOW.has(low) || S.sessionAllow.has(low) || extraAllow().has(low)) return null;
    const parts = low.split(/[-/&]/).filter(Boolean);
    if (parts.length > 1 && parts.every(p => ALLOW.has(p) || extraAllow().has(p))) return null;
    return 'Text not on allowlist';
  }

  // A small number that labels a visual rather than reporting a value: a count after a ranking word ("Top 5 performers",
  // "Bottom 10", "Last 30 days", "Past 12 months") or a position after a sequence word ("Week 34", "Step 2", "Tier 1",
  // "Page 1 of 3"). Judged from the words beside it on the same line; a number standing as a value ("Revenue 5",
  // "Avg resolution 3 days") is still masked.
  const RANK_WORDS = new Set(['top', 'bottom', 'first', 'last', 'best', 'worst', 'leading', 'lowest', 'highest', 'next', 'past', 'previous', 'prior', 'rolling', 'trailing', 'latest', 'recent']);
  const SEQ_WORDS = new Set(['week', 'wk', 'step', 'phase', 'tier', 'level', 'stage', 'wave', 'page', 'round', 'sprint', 'version', 'release', 'grade', 'rank', 'no', 'number']);
  function countLabels(words) {
    const safe = new Set();
    const low = w => (w ? w.text.trim().replace(/^[^\w]+|[^\w%]+$/g, '').toLowerCase() : '');
    const small = t => { const m = /^(\d{1,3})%?$/.exec(t); return !!m && +m[1] >= 1 && +m[1] <= 500; };
    const beside = (w, dir) => {
      const cy = w.y + w.h / 2, reach = Math.max(w.h, 8) * 3;
      let best = null, bd = Infinity;
      for (const v of words) {
        if (v === w || Math.abs(v.y + v.h / 2 - cy) > Math.max(v.h, w.h) * 0.6) continue;
        if (Math.min(v.x + v.w, w.x + w.w) - Math.max(v.x, w.x) > Math.min(v.w, w.w) * 0.3) continue;   // another reading of the same spot
        const gap = dir < 0 ? w.x - (v.x + v.w) : v.x - (w.x + w.w);
        if (gap >= -2 && gap <= reach && gap < bd) { bd = gap; best = v; }
      }
      return best;
    };
    for (const w of words) {
      const t = low(w);
      if (/^(top|bottom)[-_]?\d{1,3}%?$/.test(t)) { safe.add(w); continue; }      // "Top-5", "Top10"
      if (!small(t)) continue;
      const prev = beside(w, -1), p = low(prev);
      if (RANK_WORDS.has(p) || SEQ_WORDS.has(p)) { safe.add(w); continue; }
      // "Page 1 of 3": the total after "of" belongs to the same label
      if (p === 'of') { const pp = beside(prev, -1); if (pp && safe.has(pp)) safe.add(w); }
    }
    return safe;
  }

  /* ---------------- OCR (local, Tesseract in WASM) ---------------- */
  let workerP = null;
  function worker() {
    if (!workerP) {
      workerP = Tesseract.createWorker('eng', 1, {
        workerPath: 'lib/worker.min.js', corePath: 'lib/core', langPath: (window.VAULTSNIP_CONFIG && window.VAULTSNIP_CONFIG.langPath) || 'lang',
        workerBlobURL: false, gzip: !(window.VAULTSNIP_CONFIG && window.VAULTSNIP_CONFIG.langGzip === false), cacheMethod: 'write',
        logger: m => { heartbeat(m); if (m.status && typeof m.progress === 'number') showProgress(m.status, m.progress); }
      }).then(async w => { await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' }); return w; })
        .catch(e => { workerP = null; throw e; });   // a failed start (e.g. the language file did not load) is retried next time
    }
    return workerP;
  }
  // One progress figure for a whole job: every reading pass, and for a new screenshot the check that follows. Each pass
  // counts by how much image it reads (scale squared), and the figure never goes back, so it climbs to 100% once
  // instead of restarting with every pass.
  const READ_PASSES = [[1.5, 'normal'], [1.5, 'inverted'], [3, 'contrast'], [3, 'ink']];
  const CHECK_SCALES = [2, 1.5, 3, 3, 3, 2];
  const weightOf = scales => scales.reduce((a, k) => a + k * k, 0);
  let job = null;
  function showProgress(status, p) {
    if (!job || !/recognizing/i.test(status)) { if (!/recognizing/i.test(status)) setStatus(humanStatus(status), true); return; }
    const pct = Math.min(99, Math.floor(((job.done + p * job.cur) / job.total) * 100));
    job.shown = Math.max(job.shown, pct);
    setStatus(`${job.label} ${job.shown}%`, true);
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
    const pixels = kind === 'ink' || kind === 'delta';
    const x = c.getContext('2d', { willReadFrequently: pixels });
    x.imageSmoothingQuality = 'high';
    x.filter = pixels ? 'none' : (FILTERS[kind] || FILTERS.normal);
    x.drawImage(src, 0, 0, c.width, c.height);
    if (pixels) inkOnly(x, c.width, c.height, kind);
    return c;
  }
  // "ink": keeps only text-coloured pixels and draws them black on white. Text is grey, black, white or a
  // muted green/red; bars, tracks, pills and map fills are saturated or pale. This is what makes a label
  // right beside a coloured bar, or a delta under a KPI, readable when the other passes miss it.
  // "delta": keeps only green and red text, the colours of KPI changes ("▲ 1.2 pts"), which on dark themes are
  // too dim and too colourful for every other pass.
  function inkOnly(x, w, h, kind) {
    const im = x.getImageData(0, 0, w, h), d = im.data;
    let sum = 0, n = 0;
    const magenta = (r, g, b) => r > 200 && b > 200 && g < 70;   // the re-scan's mask colour: background, never ink
    for (let i = 0; i < d.length; i += 4 * 97) { if (magenta(d[i], d[i + 1], d[i + 2])) continue; sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    const darkBg = n > 0 && sum / n < 110;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], lum = (r + g + b) / 3, chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (magenta(r, g, b)) { d[i] = d[i + 1] = d[i + 2] = 255; continue; }
      // on dark backgrounds text is bright in at least one channel (white, or a green/red delta)
      const ink = kind === 'delta' ? ((g > r + 35 && g > b + 15 && g > 80) || (r > g + 50 && r > b + 40 && r > 110))
        : darkBg ? (Math.max(r, g, b) > 120 && chroma < 150) : (lum < 140 && chroma < 130);
      d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
    }
    x.putImageData(im, 0, 0);
  }
  // One reader, one pass at a time: a pass changes the reader's settings ("block" mode), so two callers must not interleave.
  let ocrQueue = Promise.resolve();
  function ocr(src, scale, kind) {
    const run = ocrQueue.then(() => ocrPass(src, scale, kind));
    ocrQueue = run.catch(() => {});
    return run;
  }
  // Watchdog: the reader reports its progress all the time it works. On a busy machine it can occasionally get stuck,
  // which used to leave the progress figure frozen for good: sometimes silent, sometimes repeating the same figure.
  // When its progress has not moved for STALL_MS, or one pass has run longer than PASS_MAX_MS (a pass normally takes
  // seconds), the stuck reader is ended and the pass runs once more with a fresh one; a second stall is reported.
  const STALL_MS = 30000, PASS_MAX_MS = 120000;
  let lastBeat = 0, lastProgress = '';
  function heartbeat(m) {
    const at = m.status + ':' + m.progress;   // only progress that moves counts
    if (at !== lastProgress) { lastProgress = at; lastBeat = Date.now(); }
  }
  class ReaderStalled extends Error {}
  function watched(promise) {
    const start = lastBeat = Date.now();
    lastProgress = '';
    let timer;
    const still = S.test && S.test.stallMs || STALL_MS, most = S.test && S.test.passMaxMs || PASS_MAX_MS;
    const stalled = new Promise((_, reject) => {
      timer = setInterval(() => { const now = Date.now(); if (now - lastBeat > still || now - start > most) reject(new ReaderStalled('reader stalled')); }, 500);
    });
    return Promise.race([promise, stalled]).finally(() => clearInterval(timer));
  }
  async function recognize(canvas, kind) {
    for (let attempt = 0; ; attempt++) {
      const w = await worker();
      if (kind === 'block') await w.setParameters({ tessedit_pageseg_mode: '6' });
      try {
        // tests can make the next readings hang, to prove the watchdog recovers
        // (silent, or repeating the same progress figure for a while)
        const spin = () => { const t = setInterval(() => heartbeat({ status: 'recognizing text', progress: 0.06 }), 200); setTimeout(() => clearInterval(t), 10000); };
        const run = S.test && S.test.stalls > 0 ? (S.test.stalls--, new Promise(() => {}))
          : S.test && S.test.spins > 0 ? (S.test.spins--, spin(), new Promise(() => {}))
          : w.recognize(canvas, {}, { tsv: true, text: false, blocks: false, hocr: false });
        run.catch(() => {});   // an abandoned reading may still fail once its reader is ended
        return (await watched(run)).data;
      } catch (e) {
        if (!(e instanceof ReaderStalled)) throw e;
        console.warn('The on-device reader stopped responding; restarting it.');
        workerP = null;
        w.terminate().catch(() => {});
        if (attempt >= 1) throw new Error('it stopped responding twice. Please try again; closing other tabs can help.');
        continue;
      } finally {
        if (kind === 'block' && workerP) await (await workerP).setParameters({ tessedit_pageseg_mode: '11' }).catch(() => {});
      }
    }
  }
  async function ocrPass(src, scale, kind) {
    kind = kind === true ? 'inverted' : (kind || 'normal');
    const invert = kind === 'inverted';
    const data = await recognize(prep(src, scale, kind), kind);
    const out = [];
    (data.tsv || '').split('\n').forEach(line => {
      const c = line.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const text = c.slice(11).join('\t').trim(); const conf = parseFloat(c[10]);
      if (!text || conf < (/\d/.test(text) ? 12 : 30)) return;   // digits are the costliest leak: keep unsure ones
      out.push({ text, conf, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale, line: `${c[2]}-${c[3]}-${c[4]}`, inv: invert, pass: kind });
    });
    return out;
  }
  // Several passes, merged: a word found by a later pass is kept only if no earlier pass found it.
  async function readAll(src, passes, label) {
    let all = [];
    const mine = !job;
    if (mine) job = { total: weightOf(passes.map(p => p[0])), done: 0, cur: 0, shown: 0 };
    const j = job;   // this run's own figure, even if a newer screenshot starts another
    j.label = label || 'Reading text on this device…';
    try {
    for (const [scale, kind, own] of passes) {
      j.cur = scale * scale;
      const got = await ocr(own || src, scale, kind);
      j.done += j.cur; j.cur = 0;
      // a reading with digits is never hidden by an earlier digit-free reading of the same spot ("~" vs "1.2")
      all = all.concat(got.filter(w => { const hit = all.filter(v => overlap(v, w) > 0.3); return !hit.length || (/\d/.test(w.text) && !hit.some(v => /\d/.test(v.text))); }));
    }
    } finally { if (mine && job === j) job = null; }
    return plausible(all);
  }
  // C: the reader sometimes sees chart graphics as giant "words" (10-25x taller than real text, low confidence).
  // Masking those would hide whole charts, so they are dropped. Real large text (KPI numbers, titles) is kept:
  // it contains digits, or is read with high confidence at a sensible size.
  function plausible(words) {
    const hs = words.map(w => w.h).sort((a, b) => a - b);
    const med = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
    return words.filter(w => {
      if (/^[1Il|!\[\]{}()]{3,}$/.test(w.text.replace(/\s/g, ''))) return false;     // bars and gridlines read as "1111"
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
  // The extra passes sometimes read part of a clear word as a stray number ("16" over "shipments").
  // Such a reading is a ghost when it sits on top of a confidently read word.
  const alphaSure = w => w.conf >= 85 && !/\d/.test(w.text) && (w.text.match(/\p{L}/gu) || []).length >= 1;
  const ghostOf = (w, words) => /\d/.test(w.text) && (w.text.match(/\p{L}/gu) || []).length < 3 && words.some(v => v !== w && alphaSure(v) && overlap(v, w) > 0.3);
  function findComments(words) {
    words.forEach(w => { delete w.cmStart; delete w.inCm; delete w.ghost; });
    const ghosts = words.filter(w => ghostOf(w, words));
    const out = []; let blocks = 0;
    textLines(words.filter(w => !ghosts.includes(w))).forEach(l => {
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
    // a ghost on comment wording that is kept is not a number to mask
    ghosts.forEach(w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; if (out.some(l => cx >= l.left - 4 && cx <= l.right + 4 && cy >= l.top - 4 && cy <= l.bottom + 4)) { w.inCm = true; w.ghost = true; } });
    return out;
  }
  function commentType(w) {
    if (w.ghost) return null;
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

  /* ---------------- masks ---------------- */
  function buildMasks(words) {
    const keep = S.keepComments;
    S.commentVocab = new Set();
    // kept comment words read with good confidence: the check does not second-guess re-readings of these pixels
    S.keptBoxes = keep ? words.filter(w => w.inCm && !w.ghost && w.conf >= 80 && !commentType(w)) : [];
    const labels = countLabels(words);
    const flagged = words.map(w => {
      // (a scrap of a slanted label that the second look read as safe words is not masked)
      const type = w.lookSafe ? null : keep && w.inCm ? commentType(w) : labels.has(w) ? null : classify(w.text);
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
    const out = groups.map(g => { const p = Math.max(3, g.h * 0.18); return Object.assign(g, { x: g.x - p, y: g.y - p, w: g.w + 2 * p, h: g.h + 2 * p }); });
    return out.concat(columnFill(out));
  }
  // Table columns: when three or more number masks stack in one column, the whole column is masked, so
  // a single digit the reader skipped between them ("5", "8" story points) cannot stay readable.
  function columnFill(masks) {
    const nums = masks.filter(m => m.type === 'Number or money' && m.w < 260);
    const used = new Set(), fills = [];
    nums.forEach(a => {
      if (used.has(a)) return;
      const col = nums.filter(b => {
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        return ix > 0.5 * Math.min(a.w, b.w) && Math.abs(b.h - a.h) < Math.max(a.h, b.h) * 0.35;
      }).sort((p, q) => p.y - q.y);
      if (col.length < 3) return;
      // only table rows: split into runs with a steady row step (about 1.2-3 text heights apart);
      // a gap of more than two rows ends the run, so separate sections are never joined
      const rowH = Math.min(...col.map(m => m.h));
      let run = [col[0]];
      const flush = () => {
        if (run.length >= 3) {
          const x1 = Math.min(...run.map(m => m.x)), x2 = Math.max(...run.map(m => m.x + m.w));
          const widest = Math.max(...run.map(m => m.w));
          if (x2 - x1 <= widest * 1.4 + rowH) {      // narrow cells: allow for padding differences
            run.forEach(m => used.add(m));
            const y1 = run[0].y, y2 = run[run.length - 1].y + run[run.length - 1].h;
            fills.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, type: 'Number or money', text: '(table column)', on: true, src: 'auto' });
          }
        }
      };
      let step = 0;
      for (let i = 1; i < col.length; i++) {
        const gap = col[i].y - col[i - 1].y;
        if (gap <= 0) continue;
        // the row step is the smallest gap seen; a gap may be up to ~2 rows (one skipped number) either way
        const ok = step ? (gap <= step * 2.2 && gap * 2.2 >= step) : gap <= rowH * 4;
        if (ok) { if (!step || gap < step) step = gap; run.push(col[i]); } else { flush(); run = [col[i]]; step = 0; }
      }
      flush();
    });
    return fills;
  }
  // fill: the colour of the masks. The re-scan's "ink" pass uses magenta, which it treats as background,
  // so a label right beside a mask is not swallowed into one dark blob with it.
  // Without a fill colour, numbers are replaced with invented values of the same size (when "fake numbers" is on) and
  // every other mask stays a grey box. An image with invented numbers gets a footer strip that says so; opts.tag: false
  // leaves it out (the review view says it in the page; the layout builder must not read it as content).
  function maskedCanvas(scale, fill, opts) {
    scale = scale || 1;
    const on = S.masks.filter(m => m.on);
    const fakes = !fill && S.fakeNumbers && on.some(isNumberMask), strip = fakes && !(opts && opts.tag === false) ? footerHeight(scale) : 0;
    const c = document.createElement('canvas');
    c.width = Math.round(S.img.width * scale); c.height = Math.round(S.img.height * scale) + strip;
    const x = c.getContext('2d');
    x.drawImage(S.img, 0, 0, c.width, c.height - strip);
    if (!fakes) {
      x.fillStyle = fill || '#787c82';
      on.forEach(m => x.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale));
      return c;
    }
    paintFakes(x, on, scale);
    if (strip) drawFooter(x, c.width, c.height - strip, strip);
    return c;
  }
  const footerHeight = scale => Math.round(Math.max(26, S.img.width * scale / 55));
  // Below the picture, so it hides nothing: a forwarded image must not pass for the real report.
  function drawFooter(x, w, y, h) {
    x.fillStyle = '#20262e'; x.fillRect(0, y, w, h);
    const fs = Math.round(h * 0.42);
    x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lead = 'Numbers in this image are made up';
    x.fillText(lead, fs, y + h / 2);
    x.font = `400 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    x.fillStyle = '#c9d1da';
    x.fillText('  ·  same scale as the real ones, never the real values  ·  names and labels are masked', fs + x.measureText(lead).width, y + h / 2);
  }

  /* ---------------- numbers replaced with invented values ---------------- */
  // A number in the masked image becomes a different, invented one of the same magnitude: the real value scaled by a
  // random factor that always changes it (0.55-0.85 or 1.18-1.8), kept to the same number of digits before the decimal
  // point, the same decimals, sign, currency, unit and separators ("$4.2M" → "$5.6M", "62.4%" → "41.9%", "21 °C" →
  // "29 °C"). It never equals the real value. Numbers stacked as an axis share one factor, so the scale still reads in
  // order. Years stay; dates become another valid date in the same year.
  const isNumberMask = m => m.type === 'Number or money' || (m.type === 'Added after check' && /\d/.test(m.text || ''));
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const randomFactor = r => (r() < 0.5 ? 0.55 + r() * 0.3 : 1.18 + r() * 0.62);
  // exact: the value to show (an axis tick rebuilt on an even scale); otherwise the real value is scaled at random
  function fakeValue(text, seed, exact, depth = 0) {
    const r = seeded(seed), digit = (lo = 0) => String(lo + Math.floor(r() * (10 - lo)));
    const date = /^(\d{1,2})([-/.])([A-Za-z]{3,}|\d{1,2})\2(\d{2,4})$/.exec(text);
    if (date) {
      const d = 1 + Math.floor(r() * 28), mon = /\d/.test(date[3]) ? String(1 + Math.floor(r() * 12)).padStart(date[3].length, '0') : date[3];
      const out = `${String(d).padStart(date[1].length, '0')}${date[2]}${mon}${date[2]}${date[4]}`;
      return out === text && depth < 8 ? fakeValue(text, seed + 1, undefined, depth + 1) : out;
    }
    let first = true;
    let out = text.replace(/\d[\d,]*(?:\.\d+)?/g, (run, offset) => {
      if (/^(19|20)\d{2}$/.test(run)) return run;                                   // a year is a label, not a value
      if (/\/\s*$/.test(text.slice(0, offset))) return run;                          // the scale of a rating ("/ 5") stays
      const outOf = /^\s*\/\s*(\d+(?:\.\d+)?)/.exec(text.slice(offset + run.length)), cap = outOf ? parseFloat(outOf[1]) : Infinity;
      const [intPart, dec = ''] = run.split('.'), plain = intPart.replace(/,/g, ''), v = parseFloat(plain + (dec ? '.' + dec : ''));
      const afterColon = text[offset - 1] === ':', pct = text.slice(offset + run.length).trim().startsWith('%');
      let n;
      if (afterColon) n = String(Math.floor(r() * 60)).padStart(plain.length, '0');  // minutes or seconds stay valid
      else if (pct && v >= 100) n = String(90 + Math.floor(r() * 10)) + (dec ? '.' + Array.from({ length: dec.length }, () => digit()).join('') : '');   // 100% becomes a high percentage
      else {
        // the real value scaled, kept to the same number of digits (a percentage stays at or under 100); a whole number
        // that would round back to itself (1 × 1.3) is not a change
        const fit = x => { const s = Math.round(x).toString(); return x > 0 && s.length === plain.length && (!pct || x <= 100) && x <= cap && (dec || Math.round(x) !== v); };
        let f = randomFactor(r), nv = exact != null && first ? exact : v * f;
        first = false;
        if (!fit(nv)) nv = v * (f > 1 ? 0.55 + r() * 0.3 : 1.18 + r() * 0.62);
        if (v === 0 || !fit(nv)) nv = parseFloat(plain.length === 1 ? digit(1) : digit(1) + Array.from({ length: plain.length - 1 }, () => digit()).join('')) + (dec ? r() : 0);
        if (nv > cap) nv = cap * (0.5 + 0.45 * r());                                  // a score stays within its scale
        n = dec ? nv.toFixed(dec.length) : String(Math.round(nv));
        const [ni, nd] = n.split('.');
        n = ni.padStart(plain.length, '0').slice(-Math.max(plain.length, ni.length)) + (nd ? '.' + nd : '');
      }
      const [ni2, nd2] = n.split('.');
      const grouped = intPart.includes(',') ? ni2.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ni2;
      return grouped + (nd2 !== undefined ? '.' + nd2 : '');
    });
    // try again only when there is a number to change (a lone year stays as it is), and never endlessly
    if (out === text && depth < 8 && (text.match(/\d[\d,]*(?:\.\d+)?/g) || []).some(run => !/^(19|20)\d{2}$/.test(run))) out = fakeValue(text, seed + 7, undefined, depth + 1);
    return out;
  }
  // Numbers stacked as an axis (three or more in a column or a row, evenly spaced) share one factor, so the invented scale
  // stays in order and evenly stepped.
  function axisFactors(nums) {
    const out = new Map(), val = m => parseFloat((m.text.match(/\d[\d,]*(?:\.\d+)?/) || ['NaN'])[0].replace(/,/g, ''));
    const lines = (key, along) => {
      const groups = [];
      nums.filter(m => !out.has(m) && Number.isFinite(val(m))).forEach(m => {
        // ticks of one axis are alike in size: a big KPI value above a chart is not one of them
        const g = groups.find(g => Math.abs(key(g[0]) - key(m)) < Math.max(4, Math.min(g[0].w, m.w) * 0.6) && Math.abs(g[0].h - m.h) < Math.max(g[0].h, m.h) * 0.4);
        if (g) g.push(m); else groups.push([m]);
      });
      groups.filter(g => g.length >= 3).forEach(g => {
        g.sort((a, b) => along(a) - along(b));
        const gaps = g.slice(1).map((m, i) => along(m) - along(g[i])), mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const even = mean > 0 && gaps.every(d => Math.abs(d - mean) < mean * 0.25);
        // an axis steps its values evenly too (8, 7, 6, 5…); a table column of real figures does not, and sharing a factor
        // there would keep the true ratios between its rows
        const vals = g.map(val), steps = vals.slice(1).map((v, i) => v - vals[i]), ms = steps.reduce((a, b) => a + b, 0) / steps.length;
        const stepped = ms !== 0 && steps.every(d => Math.abs(d - ms) <= Math.abs(ms) * 0.1);
        if (!even || !stepped) return;
        // one factor that keeps every tick to its number of digits (else each would fall back to its own and break the scale)
        // rebuilt as an even scale: a new start and a new step, at the labels' precision, every tick keeping its digits
        const r = seeded(hash(g.map(m => m.text).join('|'))), digits = v => String(Math.floor(Math.abs(v))).length;
        const decs = Math.max(...g.map(m => ((m.text.match(/\d[\d,]*(?:\.(\d+))?/) || [])[1] || '').length)), unit = Math.pow(10, -decs), q = v => Math.round(v / unit) * unit;
        for (let k = 0; k < 24; k++) {
          const f = randomFactor(r), start = q(vals[0] * f), step = q(ms * f) || Math.sign(ms) * unit;
          const next = vals.map((_, i) => q(start + i * step));
          if (next.every((v, i) => v > 0 && digits(v) === digits(vals[i]) && v !== vals[i])) { g.forEach((m, i) => out.set(m, next[i])); break; }
        }
      });
    };
    lines(m => m.x + m.w / 2, m => m.y);   // y-axis ticks: one column
    lines(m => m.y + m.h / 2, m => m.x);   // x-axis ticks: one row
    return out;
  }
  // Paints number masks with the background colour and an invented value in the same style; other masks stay grey. A
  // column-fill block (digits the reader skipped) gets the background colour, then its numbers on top.
  function paintFakes(x, masks, scale) {
    const src = document.createElement('canvas'); src.width = S.img.width; src.height = S.img.height;
    const sx = src.getContext('2d', { willReadFrequently: true }); sx.drawImage(S.img, 0, 0);
    const colours = m => {
      const W = S.img.width, H = S.img.height, x0 = Math.max(0, Math.floor(m.x)), y0 = Math.max(0, Math.floor(m.y)), x1 = Math.min(W, Math.ceil(m.x + m.w)), y1 = Math.min(H, Math.ceil(m.y + m.h));
      if (x1 - x0 < 2 || y1 - y0 < 2) return { bg: '#ffffff', ink: '#333333', bold: false };
      const d = sx.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0, h = y1 - y0;
      const edge = []; for (let i = 0; i < w; i++) edge.push(i, i + (h - 1) * w); for (let j = 0; j < h; j++) edge.push(j * w, j * w + w - 1);
      const bgC = [0, 1, 2].map(k => { const v = edge.map(p => d[p * 4 + k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; });
      let best = 0, ink = [51, 51, 51], dark = 0;
      for (let p = 0; p < w * h; p++) { const dist = Math.abs(d[p * 4] - bgC[0]) + Math.abs(d[p * 4 + 1] - bgC[1]) + Math.abs(d[p * 4 + 2] - bgC[2]); if (dist > 90) dark++; if (dist > best) { best = dist; ink = [d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]; } }
      if (best < 60) ink = (bgC[0] + bgC[1] + bgC[2]) / 3 > 128 ? [40, 40, 40] : [235, 235, 235];
      return { bg: `rgb(${bgC.join(',')})`, ink: `rgb(${ink.join(',')})`, bold: dark / (w * h) > 0.22 };
    };
    const nums = masks.filter(isNumberMask), blocks = masks.filter(m => m.text === '(table column)'), axes = axisFactors(nums.filter(m => m.text && m.text !== '(table column)'));
    masks.forEach(m => {
      x.fillStyle = isNumberMask(m) || blocks.includes(m) ? colours(m).bg : '#787c82';
      x.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale);
    });
    nums.forEach(m => {
      if (!m.text || m.text === '(table column)') return;
      const c = colours(m), value = fakeValue(m.text, hash(m.text + '|' + Math.round(m.x) + '|' + Math.round(m.y)), axes.get(m));
      const inner = (m.h / 1.36) * scale;                                               // masks are padded by ~18% on each side
      let size = Math.max(7, inner / 0.72);
      x.save(); x.beginPath(); x.rect(m.x * scale, m.y * scale, m.w * scale, m.h * scale); x.clip();
      x.font = `${c.bold ? 700 : 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const fit = (m.w * scale - 4) / Math.max(1, x.measureText(value).width);
      if (fit < 1) { size *= fit; x.font = `${c.bold ? 700 : 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
      x.fillStyle = c.ink; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(value, (m.x + m.w / 2) * scale, (m.y + m.h / 2) * scale + size * 0.04);
      x.restore();
    });
  }

  /* ---------------- on-device name check (contextual AI) ---------------- */
  // A second opinion on words the rules keep: a safe word used as a name ("May Chen", "Delta Airlines").
  // A small PII model runs in a Web Worker (ml/ml-worker.js) on this device and can only ADD masks.
  // Words the user marked safe or listed as safe are never touched. If it cannot run, the rules' masks stand.
  let ctxClient = null;
  function ctxWorkerUrl() {
    const cfg = window.VAULTSNIP_CONFIG || {};
    const q = new URLSearchParams({ models: new URL(cfg.mlModels || 'models/', location.href).href, gz: cfg.mlGzip === false ? '0' : '1' });
    return new URL('ml/ml-worker.js?' + q, location.href);
  }
  async function scoreContext() {
    S.ctx.lines = null; S.ctx.scores = null;
    if (!S.ctx.on || !window.VSContext || !S.words.length) { S.ctx.state = S.ctx.on ? 'idle' : 'off'; return renderCtxNote(); }
    S.ctx.state = 'running'; renderCtxNote();
    const words = S.words;
    try {
      ctxClient = ctxClient || new VSContext.ContextClassifier(VSContext.moduleWorker(ctxWorkerUrl()), { timeoutMs: 60000 });
      const lines = textLines(words.filter(w => !w.ghost)).map(l => l.words);
      const scores = await ctxClient.score(lines.map(l => l.map(w => w.text)));
      if (S.words !== words) return;   // another screenshot started meanwhile: these scores belong to the old one
      S.ctx.scores = scores; S.ctx.lines = lines; S.ctx.state = 'ready';
    } catch (e) {
      if (S.words !== words) return;
      console.warn('On-device name check unavailable:', e);
      S.ctx.state = 'error';
    }
    renderCtxNote();
  }
  function contextMasks() {
    if (!S.ctx.on || !S.ctx.scores || !window.VSContext) return [];
    // the same keys as "Safe to keep" stores (sessionAllow) and the safe-words list (extraAllow)
    const approved = t => { const lc = t.trim().replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, '').toLowerCase(); return S.sessionAllow.has(lc.replace(/[^\w-]/g, '')) || extraAllow().has(lc); };
    const out = [];
    S.ctx.lines.forEach((line, li) => {
      const words = line.map(w => ({ text: w.text, kept: !(S.keepComments && w.inCm ? commentType(w) : classify(w.text)) && !approved(w.text) }));
      VSContext.contextualHits(words, S.ctx.scores[li]).forEach(i => {
        const w = line[i], p = Math.max(3, w.h * 0.18);
        out.push({ x: w.x - p, y: w.y - p, w: w.w + 2 * p, h: w.h + 2 * p, type: VSContext.CONTEXT_TYPE, text: w.text, on: true, src: 'auto' });
      });
    });
    return out;
  }
  /* ---------------- unread text (on-device text-region detector) ---------------- */
  // The reader can miss words (tiny, rotated, coloured, low contrast), and a missed word is never classified, so it is
  // never masked. A small detector model (PP-OCRv5, in the same worker) finds every patch of text without reading it;
  // any part not covered by a mask or by a word read confidently and kept is masked as unread text. It only adds masks.
  async function detectRegions() {
    S.unread.regions = null;
    if (!S.unread.on || !window.VSContext || !S.img) { S.unread.state = S.unread.on ? 'idle' : 'off'; return; }
    S.unread.state = 'running';
    const img = S.img;
    try {
      ctxClient = ctxClient || new VSContext.ContextClassifier(VSContext.moduleWorker(ctxWorkerUrl()), { timeoutMs: 60000 });
      const size = VSContext.detectorSize(img.width, img.height, S.unread.limit);
      const c = document.createElement('canvas'); c.width = size.width; c.height = size.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height);
      const regions = await ctxClient.detect({ width: d.width, height: d.height, data: d.data });
      if (S.img !== img) return;   // another screenshot started meanwhile
      const kx = img.width / size.width, ky = img.height / size.height;
      const scale = b => ({ x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky });
      S.unread.regions = regions.map(r => Object.assign(scale(r), r.core ? { core: scale(r.core) } : {}, r.len ? { angle: r.angle, len: r.len * kx, thick: r.thick * kx } : {}));
      await secondLook(img, S.unread.regions, buildMasks(S.words).concat(contextMasks()));
      if (S.img !== img) return;
      S.unread.state = 'ready';
    } catch (e) {
      if (S.img !== img) return;
      console.warn('On-device text-region check unavailable:', e);
      S.unread.state = 'error';
    }
  }
  // A second look at every region nothing accounts for: slanted labels and vertical axis titles the reader cannot read
  // upright, and faint or tiny text it read with too little confidence. Each is cut out (straightened if slanted), read
  // again at a larger scale, as it is and with the contrast raised, and stays readable only if every word is read
  // confidently and is safe by the same rules as the rest of the page. Anything else is masked as unread text.
  const SECOND_LOOK_CONF = 70, SECOND_LOOK_MAX = 120;
  function unreadCover(base) {
    const on = base.filter(m => m.on);
    const inside = w => on.some(m => w.x + w.w / 2 >= m.x && w.x + w.w / 2 <= m.x + m.w && w.y + w.h / 2 >= m.y && w.y + w.h / 2 <= m.y + m.h);
    // words that account for their spot: read confidently and left readable by the rules; and parts of a region that
    // hold flat marks only (a bar beside its label), found by the second look
    return on.concat(S.words.filter(w => !w.ghost && w.conf >= S.unread.minConf && !inside(w)),
      (S.unread.regions || []).flatMap(r => r.flat || []));
  }
  // One straightened line read by the second-look reader (PP-OCRv5, in the ML worker), as words with the page
  // reader's confidence scale; null when it cannot run, so the page reader takes over.
  async function readLine(c) {
    if (!S.unread.reader || !ctxClient) return null;
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const r = await ctxClient.read({ width: d.width, height: d.height, data: d.data });
      return r.text.split(/\s+/).filter(Boolean).map(text => ({ text, conf: r.conf * 100 }));
    } catch (e) {
      console.warn('Second-look reader unavailable:', e);
      return null;
    }
  }
  // The reader sometimes takes a chart's bar or a piece of a pie for a word, and masking it hides the chart. A "word"
  // whose box is one solid rectangle of colour with no hole in it (VSContext.isBar), or thick regions of one colour each
  // such as slices (VSContext.isShapes), is not text and is dropped; text on a chip or in a slice still fails both.
  function notMarks(img, words) {
    if (!window.VSContext || !VSContext.isBar) return words;
    const hs = words.map(w => w.h).sort((a, b) => a - b), textH = hs.length ? hs[hs.length >> 1] : 12;
    return words.filter(w => {
      if (Math.max(w.w, w.h) < textH) return true;
      const px = pixelsOf(img, w);
      return !(VSContext.isBar(px, textH) || (VSContext.isShapes && VSContext.isShapes(px, textH)));
    });
  }
  // the RGBA pixels of a box of the image, in whole pixels
  function pixelsOf(img, b) {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const w = Math.max(1, Math.min(img.width, Math.ceil(b.x + b.w)) - x0), h = Math.max(1, Math.min(img.height, Math.ceil(b.y + b.h)) - y0);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  }
  // the commonest colour on the edge of a region's box: the background its text sits on
  function backgroundAt(img, r) {
    const d = pixelsOf(img, r), w = d.width, h = d.height, count = new Map();
    const add = i => { const k = d.data[i * 4] >> 4 << 8 | d.data[i * 4 + 1] >> 4 << 4 | d.data[i * 4 + 2] >> 4; count.set(k, (count.get(k) || 0) + 1); };
    for (let i = 0; i < w; i++) { add(i); add((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { add(j * w); add(j * w + w - 1); }
    const k = [...count].sort((a, b) => b[1] - a[1])[0][0];
    return `rgb(${(k >> 8 & 15) * 16 + 8},${(k >> 4 & 15) * 16 + 8},${(k & 15) * 16 + 8})`;
  }
  async function secondLook(img, regions, base) {
    const cover = unreadCover(base);
    // A slanted label the page reader read as a scrap of low-confidence letters ("Fe", "AY") is masked as unknown text,
    // which hides it from the second look. Such a region gets the second look too: if it reads confidently as safe
    // words, those scraps are dropped from the masks; otherwise nothing changes. Never for a reading with a digit, or one
    // the rules flag as anything but unknown text (numbers, emails, IDs and names stay masked whatever the second look reads).
    const scrap = w => !w.ghost && w.conf < S.unread.minConf && !/\d/.test(w.text) && classify(w.text) === 'Text not on allowlist';
    const scrapsIn = r => {
      const k = r.core || r;
      const inside = S.words.filter(w => !w.ghost && w.x + w.w / 2 >= k.x && w.x + w.w / 2 <= k.x + k.w && w.y + w.h / 2 >= k.y && w.y + w.h / 2 <= k.y + k.h);
      return inside.length && inside.every(scrap) ? inside : null;
    };
    const slantedRegion = r => r.len && Math.abs(r.angle) > 10 && Math.abs(r.angle) < 170 && r.len >= 1.5 * r.thick;
    regions.forEach(r => { r.scraps = slantedRegion(r) ? scrapsIn(r) : null; });
    const todo = regions.filter(r => r.scraps || VSContext.unreadParts([r], cover).length).slice(0, SECOND_LOOK_MAX);
    // the page's usual text height: a region no bigger than one character of it holds at most one character
    const hs = S.words.filter(w => !w.ghost).map(w => w.h).sort((a, b) => a - b), textH = hs.length ? hs[hs.length >> 1] : 12;
    for (const r of todo) {
      const slanted = r.len && Math.abs(r.angle) > 10 && Math.abs(r.angle) < 170 && r.len >= 1.5 * r.thick;
      const k = r.core || r, glyphSized = k.w <= 1.2 * textH && k.h <= 2 * textH;
      // a region far taller than a line of text is not one line: the detector merged labels and chart marks into one
      // blob. Masking it whole would hide charts, so only the words the second look reads there and cannot vouch for
      // are masked, where they are.
      const blob = !slanted && k.h > 3 * textH;
      // the detector joins a label and the bar beside it into one line: a part holding only flat marks (a bar, a
      // legend chip, a gridline) and no letter-like shape accounts for itself, so the chart stays visible
      if (!slanted && !blob) {
        const parts = VSContext.unreadParts([r], cover);
        r.flat = parts.filter(p => VSContext.flatMarksOnly(pixelsOf(img, p), textH));
        if (r.flat.length === parts.length) { r.safe = true; r.seen = 'flat marks'; continue; }
        cover.push(...r.flat);
      }
      let best = { words: [], conf: 0 }, sawCharacters = false;
      const unsafe = [];
      read: for (const kind of ['normal', 'contrast']) {
        for (const flip of slanted ? [0, 180] : [0]) {   // a slanted label may read upwards or downwards
          if (S.img !== img) return;
          const pad = 4, c = document.createElement('canvas'), x = c.getContext('2d');
          if (slanted) {
            // a margin in proportion to the text (a tight crop cut the first and last letters off a slanted label), on
            // the label's own background: a rotated crop's corners are otherwise transparent, which reads as black
            const sp = Math.max(pad, Math.round(r.thick * 0.35));
            c.width = Math.ceil(r.len + 2 * sp + r.thick * 0.5); c.height = Math.ceil(r.thick + 2 * sp);
            x.fillStyle = backgroundAt(img, r); x.fillRect(0, 0, c.width, c.height);
            x.translate(c.width / 2, c.height / 2); x.rotate(-(r.angle + flip) * Math.PI / 180);
            x.drawImage(img, -(r.x + r.w / 2), -(r.y + r.h / 2));
          } else {
            c.width = Math.ceil(r.w + 2 * pad); c.height = Math.ceil(r.h + 2 * pad);
            x.drawImage(img, r.x - pad, r.y - pad, c.width, c.height, 0, 0, c.width, c.height);
          }
          // the line reader first (trained on single lines: small, faint and slanted text), then the page reader
          let words = kind === 'normal' && !blob ? await readLine(c) : null;
          if (!words || !words.length) words = await ocrPass(c, 3, kind);
          if (words.some(w => /[\p{L}\p{N}]/u.test(w.text))) sawCharacters = true;
          if (blob) {   // every reading counts: a word unsafe in either is masked (positions in the image's pixels)
            words.filter(w => w.conf < SECOND_LOOK_CONF || classify(w.text)).forEach(w => unsafe.push({ x: w.x + r.x - pad, y: w.y + r.y - pad, w: w.w, h: w.h }));
            continue;
          }
          const conf = words.length ? Math.min(...words.map(w => w.conf)) : 0;
          if (conf > best.conf) best = { words, conf };
          if (best.conf >= SECOND_LOOK_CONF) break read;
        }
      }
      if (blob) { r.blob = true; r.unsafe = unsafe; r.seen = `blob, ${unsafe.length} unsafe`; continue; }
      r.seen = best.words.map(w => w.text + ':' + Math.round(w.conf)).join(' ');   // what the second look read (tests and the benchmark)
      // a slanted label read confidently as safe words: the page reader's scraps of it are not masked
      const readSafe = best.conf >= SECOND_LOOK_CONF && best.words.some(w => /\p{L}/u.test(w.text)) && best.words.every(w => !classify(w.text));
      if (r.scraps && readSafe) r.scraps.forEach(w => { w.lookSafe = true; });
      r.safe = (best.conf >= SECOND_LOOK_CONF && best.words.some(w => /\p{L}/u.test(w.text)) && best.words.every(w => !classify(w.text)))
        // a mark the size of one character in which no letter or digit can be found, however it is read: a line marker,
        // a tick, a bullet or a divider, not text
        || (glyphSized && !sawCharacters);
    }
  }
  function unreadMasks(base) {
    if (!S.unread.on || !S.unread.regions || !window.VSContext) return [];
    // No padding of its own: the detector's region already reaches past the letters, and a mask taller than its text
    // looks like a KPI's big number to the on-device layout builder. Whole pixels, outward: a box edge drawn between
    // pixels blends grey into the background, and the builder would take those pixels for chart marks.
    const blobs = S.unread.regions.filter(r => r.blob).flatMap(r => r.unsafe);
    return VSContext.unreadParts(S.unread.regions.filter(r => !r.safe && !r.blob), unreadCover(base)).concat(blobs).map(p => {
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
      return { x: x0, y: y0, w: Math.ceil(p.x + p.w) - x0, h: Math.ceil(p.y + p.h) - y0, type: VSContext.UNREAD_TYPE, text: '(unread text)', on: true, src: 'auto' };
    });
  }
  const allMasks = () => { const base = buildMasks(S.words).concat(contextMasks()); return base.concat(unreadMasks(base)); };
  function renderCtxNote() {
    const n = S.masks.filter(m => m.type === 'Name in context').length;
    $('ctx-note').textContent = !S.ctx.on ? 'Off. Safe words stay as listed; click any of them below to mask it.'
      : S.ctx.state === 'running' ? 'Looking for names among safe words on this device…'
      : S.ctx.state === 'error' ? 'The on-device name check could not run here, so only the rules above apply. Check the safe words below.'
      : S.ctx.state === 'ready' ? (n ? `Found ${n} safe word${n > 1 ? 's' : ''} used as a name (brown boxes). Untick any in the mask list if wrong.` : 'No safe word here looks like a name.')
      : 'Catches safe words used as names, such as "May Chen" or "Delta Airlines". Runs on this device; the 19 MB model downloads once. It only adds masks.';
  }

  /* ---------------- verification gate (independent re-scan) ---------------- */
  async function verify() {
    S.gate = 'running'; renderGate();
    setStatus('Checking the masked image again (six independent passes)…', true);
    // numbers masked after an earlier check (score badges, single digits) can complete a table column too
    const numeric = S.masks.filter(m => m.on && (m.type === 'Number or money' || (m.type === 'Added after check' && /\d/.test(m.text || ''))) && m.text !== '(table column)');
    const extra = columnFill(numeric.map(m => Object.assign({}, m, { type: 'Number or money' })))
      .filter(f => !S.masks.some(m => m.on && m.x <= f.x + 1 && m.y <= f.y + 1 && m.x + m.w >= f.x + f.w - 1 && m.y + m.h >= f.y + f.h - 1));
    if (extra.length) { S.masks.push(...extra); renderTypes(); draw(); }
    // the check reads solid boxes: they cover exactly the pixels the invented numbers cover
    const m2 = maskedCanvas(1, '#787c82'), img0 = S.img;
    const all = await readAll(m2, [[CHECK_SCALES[0], 'normal'], [CHECK_SCALES[1], 'inverted'], [CHECK_SCALES[2], 'contrast'], [CHECK_SCALES[3], 'block'], [CHECK_SCALES[4], 'ink', maskedCanvas(1, '#ff00ff')], [CHECK_SCALES[5], 'delta']], 'Checking the masked image on this device…');
    if (S.img !== img0) return;   // a newer screenshot replaced this one; its own check decides its gate
    const active = S.masks.filter(m => m.on);
    // spots the user looked at and chose to show (a mask they switched off, or a finding marked not sensitive)
    const shown = S.masks.filter(m => !m.on && m.userOff);
    const labels = countLabels(all);
    const flags = [];
    all.forEach(w => {
      if (w.conf < (/\d/.test(w.text) ? 20 : 45)) return;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      if (active.some(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h)) return;
      if (shown.some(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h)) return;
      if (labels.has(w)) return;
      const t = classify(w.text);
      if (!t) return;
      if (S.keepComments && inComment(w) && (S.keptBoxes || []).some(k => overlap(k, w) > 0.5)) return;   // a re-reading of kept comment wording
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
  // One click for the cautious answer: every finding the check left open is masked, numbers and unlisted words alike.
  // Nothing hidden is shown; each new box counts as your decision and can still be switched off.
  function hideUncertain() {
    const open = S.flags.filter(f => !f.resolved);
    open.forEach(f => { S.masks.push({ x: f.x, y: f.y, w: f.w, h: f.h, type: 'Added after check', text: f.text, on: true, src: 'check' }); f.resolved = true; });
    updateGate(); renderTypes(); draw();
    if (open.length) setStatus(`Hid ${open.length} uncertain item${open.length > 1 ? 's' : ''}. Check passed.`, false);
    return open.length;
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
      policy: ['pending', 'Policy changed', 'Click "Re-apply policy" so the new names and words take effect. The check then runs again.'],
      pass: ['pass', 'Pass', S.flags.length ? 'Every finding is resolved. You can preview what is sent.' : 'Nothing readable is left outside the masks.'],
      review: ['review', 'Review needed', 'Unlisted words are still readable. Mask them or mark them safe.'],
      blocked: ['blocked', 'Blocked', 'Numbers or IDs are still readable. Mask each one, or keep it if it is not sensitive.']
    }[S.gate];
    g.className = 'gate ' + map[0];
    renderSummary();
    g.innerHTML = `<b>${map[1]}</b><span>${map[2]}</span>`;
    $('btn-send').disabled = S.gate !== 'pass';
    $('btn-recheck').disabled = S.gate === 'running';
    const fl = $('flags');
    fl.innerHTML = '';
    const openFlags = S.flags.filter(f => !f.resolved);
    if (openFlags.length > 1) {
      const all = document.createElement('button'); all.type = 'button'; all.className = 'btn'; all.textContent = `Mask all ${openFlags.length} findings`;
      all.onclick = hideUncertain;
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
        } else {
          // a number or ID that is not sensitive here ("Top 5", a version number): kept at this spot only, never everywhere
          const keepIt = document.createElement('button'); keepIt.type = 'button'; keepIt.textContent = 'Not sensitive, keep it';
          keepIt.title = 'Keep this one value readable. Only this spot; the same number elsewhere stays masked.';
          keepIt.onclick = () => { S.masks.push({ x: f.x, y: f.y, w: f.w, h: f.h, type: 'Kept by you', text: f.text, on: false, userOff: true, src: 'user' }); f.resolved = true; updateGate(); renderTypes(); draw(); };
          d.appendChild(keepIt);
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
    // the masked view says in the page that its numbers are made up (the image's footer strip would not fit here)
    $('fake-note').hidden = !(S.view === 'mask' && S.fakeNumbers && S.masks.some(m => m.on && isNumberMask(m)));
    if (S.view === 'mask') { x.drawImage(maskedCanvas(1, null, { tag: false }), 0, 0); return; }
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
  function renderCounts() {
    const counts = {};
    S.masks.filter(m => m.on).forEach(m => counts[m.type] = (counts[m.type] || 0) + 1);
    $('types').innerHTML = Object.keys(TYPES).filter(t => counts[t]).map(t => `<div><span class="sw" style="background:${TYPES[t]}"></span><span>${label(t)}</span><b>${counts[t]}</b></div>`).join('') || '<div class="hint">Nothing hidden yet.</div>';
    renderSummary();
  }
  // Summary for the reviewer: how much is hidden, how much stays readable, how many decisions are theirs, and what to do next
  function tally() {
    const words = (S.words || []).filter(w => !w.ghost);
    const active = S.masks.filter(m => m.on);
    const covered = w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return active.some(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h); };
    const hidden = words.filter(covered).length;
    return { hidden, kept: words.length - hidden, yours: S.masks.filter(byUser).length + (S.sessionAllow ? S.sessionAllow.size : 0) };
  }
  function renderSummary() {
    if (!$('k-hidden')) return;
    const { hidden, kept, yours } = tally();
    $('k-hidden').textContent = hidden; $('k-kept').textContent = kept; $('k-you').textContent = yours;
    const open = (S.flags || []).filter(f => !f.resolved), blocks = open.filter(f => f.severity === 'block').length, plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
    const msg = {
      pending: 'Reading the screenshot on this device…',
      running: 'Checking the masked image again on this device…',
      dirty: `You changed what is hidden. Run the check again to confirm nothing sensitive is readable.`,
      policy: 'Click "Re-apply policy" to update what is hidden with your new names and safe words.',
      blocked: `${plural(blocks, 'number or ID is', 'numbers or IDs are')} still readable. For each one, choose "Mask it", or "Not sensitive, keep it" if it is harmless (like the 5 in "Top 5").`,
      review: `${plural(open.length, 'word is', 'words are')} readable but not on the safe list. Mask them, or mark them safe to keep.`,
      pass: `Ready: ${plural(hidden, 'item', 'items')} hidden and ${plural(kept, 'safe word', 'safe words')} kept${yours ? `, including ${plural(yours, 'decision', 'decisions')} of yours` : ''}. Preview the masked image to continue.`
    }[S.gate] || '';
    $('next-step').textContent = msg;
    const hu = $('btn-hide-unsure');
    hu.hidden = !open.length || (S.gate !== 'blocked' && S.gate !== 'review');
    hu.textContent = `Hide everything uncertain (${open.length})`;
  }
  $('btn-hide-unsure').onclick = hideUncertain;
  function renderTypes() { renderCounts(); renderMaskList(); renderCtxNote(); }
  // The same masks as a list of checkboxes: works with a keyboard and a screen reader, unlike the canvas.
  S.maskFilter = 'all';
  function renderMaskList() {
    const box = $('mask-items'); box.innerHTML = '';
    $('mask-n').textContent = S.masks.length;
    const keep = m => S.maskFilter === 'hidden' ? m.on : S.maskFilter === 'shown' ? !m.on : S.maskFilter === 'yours' ? byUser(m) : true;
    S.masks.forEach((m, i) => {
      if (!keep(m)) return;
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox" role="switch"><span class="sw"></span><code></code><span class="st"></span>`;
      l.querySelector('.sw').style.background = TYPES[m.type] || '#14181e';
      l.querySelector('code').textContent = `${label(m.type)}${m.text && m.src !== 'manual' ? ': ' + m.text : ''}`;
      l.title = `Item ${i + 1}. Ticked = hidden. Untick to keep it readable.`;
      const st = l.querySelector('.st'), cb = l.querySelector('input');
      const paint = () => { st.textContent = m.on ? 'Hidden' : 'Shown'; st.className = 'st ' + (m.on ? 'on' : 'off'); };
      cb.checked = m.on; cb.setAttribute('aria-label', (m.on ? 'Hidden: ' : 'Shown: ') + l.querySelector('code').textContent); paint();
      if (byUser(m)) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'your choice'; l.insertBefore(b, st); }
      cb.onchange = () => { m.on = cb.checked; m.userOff = !cb.checked; S.gate = 'dirty'; renderGate(); renderCounts(); draw(); renderMaskList(); };
      box.appendChild(l);
    });
    if (!box.children.length) box.innerHTML = '<div class="hint">Nothing here.</div>';
  }
  $('mask-filter').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    S.maskFilter = b.dataset.f;
    $('mask-filter').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderMaskList();
  };
  // Words kept because they are on the safe list. A client called "Target" or "Delta" would otherwise
  // stay readable, so the user can mask any of them in one click.
  function renderKept() {
    const seen = new Map();
    (S.words || []).forEach(w => {
      const t = w.text.replace(/^[^\w]+|[^\w]+$/g, '');
      if (!/[A-Za-z]{3,}/.test(t) || /\d/.test(t) || classify(w.text)) return;
      if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    });
    const box = $('kept-words'); box.innerHTML = '';
    $('kept-n').textContent = seen.size;
    [...seen.values()].sort((a, b) => a.localeCompare(b)).forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.title = 'Mask "' + t + '" everywhere';
      b.onclick = () => {
        const cur = $('client-names').value.trim();
        $('client-names').value = cur ? cur + ', ' + t : t;
        S.sessionAllow.delete(t.toLowerCase());
        $('btn-reapply').click();
      };
      box.appendChild(b);
    });
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
      const hits = S.masks.filter(m => d.x0 >= m.x && d.x0 <= m.x + m.w && d.y0 >= m.y && d.y0 <= m.y + m.h);
      if (!hits.length) { draw(); return; }
      const on = !hits.some(m => m.on);
      hits.forEach(m => { m.on = on; m.userOff = !on; });
    }
    S.gate = 'dirty'; renderGate(); renderTypes(); draw();
  });

  /* ---------------- status ---------------- */
  function setStatus(t, busy) { $('status-text').textContent = t; $('status').querySelector('.spinner').hidden = !busy; }

  /* ---------------- screens ---------------- */
  function show(id) { ['s-drop', 's-crop', 's-review', 's-replica'].forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); }

  const MAX_PIXELS = 2200 * 2200, MAX_SIDE = 8000;
  async function loadImage(src) {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That file could not be read as an image.')); img.src = src; });
    // a pixel budget (that of a 2200 x 2200 image), not a longest side: a tall full-page capture shrunk by its height
    // came out with text too small to read, and text that is not read is not masked
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H)), MAX_SIDE / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  let reviewSeq = 0;
  async function startReview(canvas) {
    // "Safe to keep" choices belong to one screenshot; a name marked safe here must not stay readable in the next.
    S.img = canvas; S.words = []; S.masks = []; S.flags = []; S.gate = 'pending'; S.view = 'orig'; S.fid = null; S.sessionAllow = new Set(); S.ctx.lines = null; S.ctx.scores = null; S.ctx.state = 'idle'; S.unread.regions = null; S.unread.state = 'idle';
    S.keepComments = false; S.comments = []; S.commentVocab = new Set(); $('keep-comments').checked = false; $('cm-panel').hidden = true;
    setView('orig');
    show('s-review'); renderGate(); renderTypes(); renderKept(); draw();
    $('btn-reapply').disabled = true;
    // Reading takes seconds; if another screenshot arrives meanwhile, this run must not write into it.
    const seq = ++reviewSeq, current = () => seq === reviewSeq && S.img === canvas;
    try {
      setStatus('Loading the on-device text reader…', true);
      // one figure for reading and the check that follows
      job = { total: weightOf(READ_PASSES.map(p => p[0])) + weightOf(CHECK_SCALES), done: 0, cur: 0, shown: 0 };
      const words = await readAll(canvas, READ_PASSES, 'Reading text on this device…');
      if (!current()) return;
      S.words = notMarks(canvas, words);
      S.comments = findComments(S.words);
      S.masks = buildMasks(S.words);
      if (S.ctx.on) { renderTypes(); draw(); setStatus('Looking for names among safe words (on-device AI)…', true); await scoreContext(); if (!current()) return; S.masks = allMasks(); }
      if (S.unread.on) { renderTypes(); draw(); setStatus('Looking for text the reader missed (on-device AI)…', true); await detectRegions(); if (!current()) return; S.masks = allMasks(); }
      if (S.comments.length) { $('cm-count').textContent = S.comments.blocks + ' comment' + (S.comments.blocks === 1 ? '' : 's'); $('cm-panel').hidden = false; }
      renderTypes(); renderKept(); draw();
      setStatus(`Read ${S.words.length} words. Masked ${S.masks.length} regions.`, false);
      $('btn-reapply').disabled = false;
      await verify();
    } catch (err) {
      job = null;
      if (!current()) return;
      console.error(err);
      setStatus('The on-device reader could not finish: ' + (err && err.message || err), false);
      if (window.VSFeedback) VSFeedback.problem(err, 'On-device reader');
    } finally {
      if (current()) job = null;
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
  $('v-zoom').onclick = () => { const on = $('review-wrap').classList.toggle('zoom'); $('v-zoom').setAttribute('aria-pressed', String(on)); };
  $('btn-recheck').onclick = () => verify();
  $('keep-comments').onchange = async e => {
    S.keepComments = e.target.checked;
    rebuildMasks();
    S.gate = 'dirty'; renderTypes(); draw(); await verify();
  };
  // Rebuilding the automatic masks keeps the user's choices: a mask they switched off stays off, unless the new policy
  // masks that spot for another reason (they just listed it as a client name, say)
  function rebuildMasks() {
    const manual = S.masks.filter(m => m.src !== 'auto');
    const off = S.masks.filter(m => m.src === 'auto' && m.userOff && !m.on);
    const same = (a, b) => a.type === b.type && Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4 && Math.abs(a.w - b.w) < 6 && Math.abs(a.h - b.h) < 6;
    S.masks = allMasks().map(m => (off.some(o => same(o, m)) ? Object.assign(m, { on: false, userOff: true }) : m)).concat(manual);
  }
  $('btn-reapply').onclick = async () => {
    rebuildMasks();
    S.gate = 'dirty'; renderTypes(); renderKept(); draw(); await verify();
  };
  // invented numbers or grey boxes: the same pixels are covered either way, so no new check is needed
  $('fake-on').onchange = e => { S.fakeNumbers = e.target.checked; renderCounts(); draw(); };
  $('ctx-on').onchange = async e => {
    S.ctx.on = e.target.checked;
    if (!S.img || !(S.words && S.words.length) || S.gate === 'running') return renderCtxNote();
    if (S.ctx.on && !S.ctx.scores) { setStatus('Looking for names among safe words (on-device AI)…', true); await scoreContext(); }
    rebuildMasks();
    S.gate = 'dirty'; renderTypes(); draw(); await verify();
  };
  $('unread-on').onchange = async e => {
    S.unread.on = e.target.checked;
    if (!S.img || !(S.words && S.words.length) || S.gate === 'running') return;
    if (S.unread.on && !S.unread.regions) { setStatus('Looking for text the reader missed (on-device AI)…', true); await detectRegions(); }
    rebuildMasks();
    S.gate = 'dirty'; renderTypes(); draw(); await verify();
  };
  // Typing a name to mask does nothing until it is applied, so sending is blocked until then.
  ['client-names', 'extra-allow'].forEach(id => $(id).addEventListener('input', () => {
    if (!S.img || S.gate === 'running' || !(S.words && S.words.length)) return;
    S.gate = 'policy'; renderGate();
  }));

  /* ---------------- Screen 1 ---------------- */
  $('btn-try').onclick = () => {
    const box = $('samples');
    box.hidden = false;
    box.innerHTML = '';
    window.DSC_SAMPLES.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'sample';
      d.innerHTML = `<span class="tag">Full demo</span><h3></h3><p></p><button class="btn ${i === 0 ? 'primary' : ''}" type="button">Run the demo</button>`;
      d.querySelector('h3').textContent = s.name; d.querySelector('p').textContent = s.blurb;
      d.querySelector('button').onclick = () => openSample(s);
      box.appendChild(d);
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  async function openSample(s) {
    S.sample = s;
    $('client-names').value = s.clientNames || '';
    await startReview(await loadImage(s.image));
  }
  const drop = $('drop'), file = $('file');
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) useFile(f); };
  file.onchange = () => { if (file.files[0]) useFile(file.files[0]); file.value = ''; };
  // Paste works on every screen. On the start screen it opens the image; elsewhere it asks first, as it replaces the work
  // in progress. Pasting into a text box (a table copied from Excel carries a picture too) is left to the text box.
  window.addEventListener('paste', e => {
    const items = [...((e.clipboardData || {}).items || [])], it = items.find(i => i.type.startsWith('image/'));
    if (!it || document.querySelector('dialog[open]') || !$('s-crop').hidden) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '') && items.some(i => i.type === 'text/plain')) return;
    const f = it.getAsFile(); if (!f) return;
    e.preventDefault();
    if ($('s-drop').hidden && !confirm('Start again with the pasted screenshot? The current one and its masks are cleared.')) return;
    if (!$('s-drop').hidden) return useFile(f);
    startOver(); useFile(f);
  });
  // The same for anyone who does not know the shortcut (or uses a touch screen): reads the clipboard after a click.
  $('btn-paste').onclick = async () => {
    dropError('');
    try {
      for (const item of await navigator.clipboard.read()) {
        const t = item.types.find(x => x.startsWith('image/'));
        if (t) return useFile(new File([await item.getType(t)], 'pasted-screenshot.' + t.split('/')[1], { type: t }));
      }
      dropError('The clipboard holds no picture. Take a screenshot first (Windows: Win+Shift+S; Mac: Ctrl+Shift+⌘+4), then paste.');
    } catch (e) { dropError('This browser did not let the page read the clipboard. Press Ctrl+V (⌘V on a Mac) instead.'); }
  };
  function dropError(msg) { const e = $('drop-err'); e.textContent = msg || ''; e.hidden = !msg; }
  async function useFile(f) {
    dropError('');
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type)) { dropError('That file is not an image VaultSnip can read. Use a PNG, JPG or WebP screenshot.'); return; }
    if (f.size > 10 * 1024 * 1024) { dropError('That image is over 10 MB. Crop it, or save it as JPG, and try again.'); return; }
    S.sample = null; $('client-names').value = '';
    S.fileBase = slug(String(f.name || '').replace(/\.[^.]+$/, '')) || 'screenshot';
    const url = URL.createObjectURL(f);
    try { await startReview(await loadImage(url)); }
    catch (e) { show('s-drop'); dropError(e.message || 'That image could not be read.'); }
    finally { URL.revokeObjectURL(url); }
  }

  /* ---------------- files ---------------- */
  const slug = s => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/^-|-$/g, '');
  function saveFile(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Base name for files made from the replica. Generic mode never puts the original title in a file name.

  /* ---------------- payload preview: download it, or send it ---------------- */
  $('btn-send').onclick = () => {
    const c = maskedCanvas(1);
    const url = c.toDataURL('image/png');
    S.payload = url;
    $('payload-img').src = url;
    $('pf-contents').textContent = 'The masked image above, fixed instructions, and for each hidden box only its kind, its character pattern (digits as 9) or, for other text, its length, its position and the visible labels beside it (see below). No original image, never the hidden text.' + (S.fakeNumbers && S.masks.some(m => m.on && isNumberMask(m)) ? ' Numbers are replaced with invented values of the same size; labels stay masked.' : '') + (S.keepComments ? ' Customer comments are readable, with names, companies, emails and numbers in them masked.' : '');
    // the boxes' descriptions are fixed here, shown in full, and sent exactly as shown
    S.sendToks = VSSynth.tokens(S.masks.filter(m => m.on), S.words);
    S.sendReq = VSSynth.request(S.sendToks, S.img);
    $('pf-req-json').textContent = JSON.stringify(S.sendReq, null, 1);
    $('pf-size').textContent = Math.round(url.length * 0.75 / 1024) + ' KB';
    const isSample = !!S.sample;
    $('pf-dest').textContent = isSample ? 'Nothing is sent: the sample is built on this device' : (S.key ? VSLLM.PROVIDERS[S.provider].host + ' (' + S.model + '), using your key' : 'Only if you click Send: the AI provider you choose below, with your key');
    $('keybox').hidden = isSample || !!S.key;
    $('pf-req').hidden = isSample; $('pf-req').open = false;
    kpSend.fill();
    $('send-err').hidden = true;
    // the user confirms they looked: the reader cannot promise it caught everything
    $('pf-ok').checked = false;
    AFTER_LOOK.forEach(id => { $(id).disabled = true; });
    $('btn-confirm').textContent = isSample ? 'Build replica' : 'Send and build replica';
    $('dlg-send').showModal();
  };
  const AFTER_LOOK = ['btn-confirm', 'btn-dl-masked', 'btn-local', 'btn-copy-masked', 'btn-receipt-png', 'btn-receipt-pdf'];
  $('pf-ok').onchange = () => AFTER_LOOK.forEach(id => { $(id).disabled = !$('pf-ok').checked; });
  // The masked image exactly as it is saved, copied and described by the receipt: the same pixels, so the same bytes.
  function maskedImage() { const c = maskedCanvas(1); if ($('pf-credit').checked) creditTag(c); return c; }
  const pngOf = c => new Promise(r => c.toBlob(r, 'image/png'));
  const maskedName = () => (S.sample ? 'sample' : (S.fileBase || 'screenshot')) + '-masked.png';
  const dlgNote = t => { const err = $('send-err'); err.hidden = false; err.className = 'note'; err.textContent = t; };
  // Mask-only: the masked image as a PNG, no key and no network. Optionally tagged so others can find the tool.
  $('btn-dl-masked').onclick = async () => {
    if (!$('pf-ok').checked) return;
    saveFile(await pngOf(maskedImage()), maskedName());
    dlgNote('Saved. The file holds exactly the image above.');
  };
  // Straight into Teams, Slack, a ticket or a slide: the clipboard gets the same PNG as the download.
  async function copyPng(blobPromise) {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('This browser cannot copy images.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
  }
  $('btn-copy-masked').onclick = async () => {
    if (!$('pf-ok').checked) return;
    try { await copyPng(pngOf(maskedImage())); dlgNote('Copied. Paste it into a chat, a ticket or a slide; it is exactly the image above.'); }
    catch (e) { dlgNote('Copying images does not work in this browser. Use "Download masked image" instead.'); }
  };
  // The safe-to-share receipt: counts and kinds of what was hidden (never the hidden text), the check, where it was made,
  // and the SHA-256 of the masked image file, so anyone can confirm a file is the one the receipt describes.
  async function receiptFacts() {
    const image = maskedImage(), blob = await pngOf(image), sha = await VSReceipt.sha256(blob);
    const on = S.masks.filter(m => m.on), counts = {};
    on.forEach(m => { counts[m.type] = (counts[m.type] || 0) + 1; });
    const t = tally(), flags = S.flags || [], plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
    const masked = flags.filter(f => S.masks.some(m => m.src === 'check' && m.on && m.x === f.x && m.y === f.y)).length;
    const keptByYou = flags.length - masked;
    const state = s => ({ ready: 'ran', off: 'switched off', error: 'could not run in this browser', running: 'still running when this was made', idle: 'not run' }[s] || 'not run');
    const made = new Date();
    const rows = [
      ['Image', `${maskedName()}, ${image.width} × ${image.height} px`],
      ['SHA-256', sha || 'not available (this page is not served over https)', true],
      ['Made', made.toLocaleString() + ' (' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time') + ')'],
      ['Where', 'On this device, in the browser. The original screenshot and the words read from it never left it.'],
      ['Pre-flight check', S.gate === 'pass' ? 'Passed. The masked image was read again six independent ways on this device; nothing readable is left outside the masks.'
        + (flags.length ? ` ${plural(flags.length, 'finding was', 'findings were')} resolved: ${[masked ? masked + ' masked' : '', keptByYou ? keptByYou + ' kept as not sensitive' : ''].filter(Boolean).join(', ')}.` : '') : 'Not passed'],
      ['Hidden', `${plural(t.hidden, 'word or number', 'words and numbers')} in ${plural(on.length, 'box', 'boxes')}: ` + Object.keys(TYPES).filter(k => counts[k]).map(k => `${label(k)} ${counts[k]}`).join(' · ')],
      ['Numbers', !on.some(isNumberMask) ? 'None hidden' : S.fakeNumbers ? 'Replaced with invented values of the same size; the image says so below it' : 'Covered with grey boxes'],
      ['Kept readable', plural(t.kept, 'safe report word', 'safe report words') + (S.keepComments ? ', and the wording of customer comments (names, companies, emails and numbers in them masked)' : '')],
      ['Your decisions', String(t.yours)],
      ['On-device AI', `Names among safe words: ${state(S.ctx.on ? S.ctx.state : 'off')}. Text the reader could not read: ${state(S.unread.on ? S.unread.state : 'off')}.`],
      ['Reviewed', 'The person who made it confirmed they looked over the masked image and nothing sensitive is readable.'],
    ];
    return { image, blob, sha, made, rows, passKey: 'Pre-flight check', file: maskedName(),
      subtitle: `Made with VaultSnip ${(window.VSFeedback && VSFeedback.VERSION) || ''}, free and open source. Goes with ${maskedName()}.`,
      note: 'This receipt lists counts and kinds only; it never contains what was hidden. To confirm a file is the one described, compare its SHA-256: on Windows, certutil -hashfile <file> SHA256; on macOS or Linux, shasum -a 256 <file>.' };
  }
  async function saveReceipt(kind) {
    if (!$('pf-ok').checked) return;
    const f = await receiptFacts(), c = VSReceipt.draw(f, f.image), name = maskedName().replace(/\.png$/, '-receipt.' + kind);
    saveFile(kind === 'pdf' ? VSReceipt.pdf(c, { title: 'VaultSnip safe-to-share receipt', subject: `${f.file} SHA-256 ${f.sha}`, creator: 'VaultSnip', made: f.made }) : await pngOf(c), name);
    dlgNote(`Saved ${name}. It goes with ${f.file}` + (f.sha ? ` (SHA-256 ${f.sha.slice(0, 12)}…).` : '.'));
  }
  $('btn-receipt-png').onclick = () => saveReceipt('png');
  $('btn-receipt-pdf').onclick = () => saveReceipt('pdf');
  function creditTag(c) {
    const x = c.getContext('2d'), fs = Math.max(11, Math.round(c.width / 120)), text = 'masked with vaultsnip.pages.dev';
    x.font = `600 ${fs}px system-ui, sans-serif`;
    const w = x.measureText(text).width + fs, h = fs * 1.7;
    x.fillStyle = 'rgba(20,24,30,.82)'; x.fillRect(c.width - w - 6, c.height - h - 6, w, h);
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(text, c.width - w - 6 + fs / 2, c.height - 6 - h / 2);
  }
  $('btn-confirm').onclick = async () => {
    const err = $('send-err'); err.hidden = true; err.className = 'err';
    if (!$('pf-ok').checked) return;
    // the bundled sample needs no key: its replacements are made on this device
    if (S.sample) { $('dlg-send').close(); S.seed = 4127; return buildInPlace(false); }
    if (!S.key) {
      const v = kpSend.read();
      if (!v.key) { err.textContent = 'Add your Claude or OpenAI API key for AI-written replacements, or click "Build on this device" (no key needed, nothing sent).'; err.hidden = false; return; }
      applyKey(v);
      $('pf-dest').textContent = VSLLM.PROVIDERS[S.provider].host + ' (' + S.model + '), using your key';
    }
    $('btn-confirm').disabled = true; $('btn-confirm').textContent = 'Asking ' + providerName() + ' for replacements…';
    try {
      S.seed = 1000 + Math.floor(Math.random() * 9000);
      await buildInPlace(true);
      $('dlg-send').close();
    } catch (e) {
      err.textContent = e.message || String(e); err.hidden = false;
      // a rejected key is forgotten everywhere, including a copy remembered on this device
      if (e.status === 401) { S.key = null; remember(false); $('keybox').hidden = false; kpSend.fill(); }
      if (window.VSFeedback) { VSFeedback.note(e, providerName() + ' request (' + S.model + ')'); err.insertAdjacentHTML('beforeend', ' <button type="button" class="linkbtn" data-feedback="bug">Report this</button>'); }
    } finally {
      $('btn-confirm').disabled = !$('pf-ok').checked; $('btn-confirm').textContent = 'Send and build replica';
    }
  };
  $('btn-local').onclick = () => {
    if (!$('pf-ok').checked) return;
    $('dlg-send').close(); S.seed = 1000 + Math.floor(Math.random() * 9000); buildInPlace(false);
  };

  /* ---------------- Screen 3: the in-place replica ---------------- */
  // The original screenshot is the picture. Each active mask is wiped with the background sampled around it and synthetic
  // text is drawn back in its place (web/inpaint.js); nothing else of the original is redrawn, so every visual stays
  // exactly as it was. The text comes from the context synthesizer (web/synth.js): from the AI provider when the user
  // sends (only each box's kind, character pattern and the visible labels beside it; never the hidden text), else made
  // here. A layer of hotspots over the picture explains each replaced box.
  S.fid = null;           // { canvas, patches, ai: provider name or '' }
  async function buildInPlace(useAi) {
    // with the AI: the boxes as shown in the send dialog; the request is the one the user saw there
    const toks = useAi && S.sendToks ? S.sendToks : VSSynth.tokens(S.masks.filter(m => m.on), S.words);
    const fallback = VSSynth.local(toks, { fakeValue, axisFactors }, S.seed);
    let answer = null;
    if (useAi && S.sendReq.tokens.length) answer = await askSynth(S.sendReq);
    const res = VSInpaint.patch(S.img, VSSynth.combine(toks, answer, fallback));
    S.fid = { canvas: res.canvas, patches: res.patches, ai: useAi ? providerName() : '' };
    showInPlace();
  }
  async function askSynth(req, retry) {
    const text = await VSLLM.ask({
      provider: S.provider, key: S.key, model: S.model, system: VSSynth.SYSTEM, imageDataUrl: S.payload,
      prompt: (retry ? 'Your previous answer was not valid JSON in the required shape. Return only the JSON object.\n' : '') + JSON.stringify(req)
    });
    const map = VSSynth.parse(text);
    if (map) return map;
    if (retry) throw new Error(providerName() + ' returned replacements that could not be read. Try again, pick a stronger model, or build on this device.');
    return askSynth(req, true);
  }
  const KIND_NAMES = { number: 'Number or amount', client: 'Client name', person: 'Person', email: 'Email address', id: 'ID or code', text: 'Label', unread: 'Unread text (cleared)' };
  // What a hotspot tells: the synthetic value and why it is there. Never the hidden text.
  function describePatch(p) {
    const lines = [p.synthetic ? p.synthetic : 'Cleared', KIND_NAMES[p.kind] || 'Replaced text'];
    if (p.context) lines.push('Beside: ' + p.context);
    if (p.note) lines.push(p.note);
    lines.push(p.source === 'ai' ? 'Synthetic, written by ' + S.fid.ai : 'Synthetic, made on this device');
    return lines;
  }
  function showInPlace() {
    show('s-replica');
    const f = S.fid, ai = f.patches.filter(p => p.source === 'ai').length;
    VSInpaint.mount($('replica'), f.canvas, f.patches, { label: 'The screenshot with every sensitive text replaced by synthetic text', describe: describePatch });
    $('replica').classList.toggle('ip-outline', $('opt-outline').checked);
    $('fid-summary').textContent = `${f.patches.length} ${f.patches.length === 1 ? 'box' : 'boxes'} replaced in place` +
      (f.ai ? `, ${ai} written by ${f.ai} and ${f.patches.length - ai} on this device` : ', all on this device') +
      '. Everything else is the original picture. Hover or tab to a replaced value to see what it stands for.';
    $('export-note').textContent = '';
  }
  $('opt-outline').onchange = () => $('replica').classList.toggle('ip-outline', $('opt-outline').checked);
  $('btn-regen').onclick = () => { S.seed = 1000 + Math.floor(Math.random() * 9000); buildInPlace(false); };
  function startOver() { reviewSeq++; S.img = null; S.fid = null; S.masks = []; S.words = []; S.flags = []; S.payload = null; show('s-drop'); }
  $('btn-restart').onclick = startOver;
  // The replica as a picture, with a strip below it (hiding nothing) that says the text is synthetic.
  function replicaImage() {
    const src = S.fid.canvas, strip = footerHeight(1), c = document.createElement('canvas');
    c.width = src.width; c.height = src.height + strip;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    x.fillStyle = '#20262e'; x.fillRect(0, src.height, c.width, strip);
    const fs = Math.round(strip * 0.42); x.textBaseline = 'middle'; x.textAlign = 'left';
    x.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`; x.fillStyle = '#ffffff';
    const lead = 'Synthetic data';
    x.fillText(lead, fs, src.height + strip / 2);
    x.font = `400 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`; x.fillStyle = '#c9d1da';
    x.fillText('  ·  values, names and labels in this image are made up, never the real ones  ·  VaultSnip', fs + x.measureText(lead).width, src.height + strip / 2);
    return c;
  }
  const replicaName = () => (S.sample ? 'sample' : (S.fileBase || 'screenshot')) + '-replica-synthetic.png';
  $('btn-dl-replica').onclick = async () => { saveFile(await pngOf(replicaImage()), replicaName()); $('export-note').textContent = 'Downloaded. The picture is the original with every sensitive text replaced; a strip below says so.'; };
  $('btn-copy-replica').onclick = async () => {
    try { await copyPng(pngOf(replicaImage())); $('export-note').textContent = 'Copied. Paste it into a chat, a ticket or a slide.'; }
    catch (e) { saveFile(await pngOf(replicaImage()), replicaName()); $('export-note').textContent = 'This browser cannot copy images, so the picture was downloaded instead.'; }
  };

  // The masked image as the benchmarks read it (tools/layout-bench/review.mjs): solid boxes, the words that stay readable,
  // and the active masks. Used by the masking benchmark only.
  function layoutInput() {
    const c = maskedCanvas(1, '#787c82'), im = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const on = S.masks.filter(m => m.on);
    const inMask = w => on.some(m => w.x + w.w / 2 >= m.x && w.x + w.w / 2 <= m.x + m.w && w.y + w.h / 2 >= m.y && w.y + w.h / 2 <= m.y + m.h);
    const words = S.words.filter(w => !w.ghost).map(w => { const kept = !inMask(w); return { text: kept ? w.text : '', x: w.x, y: w.y, w: w.w, h: w.h, kept }; });
    return { image: { data: im.data, width: im.width, height: im.height, channels: 4 }, words, masks: on.map(m => ({ x: m.x, y: m.y, w: m.w, h: m.h })) };
  }

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
  S.test = { hideUncertain, receiptFacts, buildInPlace, replicaImage, describePatch, fakeValue, maskedCanvas, axisFactors, classify, countLabels, updateGate, plausible, columnFill, ocr, prep, findComments, commentType, scrubQuote, buildMasks, contextMasks, scoreContext, layoutInput, detectRegions, unreadMasks };
})();
