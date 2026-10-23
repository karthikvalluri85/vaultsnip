import { describe, expect, it, vi } from 'vitest';
import { createMlHandler } from '../../src/background/ml-handler';
import type { MlResponse } from '../../src/background/ml-protocol';

const image = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) };

describe('ML worker: text detection requests', () => {
  it('a detect request loads only the detector, once', async () => {
    const ner = vi.fn(async () => ({ score: async () => [] }));
    const detect = vi.fn(async () => [{ x: 1, y: 2, w: 3, h: 4 }]);
    const detector = vi.fn(async () => ({ detect }));
    const out: MlResponse[] = [];
    const handle = createMlHandler({ ner, detector }, (r) => out.push(r));
    await handle({ id: 1, type: 'detect', image });
    await handle({ id: 2, type: 'detect', image });
    expect(ner).not.toHaveBeenCalled();
    expect(detector).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ id: 1, ok: true, regions: [{ x: 1, y: 2, w: 3, h: 4 }] }, { id: 2, ok: true, regions: [{ x: 1, y: 2, w: 3, h: 4 }] }]);
  });

  it('a failed detector load is reported and retried on the next request', async () => {
    let calls = 0;
    const detector = async () => { if (calls++ === 0) throw new Error('model missing'); return { detect: async () => [] }; };
    const out: MlResponse[] = [];
    const handle = createMlHandler({ ner: async () => ({ score: async () => [] }), detector }, (r) => out.push(r));
    await handle({ id: 1, type: 'detect', image });
    await handle({ id: 2, type: 'detect', image });
    expect(out).toEqual([{ id: 1, ok: false, error: 'model missing' }, { id: 2, ok: true, regions: [] }]);
  });

  it('a worker without a detector says so instead of hanging', async () => {
    const out: MlResponse[] = [];
    await createMlHandler(async () => ({ score: async () => [] }), (r) => out.push(r))({ id: 7, type: 'detect', image });
    expect(out).toEqual([{ id: 7, ok: false, error: 'this worker has no text detector' }]);
  });
});
