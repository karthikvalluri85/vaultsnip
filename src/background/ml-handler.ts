/**
 * Request handling inside the ML worker, kept apart from the worker globals so it can be tested.
 *
 * Requests run one at a time in arrival order: an ONNX session is not safe to run concurrently, and a
 * long page must not starve a later one. Each model loads on its first request, so the name check never pays for
 * the text detector or the other way round; if loading fails, that request gets the error and the next one tries again.
 */
import type { MlRequest, MlResponse, Pixels } from './ml-protocol';
import type { NerScorer } from './ner-model';
import type { Region } from '../shared/text-regions';

export interface TextDetector {
  detect(image: Pixels): Promise<Region[]>;
}

export interface TextReader {
  read(line: Pixels): Promise<{ text: string; conf: number }>;
}

export interface Loaders {
  ner: () => Promise<NerScorer>;
  detector?: () => Promise<TextDetector>;
  reader?: () => Promise<TextReader>;
}

const lazy = <T>(load: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= load().catch((e) => { p = null; throw e; }));
};

export function createMlHandler(loaders: Loaders | (() => Promise<NerScorer>), post: (r: MlResponse) => void) {
  const l: Loaders = typeof loaders === 'function' ? { ner: loaders } : loaders;
  const ner = lazy(l.ner);
  const detector = l.detector ? lazy(l.detector) : null;
  const reader = l.reader ? lazy(l.reader) : null;
  let queue: Promise<void> = Promise.resolve();

  async function run(req: MlRequest): Promise<void> {
    try {
      if (req.type === 'read') {
        if (!reader) throw new Error('this worker has no text reader');
        post({ id: req.id, ok: true, reading: await (await reader()).read(req.image) });
        return;
      }
      if (req.type === 'detect') {
        if (!detector) throw new Error('this worker has no text detector');
        post({ id: req.id, ok: true, regions: await (await detector()).detect(req.image) });
        return;
      }
      const s = await ner();
      if (req.type === 'warmup') post({ id: req.id, ok: true });
      else post({ id: req.id, ok: true, scores: await s.score(req.lines) });
    } catch (e) {
      post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (req: MlRequest): Promise<void> => (queue = queue.then(() => run(req)));
}
