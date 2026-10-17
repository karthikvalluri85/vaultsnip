import { describe, expect, it } from 'vitest';
import { createMlHandler } from '../../src/background/ml-handler';
import { installNetworkGuard, BlockedRequestError } from '../../src/background/network-guard';
import { emptyScores, packLines, personOrg } from '../../src/background/ner-encode';
import type { MlResponse, WordScore } from '../../src/background/ml-protocol';
import type { NerScorer } from '../../src/background/ner-model';

describe('ML worker request handler', () => {
  it('runs requests one at a time, in arrival order, even when they arrive together', async () => {
    let running = 0, maxRunning = 0;
    const order: string[] = [];
    const scorer: NerScorer = {
      async score(lines) {
        running++; maxRunning = Math.max(maxRunning, running);
        order.push(lines[0][0]);
        await new Promise((r) => setTimeout(r, 5 - lines.length));
        running--;
        return emptyScores(lines);
      },
    };
    const out: MlResponse[] = [];
    const handle = createMlHandler(async () => scorer, (r) => out.push(r));
    await Promise.all(['a', 'b', 'c', 'd'].map((w, i) => handle({ id: i + 1, type: 'score', lines: [[w]] })));
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('loads the model once for many requests', async () => {
    let loads = 0;
    const handle = createMlHandler(async () => { loads++; return { score: async (l) => emptyScores(l) }; }, () => {});
    await Promise.all([1, 2, 3].map((id) => handle({ id, type: 'score', lines: [['x']] })));
    expect(loads).toBe(1);
  });

  it('reports a failed load to that request and retries on the next one', async () => {
    let loads = 0;
    const out: MlResponse[] = [];
    const handle = createMlHandler(async () => {
      if (++loads === 1) throw new Error('model file missing');
      return { score: async (l) => emptyScores(l) };
    }, (r) => out.push(r));
    await handle({ id: 1, type: 'warmup' });
    await handle({ id: 2, type: 'score', lines: [['x']] });
    expect(out).toEqual([
      { id: 1, ok: false, error: 'model file missing' },
      { id: 2, ok: true, scores: [[[0, 0]]] },
    ]);
  });

  it('keeps serving after one request throws', async () => {
    const out: MlResponse[] = [];
    const handle = createMlHandler(async () => ({
      async score(lines) { if (lines[0][0] === 'bad') throw new Error('boom'); return emptyScores(lines); },
    }), (r) => out.push(r));
    handle({ id: 1, type: 'score', lines: [['bad']] });
    await handle({ id: 2, type: 'score', lines: [['ok']] });
    expect(out.map((r) => r.ok)).toEqual([false, true]);
  });
});

describe('network guard', () => {
  const origin = 'chrome-extension://abcdefghijklmnop';
  const scope = () => {
    const calls: string[] = [];
    const s = { fetch: (async (u: any) => { calls.push(String(u)); return new Response('ok'); }) as typeof fetch };
    return { s, calls };
  };

  it('lets the worker fetch its own files', async () => {
    const { s, calls } = scope();
    installNetworkGuard(s, origin);
    await s.fetch(`${origin}/models/tinybert-ner/config.json`);
    await s.fetch('blob:chrome-extension://abcdefghijklmnop/1234');
    expect(calls).toHaveLength(2);
  });

  it('blocks Hugging Face, CDNs and any other origin, and records them', async () => {
    const { s, calls } = scope();
    const blocked = installNetworkGuard(s, origin);
    for (const u of ['https://huggingface.co/x/resolve/main/config.json', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/x.wasm', new URL('https://evil.example/?q=May%20Chen')]) {
      await expect(s.fetch(u as any)).rejects.toBeInstanceOf(BlockedRequestError);
    }
    await expect(s.fetch(new Request('https://api.example/collect'))).rejects.toBeInstanceOf(BlockedRequestError);
    expect(calls).toHaveLength(0);
    expect(blocked).toHaveLength(4);
  });

  it('blocks XMLHttpRequest to other origins', () => {
    const opened: string[] = [];
    class XHR { open(_m: string, u: string) { opened.push(u); } }
    const s = { fetch: (async () => new Response()) as typeof fetch, XMLHttpRequest: XHR };
    installNetworkGuard(s, origin);
    new XHR().open('GET', `${origin}/ml/x.wasm`);
    expect(() => new XHR().open('GET', 'https://huggingface.co/x')).toThrow(BlockedRequestError);
    expect(opened).toEqual([`${origin}/ml/x.wasm`]);
  });

  it('does not treat other opaque origins as its own', async () => {
    const { s, calls } = scope();
    installNetworkGuard(s, origin);
    for (const u of ['chrome-extension://otherextensionid/x', 'data:text/plain,May Chen', 'file:///etc/passwd', 'http://abcdefghijklmnop/x']) {
      await expect(s.fetch(u)).rejects.toBeInstanceOf(BlockedRequestError);
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses to start without a real origin', () => {
    expect(() => installNetworkGuard(scope().s, 'null')).toThrow();
  });
});

describe('NER encoding', () => {
  // Fake tokenizer: one token per 3 letters, ids from char codes.
  const enc = (w: string) => Array.from({ length: Math.ceil(w.length / 3) }, (_, i) => 1000 + w.charCodeAt(i * 3));

  it('records the first sub-token of every word', () => {
    const rows = packLines([['Kestrelmoor', 'is', 'late']], enc, 101, 102);
    expect(rows).toHaveLength(1);
    expect(rows[0].ids[0]).toBe(101);
    expect(rows[0].ids.at(-1)).toBe(102);
    expect(rows[0].words).toEqual([{ line: 0, word: 0, pos: 1 }, { line: 0, word: 1, pos: 5 }, { line: 0, word: 2, pos: 6 }]);
  });

  it('continues a line that is too long in a new row, never splitting a word', () => {
    const line = Array.from({ length: 10 }, () => 'abcdef'); // 2 tokens each
    const rows = packLines([line], enc, 101, 102, 8);         // room for 6 tokens = 3 words per row
    expect(rows.map((r) => r.words.length)).toEqual([3, 3, 3, 1]);
    expect(rows.every((r) => r.ids.length <= 8)).toBe(true);
    expect(rows.flatMap((r) => r.words.map((w) => w.word))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('cuts a single word longer than a row, and skips words with no tokens', () => {
    const rows = packLines([['x'.repeat(60), '', 'ok']], enc, 101, 102, 8);
    expect(rows.every((r) => r.ids.length <= 8)).toBe(true);
    expect(rows.flatMap((r) => r.words.map((w) => w.word))).toEqual([0, 2]);
  });

  it('folds B-/I- probabilities into person and organisation', () => {
    const logits = [0, Math.log(2), Math.log(2), Math.log(3), 0, 0, 0, 0, 0]; // O, B-PER, I-PER, B-ORG, I-ORG, …
    const [per, org] = personOrg(logits, 0) as WordScore;
    const sum = 1 + 2 + 2 + 3 + 1 + 4;
    expect(per).toBeCloseTo(4 / sum);
    expect(org).toBeCloseTo(4 / sum);
  });
});
