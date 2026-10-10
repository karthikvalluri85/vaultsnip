/* VaultSnip: in-app feedback.
   Builds a report the user can read and edit, then hands it to GitHub (public issue, discussion or
   private security advisory) or to the user's own email app. VaultSnip itself sends and stores nothing:
   no images, no dashboard text, no keys. */
(function (global) {
  'use strict';

  const VERSION = '0.5.1';
  const REPO = 'https://github.com/karthikvalluri85/vaultsnip';
  const EMAIL = ['karthikvalluri', 'gmail.com'].join('@'); // assembled at runtime to keep it away from scrapers

  const KINDS = {
    bug: { label: 'Something is broken', hint: 'An error, a screen that will not load, a button that does nothing.', route: 'issue', template: 'bug_report.yml', prefix: '[Bug] ' },
    masking: { label: 'Something was not masked', hint: 'Sensitive text was left readable. This goes privately to the owner, never to a public page.', route: 'private', prefix: '[Masking] ' },
    replica: { label: 'The replica looks wrong', hint: 'Wrong chart type, missing visual, layout or filtering not like the original.', route: 'issue', template: 'replica.yml', prefix: '[Replica] ' },
    idea: { label: 'Idea or feature request', hint: 'Something that would make VaultSnip more useful.', route: 'discussion', category: 'ideas', prefix: '' },
    question: { label: 'Question', hint: 'How something works, or how to use it.', route: 'discussion', category: 'q-a', prefix: '' }
  };

  let lastError = '';
  const scrub = s => String(s == null ? '' : s)
    .replace(/sk-[\w-]{8,}/g, '[key removed]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]')
    .replace(/https?:\/\/[^\s)]+/g, u => /anthropic\.com|vaultsnip|localhost|chrome-extension/.test(u) ? u : '[link removed]')
    .slice(0, 400);

  function channel() {
    if (location.protocol === 'chrome-extension:') return /Edg\//.test(navigator.userAgent) ? 'Edge extension' : 'Chrome extension';
    if (/hf\.space|huggingface/.test(location.hostname)) return 'Hugging Face Space';
    if (/localhost|127\.0\.0\.1/.test(location.hostname)) return 'Local copy';
    return 'Web app';
  }
  function browser() {
    const ua = navigator.userAgent;
    const m = ua.match(/(Edg|OPR|Chrome|Firefox|Version)\/(\d+)/);
    const name = !m ? 'Unknown' : m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1] === 'Version' ? 'Safari' : m[1];
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
    return `${name} ${m ? m[2] : ''} on ${os}`.replace('  ', ' ');
  }
  function step() {
    const vis = id => { const el = document.getElementById(id); return el && !el.hidden; };
    if (vis('s-replica')) return 'Replica';
    if (vis('s-review')) return 'Review and masking';
    if (vis('s-crop')) return 'Crop';
    return 'Start screen';
  }
  // Only the kinds of visuals, never titles, labels or values.
  function visuals() {
    const S = global.__DSC; const spec = S && S.spec;
    if (!spec || !spec.rows) return '';
    const n = {}; spec.rows.forEach(r => (r.visuals || []).forEach(v => { n[v.type] = (n[v.type] || 0) + 1; }));
    return Object.keys(n).map(k => n[k] > 1 ? `${k} ×${n[k]}` : k).join(', ');
  }
  function context() {
    const S = global.__DSC || {};
    return {
      version: VERSION, channel: channel(), browser: browser(), step: step(),
      ai: S.key ? (S.provider === 'openai' ? 'OpenAI' : 'Claude') + ' · ' + (S.model || '') : '', mode: S.mode || '', source: S.sample ? 'Bundled sample: ' + S.sample.name : (S.spec || S.img ? 'Own screenshot' : ''),
      visuals: visuals(), error: scrub(lastError)
    };
  }
  function diagnostics(c) {
    return [`VaultSnip ${c.version} · ${c.channel} · ${c.browser}`, `Step: ${c.step}${c.mode ? ' · mode: ' + c.mode : ''}${c.source ? ' · ' + c.source : ''}`,
      c.ai ? 'AI: ' + c.ai : '', c.visuals ? 'Visual types: ' + c.visuals : '', c.error ? 'Last error: ' + c.error : ''].filter(Boolean).join('\n');
  }

  /* ---------- dialog ---------- */
  const CSS = `
#dlg-fb .kinds{display:grid;gap:8px;margin:10px 0}
#dlg-fb .kind{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:9px 12px;cursor:pointer}
#dlg-fb .kind:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
#dlg-fb .kind b{display:block;font-size:14px}#dlg-fb .kind span{font-size:12.5px;color:var(--muted)}
#dlg-fb textarea{width:100%;min-height:84px;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);resize:vertical}
#dlg-fb pre{white-space:pre-wrap;font-family:var(--mono);font-size:12px;background:var(--sunken);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0 0;max-height:130px;overflow:auto}
#dlg-fb .warn{font-size:12.5px;background:var(--warn-soft);color:var(--ink);border-radius:8px;padding:8px 10px;margin:10px 0}
#dlg-fb .acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}
.fb-toast{position:fixed;right:16px;bottom:16px;z-index:60;max-width:380px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:10px;padding:12px 14px;box-shadow:0 6px 24px rgb(0 0 0/.18);font-size:13.5px}
.fb-toast .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.site-foot{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;padding:18px 20px 26px;font-size:12.5px;color:var(--muted)}
.site-foot a{color:var(--muted)}
.linkbtn{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:2px}
.site-foot .linkbtn{color:var(--muted)}
`;

  function css() { if (document.getElementById('fb-css')) return; const st = document.createElement('style'); st.id = 'fb-css'; st.textContent = CSS; document.head.appendChild(st); }
  function build() {
    if (document.getElementById('dlg-fb')) return;
    css();
    const d = document.createElement('dialog'); d.id = 'dlg-fb';
    d.setAttribute('aria-labelledby', 'fb-title');
    d.innerHTML = `<form method="dialog" class="dlg">
      <h2 id="fb-title">Send feedback</h2>
      <p class="note">Your report goes to the developer on GitHub, or by email from your own mail app. VaultSnip adds only the details shown below and never attaches your screenshot or dashboard text.</p>
      <div class="kinds" role="radiogroup" aria-label="What kind of feedback">${Object.keys(KINDS).map((k, i) => `<label class="kind"><input type="radio" name="fb-kind" value="${k}" ${i === 0 ? 'checked' : ''}><div><b>${KINDS[k].label}</b><span>${KINDS[k].hint}</span></div></label>`).join('')}</div>
      <label class="f" for="fb-text">What happened, or what would you like?<textarea id="fb-text" placeholder="Describe it in your own words. Please do not paste client names, figures or other real data."></textarea></label>
      <div class="note" style="margin-top:8px">Details added automatically (you can edit them on the next page):</div>
      <pre id="fb-diag"></pre>
      <div class="warn" id="fb-warn" hidden>Describe what was missed without the real value, for example "an 8-digit account number in a table column stayed readable". Never send the original screenshot.</div>
      <div class="acts">
        <button class="btn" value="cancel" type="submit">Cancel</button>
        <button class="btn" id="fb-copy" type="button">Copy report</button>
        <button class="btn" id="fb-mail" type="button">Email instead</button>
        <button class="btn primary" id="fb-go" type="button">Continue on GitHub</button>
      </div>
      <p class="note" id="fb-done" role="status" aria-live="polite"></p>
    </form>`;
    document.body.appendChild(d);
    const kind = () => (d.querySelector('input[name=fb-kind]:checked') || {}).value || 'bug';
    const refresh = () => {
      const k = KINDS[kind()];
      d.querySelector('#fb-warn').hidden = kind() !== 'masking';
      d.querySelector('#fb-go').textContent = k.route === 'private' ? 'Report privately on GitHub' : k.route === 'discussion' ? 'Continue on GitHub Discussions' : 'Continue on GitHub';
    };
    d.querySelectorAll('input[name=fb-kind]').forEach(r => r.addEventListener('change', refresh));
    d.querySelector('#fb-go').onclick = () => { const u = urlFor(kind(), d.querySelector('#fb-text').value); if (kind() === 'masking') copy(report(kind(), d.querySelector('#fb-text').value), d, 'Report copied. Paste it into the private form that just opened.'); global.open(u, '_blank', 'noopener'); };
    d.querySelector('#fb-mail').onclick = () => { location.href = mailFor(kind(), d.querySelector('#fb-text').value); };
    d.querySelector('#fb-copy').onclick = () => copy(report(kind(), d.querySelector('#fb-text').value), d, 'Report copied to your clipboard.');
    d._refresh = refresh;
  }
  function copy(text, d, msg) {
    const done = d.querySelector('#fb-done');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { done.textContent = msg; }, () => { done.textContent = 'Copy failed. Select the details above and copy them by hand.'; });
  }
  function title(kind, text) {
    const t = String(text || '').trim().split('\n')[0].slice(0, 70);
    return KINDS[kind].prefix + (t || (kind === 'idea' ? 'Idea: ' : kind === 'question' ? 'Question: ' : ''));
  }
  function report(kind, text) {
    return `${KINDS[kind].label}\n\n${String(text || '').trim() || '(describe it here)'}\n\n---\n${diagnostics(context())}`;
  }
  function urlFor(kind, text) {
    const k = KINDS[kind], c = context(), q = new URLSearchParams();
    if (k.route === 'private') return REPO + '/security/advisories/new';
    if (k.route === 'discussion') {
      q.set('category', k.category); q.set('title', title(kind, text)); q.set('body', `${String(text || '').trim()}\n\n---\n${diagnostics(c)}`);
      return REPO + '/discussions/new?' + q.toString();
    }
    q.set('template', k.template); q.set('title', title(kind, text));
    q.set('what', String(text || '').trim()); q.set('version', c.version); q.set('channel', c.channel); q.set('browser', c.browser);
    q.set('step', [c.step, c.mode && 'mode: ' + c.mode, c.source].filter(Boolean).join(' · '));
    if (c.visuals) q.set('visuals', c.visuals);
    if (c.ai) q.set('step', q.get('step') + ' · AI: ' + c.ai);
    if (c.error) q.set('error', c.error);
    return REPO + '/issues/new?' + q.toString();
  }
  function mailFor(kind, text) {
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('VaultSnip feedback: ' + (title(kind, text) || KINDS[kind].label)) + '&body=' + encodeURIComponent(report(kind, text));
  }

  function open(kind, text) {
    build();
    const d = document.getElementById('dlg-fb');
    const r = d.querySelector(`input[name=fb-kind][value="${kind || 'bug'}"]`); if (r) r.checked = true;
    if (text != null) d.querySelector('#fb-text').value = text;
    d.querySelector('#fb-diag').textContent = diagnostics(context());
    d.querySelector('#fb-done').textContent = '';
    d._refresh();
    if (!d.open) d.showModal();
  }

  /* ---------- errors: remember the last one and offer to report it ---------- */
  let toastTimer = null;
  function problem(message, where) {
    lastError = (where ? where + ': ' : '') + (message && message.message ? message.message : message);
    if (!document.body) return;
    build();
    let t = document.querySelector('.fb-toast');
    if (!t) { t = document.createElement('div'); t.className = 'fb-toast'; t.setAttribute('role', 'alert'); document.body.appendChild(t); }
    t.innerHTML = `<b>Something went wrong.</b><div class="note" style="margin-top:2px"></div><div class="acts"><button class="btn" type="button" data-x>Dismiss</button><button class="btn primary" type="button" data-r>Report this</button></div>`;
    t.querySelector('.note').textContent = scrub(lastError).slice(0, 160);
    t.querySelector('[data-x]').onclick = () => t.remove();
    t.querySelector('[data-r]').onclick = () => { t.remove(); open('bug'); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 20000);
  }
  global.addEventListener('error', e => { if (e && e.message && !/ResizeObserver/.test(e.message)) problem(e.message, 'Page error'); });
  global.addEventListener('unhandledrejection', e => problem(e && e.reason, 'Unhandled error'));

  /* ---------- entry points: header link, footer, any [data-feedback] element ---------- */
  function wire() {
    css();
    if (!document.querySelector('.site-foot')) {
      const f = document.createElement('footer'); f.className = 'site-foot';
      f.innerHTML = `<span>VaultSnip ${VERSION}</span><button type="button" class="linkbtn" data-feedback="bug">Report a problem</button><button type="button" class="linkbtn" data-feedback="idea">Suggest an idea</button><a href="privacy.html">Privacy</a><a href="${REPO}" target="_blank" rel="noopener">Source on GitHub</a>`;
      document.body.insertBefore(f, document.querySelector('script') || null);
    }
    document.addEventListener('click', e => { const b = e.target.closest('[data-feedback]'); if (b) { e.preventDefault(); open(b.getAttribute('data-feedback')); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  // Remember an expected failure (for example a rejected key) without interrupting the user.
  const note = (message, where) => { lastError = (where ? where + ': ' : '') + (message && message.message ? message.message : message); };
  global.VSFeedback = { open, problem, note, context, urlFor, mailFor, VERSION };
})(window);
