/**
 * Replay of masked recordings (Feature 4), built as web/lib/vs-replay.js (window.VSReplay).
 * Used by web/replay.html and inlined into the standalone HTML player it downloads.
 * Every recording is cleaned and audited again before it plays; a file opened by the user is never trusted.
 */
import { Replayer } from 'rrweb';
import rrwebCss from 'rrweb/dist/style.css?inline';
import { auditEvents, sanitizeEvents, type Finding, type RrEvent } from '../shared/replay-sanitize';

export { auditEvents, sanitizeEvents };
export type { Finding, RrEvent };

export interface Player {
  readonly total: number;
  readonly width: number;
  readonly height: number;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  time(): number;
  playing(): boolean;
  setSpeed(x: number): void;
  onFinish(fn: () => void): void;
  destroy(): void;
}

/** A recording file as VaultSnip writes it, or a bare rrweb event array. */
export function readRecording(json: unknown): RrEvent[] {
  const events = Array.isArray(json) ? json : (json as { events?: unknown })?.events;
  if (!Array.isArray(events) || !events.every((e) => e && typeof e === 'object' && typeof e.type === 'number' && typeof e.timestamp === 'number')) {
    throw new Error('This file is not a VaultSnip or rrweb recording.');
  }
  return events as RrEvent[];
}

/** Cleans and audits: returns events safe to play, or the findings that stop it. */
export function prepare(raw: readonly RrEvent[]): { events: RrEvent[]; findings: Finding[] } {
  const events = sanitizeEvents(raw);
  return { events, findings: auditEvents(events) };
}

let cssDone = false;
export function mount(root: HTMLElement, events: RrEvent[]): Player {
  if (!cssDone) {
    const s = document.createElement('style');
    s.textContent = rrwebCss;
    document.head.appendChild(s);
    cssDone = true;
  }
  root.innerHTML = '';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;transform-origin:0 0;';
  root.appendChild(stage);
  const r = new Replayer(events as never, {
    root: stage, mouseTail: false, UNSAFE_replayCanvas: false, showWarning: false, skipInactive: true, triggerFocus: false,
  });
  const meta = events.find((e) => e.type === 4)?.data ?? { width: 1280, height: 800 };
  const fit = () => {
    const k = Math.min(1, root.clientWidth / meta.width);
    stage.style.transform = `scale(${k})`;
    root.style.height = `${Math.round(meta.height * k)}px`;
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(root);
  // rrweb's getCurrentTime() is only meaningful while playing, so the paused position is tracked here.
  const total = r.getMetaData().totalTime;
  const clamp = (ms: number) => Math.max(0, Math.min(total, ms));
  let isPlaying = false;
  let at = 0;
  const finish: (() => void)[] = [];
  r.on('finish', () => { isPlaying = false; at = total; finish.forEach((f) => f()); });
  return {
    total,
    width: meta.width,
    height: meta.height,
    play() { if (at >= total) at = 0; r.play(at); isPlaying = true; },
    pause() { at = clamp(r.getCurrentTime()); r.pause(); isPlaying = false; },
    seek(ms) { at = clamp(ms); r.pause(at); isPlaying = false; },
    time: () => (isPlaying ? clamp(r.getCurrentTime()) : at),
    playing: () => isPlaying,
    setSpeed(x) { r.setConfig({ speed: x }); },
    onFinish(fn) { finish.push(fn); },
    destroy() { ro.disconnect(); r.destroy(); root.innerHTML = ''; },
  };
}

/** A single HTML file that plays the recording offline: this bundle and the events inline, nothing fetched. */
export function standaloneHtml(events: RrEvent[], playerSource: string, title = 'VaultSnip masked replay'): string {
  const safe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const data = JSON.stringify(events).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${title}</title>
<style>body{margin:0;font:14px system-ui,sans-serif;background:#f4f5f7;color:#14181e}header{padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
#stage{margin:0 16px 16px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);overflow:hidden}button{font:inherit;padding:6px 12px}input[type=range]{flex:1;min-width:160px}
small{color:#5b6472}</style></head><body>
<header><b>Masked replay</b><button id="pp" type="button">Play</button><input id="seek" type="range" min="0" value="0" aria-label="Position"><span id="t">0:00</span>
<small>Text masked on the recording device with VaultSnip. Plays offline; nothing is fetched.</small></header><div id="stage"></div>
<script>${safe(playerSource)}</script>
<script>(function(){var ev=${data};var p=VSReplay.mount(document.getElementById('stage'),ev);var pp=document.getElementById('pp'),sk=document.getElementById('seek'),t=document.getElementById('t');
sk.max=p.total;var f=function(ms){var s=Math.round(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
pp.onclick=function(){if(p.playing()){p.pause();pp.textContent='Play'}else{p.play();pp.textContent='Pause'}};
sk.oninput=function(){p.seek(+sk.value);pp.textContent='Play'};p.onFinish(function(){pp.textContent='Play'});
(function loop(){sk.value=p.time();t.textContent=f(p.time())+' / '+f(p.total);requestAnimationFrame(loop)})();})();</script></body></html>`;
}
