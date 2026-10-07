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
    sessionAllow: new Set()
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
`).split(/\s+/).filter(Boolean));

  const TYPES = {
    'Client name': '#4a3aa7',
    'Number or money': '#eb6834',
    'Identifier': '#2a78d6',
    'Email': '#e34948',
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
    if (/@/.test(raw) && /\./.test(raw)) return 'Email';
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
  function prep(src, scale, invert) {
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    if (invert) x.filter = 'invert(1) grayscale(1)'; else x.filter = 'grayscale(1)';
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function ocr(src, scale, invert) {
    const w = await worker();
    const { data } = await w.recognize(prep(src, scale, invert), {}, { tsv: true, text: false, blocks: false, hocr: false });
    const out = [];
    (data.tsv || '').split('\n').forEach(line => {
      const c = line.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const text = c.slice(11).join('\t').trim(); const conf = parseFloat(c[10]);
      if (!text || conf < 30) return;
      out.push({ text, conf, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale, line: `${c[2]}-${c[3]}-${c[4]}`, inv: invert });
    });
    return out;
  }
  const overlap = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ix * iy / Math.min(a.w * a.h || 1, b.w * b.h || 1);
  };

  /* ---------------- masks ---------------- */
  function buildMasks(words) {
    const flagged = words.map(w => Object.assign({}, w, { type: classify(w.text) })).filter(w => w.type);
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
    setStatus('Checking the masked image again (2× zoom, normal and inverted)…', true);
    const m2 = maskedCanvas(1);
    const a = await ocr(m2, 2, false);
    const b = await ocr(m2, 1.5, true);
    const all = a.concat(b.filter(w => !a.some(v => overlap(v, w) > 0.3)));
    const active = S.masks.filter(m => m.on);
    const flags = [];
    all.forEach(w => {
      if (w.conf < 45) return;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      if (active.some(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h)) return;
      const t = classify(w.text);
      if (!t) return;
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
    setView('orig');
    show('s-review'); renderGate(); renderTypes(); draw();
    $('btn-reapply').disabled = true;
    try {
      setStatus('Loading the on-device text reader…', true);
      const a = await ocr(canvas, 1.5, false);
      setStatus('Reading light text on dark areas…', true);
      const b = await ocr(canvas, 1.5, true);
      S.words = a.concat(b.filter(w => !a.some(v => overlap(v, w) > 0.3)));
      S.masks = buildMasks(S.words);
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
      S.spec = await askModel(S.payload);
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
Grey boxes cover redacted text. Never guess, reconstruct or mention redacted content. Never output a real value.
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
 gauge: "shapeValue":0-100. waterfall: series shape signed -100..100, last member is the total (0).
 sankey: "nodes":[string],"links":[{"source":index,"target":index,"shape":0-100}].
 gantt (also roadmaps and timelines): "tasks":[{"name":string,"start":0-100,"end":0-100}] in top-to-bottom order, positions measured along the time axis; "timeLabels":[string] for the visible time-axis labels, left to right.
 map: "basemap":"world"|"europe"|"usa"|"canada"|"mexico"|"brazil"|"uk"|"france"|"germany"|"italy"|"spain"|"india"|"china"|"japan"|"australia"|"south-africa" (the closest outline to what is shown),
  "mapKind":"filled"|"bubble"|"density"|"flow". filled: "dimension":{"name","members":[regions that are shaded]} with series shape = relative colour intensity.
  bubble/density: "points":[{"name":string,"lat":number,"lon":number,"shape":0-100}] for each marker or hotspot, placed by where it sits on the map (if its label is masked, name it "Location N").
  flow: "points" for the endpoints plus "flows":[{"from":name,"to":name,"shape":0-100}].
  Recognise shaded regions from the geography itself and use their standard English names (country, state or province), even when labels are masked; region names are not sensitive.
 table: "columns":[{"name":string,"kind":"text"|"org"|"person"|"id"|"category"|"date"|"number"|"currency"|"percent","members":[string]}],"rowCount":int,"sorted":bool.
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
})();
