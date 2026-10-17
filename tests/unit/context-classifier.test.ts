import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextClassifier, contextualHits, type LineWord, type WorkerLike, type WordScore } from '../../src/content/context-classifier';
import type { MlRequest, MlResponse } from '../../src/background/ml-protocol';

/** In-memory stand-in for the ML worker: the test decides when, and in what order, it answers. */
class FakeWorker implements WorkerLike {
  sent: MlRequest[] = [];
  terminated = false;
  private on: Record<string, ((e: any) => void)[]> = {};
  postMessage(m: MlRequest) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  addEventListener(type: string, fn: (e: any) => void) { (this.on[type] ??= []).push(fn); }
  reply(r: MlResponse) { this.on.message?.forEach((f) => f({ data: r })); }
  crash() { this.on.error?.forEach((f) => f(new Event('error'))); }
  /** Answers a score request with a fixed score per word. */
  answer(req: MlRequest, s: WordScore = [0.1, 0.2]) {
    if (req.type !== 'score') throw new Error('not a score request');
    this.reply({ id: req.id, ok: true, scores: req.lines.map((l) => l.map(() => s)) });
  }
}

describe('ContextClassifier (worker message passing)', () => {
  let workers: FakeWorker[];
  let client: ContextClassifier;
  beforeEach(() => {
    workers = [];
    client = new ContextClassifier(() => { const w = new FakeWorker(); workers.push(w); return w; }, { timeoutMs: 1000 });
  });
  afterEach(() => { client.dispose(); vi.useRealTimers(); });

  it('starts one worker lazily and reuses it', async () => {
    expect(workers).toHaveLength(0);
    const a = client.score([['a']]);
    const b = client.score([['b']]);
    expect(workers).toHaveLength(1);
    workers[0].sent.forEach((r) => workers[0].answer(r));
    await Promise.all([a, b]);
    expect(workers).toHaveLength(1);
  });

  it('matches answers to requests by id when the worker answers out of order', async () => {
    const calls = [client.score([['one']]), client.score([['two', 'words']]), client.score([['three']])];
    const [r1, r2, r3] = workers[0].sent;
    workers[0].answer(r3, [0.3, 0]);
    workers[0].answer(r1, [0.1, 0]);
    workers[0].answer(r2, [0.2, 0]);
    const [a, b, c] = await Promise.all(calls);
    expect(a).toEqual([[[0.1, 0]]]);
    expect(b).toEqual([[[0.2, 0], [0.2, 0]]]);
    expect(c).toEqual([[[0.3, 0]]]);
  });

  it('keeps 50 concurrent requests apart', async () => {
    const calls = Array.from({ length: 50 }, (_, i) => client.score([Array.from({ length: i + 1 }, () => 'w')]));
    const sent = [...workers[0].sent].sort(() => Math.random() - 0.5);
    sent.forEach((r) => workers[0].answer(r, [r.id / 100, 0]));
    const results = await Promise.all(calls);
    results.forEach((r, i) => {
      expect(r[0]).toHaveLength(i + 1);
      expect(r[0][0][0]).toBe(workers[0].sent[i].id / 100);
    });
    expect(new Set(workers[0].sent.map((r) => r.id)).size).toBe(50);
  });

  it('rejects only the request the worker reports an error for', async () => {
    const good = client.score([['a']]);
    const bad = client.score([['b']]);
    const [r1, r2] = workers[0].sent;
    workers[0].reply({ id: r2.id, ok: false, error: 'model failed' });
    workers[0].answer(r1);
    await expect(bad).rejects.toThrow('model failed');
    await expect(good).resolves.toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
  });

  it('rejects a reply whose shape does not match the lines sent', async () => {
    const p = client.score([['a', 'b']]);
    workers[0].reply({ id: workers[0].sent[0].id, ok: true, scores: [[[0, 0]]] });
    await expect(p).rejects.toThrow('do not match');
  });

  it('on a crash rejects every waiting request, and the next request starts a new worker', async () => {
    const a = client.score([['a']]);
    const b = client.score([['b']]);
    workers[0].crash();
    await expect(a).rejects.toThrow('crashed');
    await expect(b).rejects.toThrow('crashed');
    expect(workers[0].terminated).toBe(true);
    const c = client.score([['c']]);
    expect(workers).toHaveLength(2);
    workers[1].answer(workers[1].sent[0]);
    await expect(c).resolves.toHaveLength(1);
  });

  it('treats a request with no answer as a hung worker and restarts it', async () => {
    vi.useFakeTimers();
    const a = client.score([['a']]);
    const check = expect(a).rejects.toThrow('did not answer within 1000 ms');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(workers[0].terminated).toBe(true);
    client.score([['b']]).catch(() => {});
    expect(workers).toHaveLength(2);
  });

  it('ignores a late answer from a worker that was already replaced', async () => {
    const a = client.score([['a']]);
    const old = workers[0];
    old.crash();
    await expect(a).rejects.toThrow();
    const b = client.score([['b']]);
    old.answer(old.sent[0]);           // stale: its listener's request is gone
    workers[1].answer(workers[1].sent[0], [0.9, 0]);
    await expect(b).resolves.toEqual([[[0.9, 0]]]);
  });

  it('cancels one request with an AbortSignal without touching the others', async () => {
    const ctl = new AbortController();
    const a = client.score([['a']], ctl.signal);
    const b = client.score([['b']]);
    ctl.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    workers[0].sent.forEach((r) => workers[0].answer(r));
    await expect(b).resolves.toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
  });

  it('does not start a worker for an empty page', async () => {
    await expect(client.score([])).resolves.toEqual([]);
    expect(workers).toHaveLength(0);
  });
});

describe('contextualHits (which kept words the model may mask)', () => {
  const words = (s: string, kept: (w: string) => boolean = () => true): LineWord[] => s.split(' ').map((text) => ({ text, kept: kept(text) }));
  const sc = (...ent: number[]): WordScore[] => ent.map((e) => [e, 0]);

  it('masks a kept word the model is sure is a name', () => {
    expect(contextualHits(words('Owner: May Chen', (w) => w !== 'Chen'), sc(0, 0.93, 0.95))).toEqual([1]);
  });
  it('counts organisation and person together', () => {
    expect(contextualHits(words('Account Delta Airlines'), [[0, 0], [0.01, 0.95], [0, 0.9]])).toEqual([1, 2]);
  });
  it('never touches a word the rules already masked or the user marked safe', () => {
    expect(contextualHits(words('Max Weber approved', (w) => w === 'approved'), sc(0.97, 0.97, 0.99))).toEqual([]);
  });
  it('uses the lower bar only when a neighbour is also a likely name', () => {
    expect(contextualHits(words('June Park leads'), sc(0.6, 0.55, 0))).toEqual([0, 1]);
    expect(contextualHits(words('June revenue grew'), sc(0.6, 0, 0))).toEqual([]);
  });
  it('skips acronyms, lower-case words and words without letters', () => {
    expect(contextualHits(words('EMEA APAC churn 2024'), sc(0.95, 0.95, 0.99, 0.99))).toEqual([]);
  });
  it('needs at least two words of context', () => {
    expect(contextualHits(words('Max'), sc(0.96))).toEqual([]);
    expect(contextualHits(words('Max 12'), sc(0.96, 0))).toEqual([]);
  });
  it('reads past punctuation around a word', () => {
    expect(contextualHits(words('accounts: "Target," Walmart'), sc(0, 0.9, 0.9))).toEqual([1, 2]);
  });
});
