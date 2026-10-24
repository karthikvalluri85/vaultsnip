/**
 * Contextual fallback (Feature 2): page-side client for the ML worker, and the rules that turn its scores
 * into masks.
 *
 * The rules in classify() already mask every word that is not on the allowlist. The model is a second
 * opinion on words the rules KEEP: an allowlisted word used as a name ("May Chen", "Target Corporation",
 * "Delta Airlines") or a name inside comment text. It can only add masks. If the worker fails, the caller
 * keeps the rules' result.
 */
import type { MlRequest, MlResponse, Pixels, WordScore } from '../background/ml-protocol';
import type { Region } from '../shared/text-regions';

export { detectorSize, flatMarksOnly, isBar, isShapes, unreadParts, type Box, type Region } from '../shared/text-regions';

export type { Pixels, WordScore };
export const CONTEXT_TYPE = 'Name in context';
export const UNREAD_TYPE = 'Unread text';

/** The subset of Worker the client uses; tests pass a fake. */
export interface WorkerLike {
  postMessage(msg: MlRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<MlResponse>) => void): void;
  addEventListener(type: 'error' | 'messageerror', fn: (e: Event) => void): void;
}

export interface ClientOptions {
  /** A request still unanswered after this long counts as a hung worker. Default 30 s. */
  timeoutMs?: number;
}

/** MlRequest without its id, kept per variant (a plain Omit would merge the union and drop `lines`). */
type RequestBody = MlRequest extends infer R ? (R extends MlRequest ? Omit<R, 'id'> : never) : never;

/** What a successful answer carries. */
type Answer = Extract<MlResponse, { ok: true }>;

interface Pending {
  resolve(answer: Answer): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Many callers may score at once; responses are matched to requests by id, so the worker may answer
 * in any order. A hung or crashed worker is terminated, every waiting request is rejected, and the
 * next request starts a fresh worker.
 */
export class ContextClassifier {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly timeoutMs: number;

  constructor(private readonly spawn: () => WorkerLike, opts: ClientOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Loads the model ahead of the first scan. */
  warmup(): Promise<void> {
    return this.request({ type: 'warmup' }).then(() => undefined);
  }

  /** One [P(person), P(organisation)] pair per word, shaped like `lines`. */
  async score(lines: string[][], signal?: AbortSignal): Promise<WordScore[][]> {
    if (lines.length === 0) return [];
    const { scores } = await this.request({ type: 'score', lines }, signal);
    if (!scores || scores.length !== lines.length || scores.some((s, i) => s.length !== lines[i].length)) {
      throw new Error('ML worker returned scores that do not match the lines sent');
    }
    return scores;
  }

  /**
   * Boxes around the text in an image, in its pixels. The image must already be at the detector's input size
   * (detectorSize); its pixels are transferred to the worker, so the caller must not use them afterwards.
   */
  async detect(image: Pixels, signal?: AbortSignal): Promise<Region[]> {
    const { regions } = await this.request({ type: 'detect', image }, signal, [image.data.buffer]);
    if (!Array.isArray(regions)) throw new Error('ML worker returned no text regions');
    return regions;
  }

  /** One straightened line of text read by the second-look reader. Its pixels are transferred to the worker. */
  async read(image: Pixels, signal?: AbortSignal): Promise<{ text: string; conf: number }> {
    const { reading } = await this.request({ type: 'read', image }, signal, [image.data.buffer]);
    if (!reading) throw new Error('ML worker returned no reading');
    return reading;
  }

  dispose(): void {
    this.reset(new Error('Contextual scanner was closed'));
  }

  private request(body: RequestBody, signal?: AbortSignal, transfer: Transferable[] = []): Promise<Answer> {
    if (signal?.aborted) return Promise.reject(abortError());
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset(new Error(`ML worker did not answer within ${this.timeoutMs} ms`)), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      // An aborted request is dropped here; the worker still finishes it and its answer is ignored.
      signal?.addEventListener('abort', () => this.settle(id, (p) => p.reject(abortError())), { once: true });
      worker.postMessage({ ...body, id } as MlRequest, transfer);
    });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.spawn();
    w.addEventListener('message', (e: MessageEvent<MlResponse>) => {
      const r = e.data;
      this.settle(r.id, (p) => (r.ok ? p.resolve(r) : p.reject(new Error(r.error))));
    });
    const crash = (what: string) => () => { if (this.worker === w) this.reset(new Error(what)); };
    w.addEventListener('error', crash('ML worker crashed'));
    w.addEventListener('messageerror', crash('ML worker sent an unreadable message'));
    return (this.worker = w);
  }

  private settle(id: number, fn: (p: Pending) => void): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    fn(p);
  }

  private reset(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}

function abortError(): Error {
  const e = new Error('Contextual scan was cancelled');
  e.name = 'AbortError';
  return e;
}

/** Default worker for the app page: the bundle that `npm run build:ml` writes to public/ml/. */
export const moduleWorker = (url: string | URL) => (): WorkerLike =>
  new Worker(url, { type: 'module' }) as unknown as WorkerLike;

/* ---------------- deciding what to mask ---------------- */

export interface LineWord {
  text: string;
  /** True when the rules left this word readable and the user has not marked it safe. */
  kept: boolean;
}

export interface Thresholds {
  /** P(person)+P(organisation) at which a word is masked on its own. */
  strong: number;
  /** Lower bar for a word whose neighbour also reaches it: a two-word name like "June Park". */
  weak: number;
}

/**
 * Picked on dashboard-style lines with the 14.5 MB TinyBERT model: 0.8 catches "May Chen" (0.93),
 * "Max Weber" (0.97), "Target Corporation" (0.87) and "Delta Airlines" (0.95), while "Delta vs last year"
 * (0.74) and "Max latency p95" (0.65) stay readable.
 */
export const DEFAULT_THRESHOLDS: Thresholds = { strong: 0.8, weak: 0.5 };

const core = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const hasLetter = (t: string) => /\p{L}/u.test(t);
/** "EMEA", "APAC", "KPI": the model reads these as organisations, but on a dashboard they are labels. */
const isAcronym = (c: string) => c.length >= 2 && /^\p{Lu}[\p{Lu}\d&.]*$/u.test(c);

/**
 * Indexes of words in one line that the model says are a person or organisation and the rules kept.
 * Only capitalised, non-acronym words qualify, and only on lines with at least two words: a lone "Max"
 * in a table cell gives the model no context to tell a name from a column label.
 */
export function contextualHits(line: readonly LineWord[], scores: readonly WordScore[], t: Thresholds = DEFAULT_THRESHOLDS): number[] {
  if (line.filter((w) => hasLetter(w.text)).length < 2) return [];
  const ent = scores.map(([per, org]) => per + org);
  const hits: number[] = [];
  line.forEach((w, i) => {
    if (!w.kept) return;
    const c = core(w.text);
    if (!/^\p{Lu}/u.test(c) || isAcronym(c)) return;
    const neighbour = Math.max(ent[i - 1] ?? 0, ent[i + 1] ?? 0);
    if (ent[i] >= t.strong || (ent[i] >= t.weak && neighbour >= t.weak)) hits.push(i);
  });
  return hits;
}
