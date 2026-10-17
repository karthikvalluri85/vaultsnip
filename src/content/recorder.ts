/**
 * Session recording with masked text (Feature 4). Records the tab's DOM, clicks, hovers, scrolls and typing
 * with rrweb, only after the user starts it, with a visible badge the whole time. Stop by clicking the badge
 * or running the command again; it also stops after 10 minutes.
 *
 * Privacy: rrweb masks all text and inputs as it records and blocks images, video, canvas and iframes.
 * The events are then cleaned again, deny by default (src/shared/replay-sanitize.ts: attributes, CSS, URL)
 * and audited; only a recording that passes the audit leaves this page, to the extension's replay page.
 * Runs in the content script's isolated world, so the page cannot read or change the recording.
 */
import { record } from 'rrweb';
import { maskText } from '../shared/classify';
import { auditEvents, sanitizeEvents, type RrEvent } from '../shared/replay-sanitize';

const KEY = '__vaultsnipRecorder';
const MAX_MS = 10 * 60 * 1000;
// Chrome refuses extension messages over 64 MiB; a busy live dashboard can pass that within minutes
// (a full snapshot every 15 s), so a recording stops in good time and says why.
export const MAX_BYTES = 40 * 1024 * 1024;

/** Running size of the recorded events (JSON characters); true once `max` is passed. */
export function sizeBudget(max = MAX_BYTES) {
  let total = 0;
  return {
    add(e: unknown): boolean { try { total += JSON.stringify(e).length; } catch { /* not serialisable: not sent either */ } return total > max; },
    get total() { return total; },
  };
}

/** Recording options, exported for tests. */
export const RECORD_OPTIONS = {
  maskAllInputs: true,
  maskInputFn: (text: string) => '*'.repeat(Math.min(text.length, 24)),
  maskTextSelector: '*',
  maskTextFn: (text: string) => maskText(text),
  blockSelector: 'img,picture,video,audio,canvas,iframe,frame,object,embed,svg image,[data-vaultsnip-block]',
  recordCanvas: false,
  collectFonts: false,
  inlineImages: false,
  inlineStylesheet: true,
  recordCrossOriginIframes: false,
  slimDOMOptions: 'all' as const,
  // A fresh snapshot every 15 s picks up styles the page adds through CSSOM, which the isolated world cannot see.
  checkoutEveryNms: 15_000,
  sampling: { mousemove: 50, scroll: 150, input: 'last' as const },
};

export type RecordingMessage = { type: 'vs-recording'; events: RrEvent[]; durationMs: number };

interface State { stop(): void }

function start(): State {
  const events: RrEvent[] = [];
  const t0 = Date.now();
  const host = document.createElement('vaultsnip-recorder');
  host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' }); // not recorded: rrweb records open shadow roots only
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.style.cssText = 'font:12px/1.4 system-ui,sans-serif;background:#b42318;color:#fff;border:0;padding:7px 11px;border-radius:6px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)';
  shadow.appendChild(badge);
  document.documentElement.appendChild(host);
  const tick = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    badge.textContent = `● Recording, text masked · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · click to stop`;
  };
  tick();
  const clock = setInterval(tick, 1000);

  const budget = sizeBudget();
  let full = false;
  let stopped = false;
  const stopRecording = record<RrEvent>({ ...RECORD_OPTIONS, emit: (e) => {
    if (stopped) return;
    events.push(e as RrEvent);
    if (budget.add(e) && !full) { full = true; setTimeout(() => finish(), 0); }
  } });
  const limit = setTimeout(() => finish(), MAX_MS);

  function finish(): void {
    if (stopped) return;
    stopped = true;
    stopRecording?.();
    clearInterval(clock);
    clearTimeout(limit);
    (window as unknown as Record<string, State | undefined>)[KEY] = undefined;
    const clean = sanitizeEvents(events);
    const findings = auditEvents(clean);
    if (findings.length) {
      // Fail closed: nothing leaves the page.
      badge.textContent = `Recording discarded: ${findings.length} item(s) could not be masked. Nothing was saved.`;
      badge.style.background = '#14181e';
      setTimeout(() => host.remove(), 8000);
      console.warn('VaultSnip: recording discarded by the privacy audit', findings.slice(0, 5));
      return;
    }
    badge.textContent = full ? 'Recording stopped at the size limit (busy page). Opening the masked replay…' : 'Opening the masked replay…';
    const msg: RecordingMessage = { type: 'vs-recording', events: clean, durationMs: Date.now() - t0 };
    chrome.runtime.sendMessage(msg).then(
      () => setTimeout(() => host.remove(), full ? 4000 : 1500),
      (e: unknown) => {
        // never fail silently: say what happened; nothing was saved anywhere
        badge.textContent = `The replay could not be opened (${e instanceof Error ? e.message : String(e)}). Nothing was saved. Try a shorter recording.`;
        badge.style.background = '#14181e';
        setTimeout(() => host.remove(), 10000);
      },
    );
  }

  badge.onclick = finish;
  return { stop: finish };
}

/** Entry point: the background injects this file; running it again stops the recording. */
export function toggle(): void {
  const w = window as unknown as Record<string, State | undefined>;
  const prev = w[KEY];
  if (prev) prev.stop();
  else w[KEY] = start();
}
