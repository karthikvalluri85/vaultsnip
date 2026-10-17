/* VaultSnip: masked session replay (Feature 4).
   Plays a recording made by the extension ("Record this tab (text masked)") or opened from a file.
   Every recording is cleaned and audited again (VSReplay.prepare) before it plays or can be downloaded;
   if the audit finds anything, nothing is shown. Nothing here makes a network request. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const state = { events: null, findings: [], player: null };
  window.__VSREPLAY = state;

  function status(text, cls) { const s = $('status'); s.textContent = text; s.className = cls || ''; }

  function use(raw, source) {
    if (state.player) { state.player.destroy(); state.player = null; }
    $('player').hidden = true;
    const { events, findings } = VSReplay.prepare(raw);
    state.findings = findings;
    const list = $('findings'); list.innerHTML = ''; list.hidden = !findings.length;
    if (findings.length) {
      state.events = null;
      findings.slice(0, 8).forEach(f => { const li = document.createElement('li'); li.textContent = f.where; list.appendChild(li); });
      return status(`Not shown: ${findings.length} item(s) in this recording could not be confirmed as masked.`, 'bad');
    }
    state.events = events;
    $('player').hidden = false;
    const p = state.player = VSReplay.mount($('stage'), events);
    $('seek').max = p.total;
    $('pp').textContent = 'Play';
    p.onFinish(() => { $('pp').textContent = 'Play'; });
    status(`${source}: ${fmt(p.total)}, ${events.length} events. Privacy check passed.`, 'ok');
  }

  $('pp').onclick = () => {
    const p = state.player; if (!p) return;
    if (p.playing()) { p.pause(); $('pp').textContent = 'Play'; } else { p.play(); $('pp').textContent = 'Pause'; }
  };
  $('seek').oninput = () => { if (state.player) { state.player.seek(+$('seek').value); $('pp').textContent = 'Play'; } };
  $('speed').onchange = () => { if (state.player) state.player.setSpeed(+$('speed').value); };
  (function loop() {
    const p = state.player;
    if (p) { $('seek').value = p.time(); $('time').textContent = fmt(p.time()) + ' / ' + fmt(p.total); }
    requestAnimationFrame(loop);
  })();

  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('dl-json').onclick = () => {
    if (!state.events) return;
    save(new Blob([JSON.stringify({ format: 'vaultsnip-replay', version: 1, events: state.events })], { type: 'application/json' }), `vaultsnip-replay-${stamp()}.json`);
  };
  $('dl-html').onclick = async () => {
    if (!state.events) return;
    const src = await (await fetch('lib/vs-replay.js')).text();   // this app's own file
    save(new Blob([VSReplay.standaloneHtml(state.events, src)], { type: 'text/html' }), `vaultsnip-replay-${stamp()}.html`);
  };

  $('file').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { use(VSReplay.readRecording(JSON.parse(await f.text())), f.name); }
    catch (err) { status(err.message || String(err), 'bad'); }
    e.target.value = '';
  };

  // From the extension: the recording waits in the service worker until this page asks for it once.
  if (location.hash === '#recording' && window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'vs-get-recording' }).then(msg => {
      if (msg && msg.events) use(msg.events, 'Recording from your tab');
      else status('The recording is no longer available (it can be opened once). Record the tab again.', 'bad');
    }).catch(() => status('Could not reach the VaultSnip extension.', 'bad'));
  }
})();
