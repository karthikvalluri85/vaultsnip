/**
 * Request handling inside the ML worker, kept apart from the worker globals so it can be tested.
 *
 * Requests run one at a time in arrival order: an ONNX session is not safe to run concurrently, and a
 * long page must not starve a later one. The model loads on the first request; if loading fails, that
 * request gets the error and the next request tries again.
 */
import type { MlRequest, MlResponse } from './ml-protocol';
import type { NerScorer } from './ner-model';

export function createMlHandler(load: () => Promise<NerScorer>, post: (r: MlResponse) => void) {
  let scorer: Promise<NerScorer> | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function run(req: MlRequest): Promise<void> {
    try {
      const s = await (scorer ??= load().catch((e) => { scorer = null; throw e; }));
      if (req.type === 'warmup') post({ id: req.id, ok: true });
      else post({ id: req.id, ok: true, scores: await s.score(req.lines) });
    } catch (e) {
      post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (req: MlRequest): Promise<void> => (queue = queue.then(() => run(req)));
}
