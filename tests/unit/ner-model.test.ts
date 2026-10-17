// Real-model tests for the on-device name check (Feature 2), with the committed model in web/models.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { contextualHits } from '../../src/content/context-classifier';
import { MODEL_ID } from '../../src/background/ml-protocol';
import type { NerScorer } from '../../src/background/ner-model';

const committed = fileURLToPath(new URL(`../../web/models/${MODEL_ID}/`, import.meta.url));
const present = existsSync(join(committed, 'onnx/model_quantized.onnx.gz'));
const PINNED_ONNX = 'b227845ff4989c9f7383874b841895dfbdb9a4d7a20ceb39c3f187271894bf2a';

describe.skipIf(!present)('PII model (real, local files only)', () => {
  let scorer: NerScorer;
  const fetchSpy = vi.fn();
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // Node's transformers.js reads plain files, so the gzipped weights are unpacked into a temp folder.
    const models = mkdtempSync(join(tmpdir(), 'vs-model-'));
    const dir = join(models, MODEL_ID);
    cpSync(committed, dir, { recursive: true });
    const onnx = gunzipSync(readFileSync(join(committed, 'onnx/model_quantized.onnx.gz')));
    expect(createHash('sha256').update(onnx).digest('hex'), 'committed model differs from the pinned revision').toBe(PINNED_ONNX);
    mkdirSync(join(dir, 'onnx'), { recursive: true });
    writeFileSync(join(dir, 'onnx/model_quantized.onnx'), onnx);

    globalThis.fetch = ((...a: Parameters<typeof fetch>) => { fetchSpy(String(a[0])); return Promise.reject(new Error('network used')); }) as typeof fetch;
    const { useLocalFilesOnly, loadNerScorer } = await import('../../src/background/ner-model');
    useLocalFilesOnly({ models: models + '/' });
    scorer = await loadNerScorer();
  }, 60_000);
  afterAll(() => { globalThis.fetch = realFetch; });

  const hits = async (line: string) => {
    const words = line.split(' ');
    const [scores] = await scorer.score([words]);
    return contextualHits(words.map((text) => ({ text, kept: true })), scores).map((i) => words[i].replace(/\W/g, ''));
  };

  // Safe words used as names: the case the rules cannot see.
  it.each([
    ['Owner: May Chen', 'May'],
    ['Max Weber approved the budget', 'Max'],
    ['Account Delta Airlines', 'Delta'],
    ['June Park leads the APAC team', 'June'],
  ])('masks "%s" → %s', async (line, word) => {
    expect(await hits(line)).toContain(word);
  });

  // The same words as ordinary dashboard labels must stay readable.
  // Known misses, for the record (P(person)+P(org) of the safe word): "Customer Target Corporation" (0.04),
  // "Top accounts: Target, Walmart, Costco" (0.02), "Escalated to June Park" (June 0.30).
  it.each([
    'Revenue by Month', 'May 2024', 'Target vs Actual', 'Delta vs last year', 'Max latency p95', 'Sales Target',
    'Q1 Target', 'EMEA APAC LATAM', 'Region Status Owner', 'Churn Rate', 'Open Tickets by Priority',
    'Customer Satisfaction Score', 'Paid Search Organic Social', 'Weekly Active Users', 'Max', 'Delta', 'June',
  ])('keeps "%s"', async (line) => {
    expect(await hits(line)).toEqual([]);
  });

  it('scores a 200-line page in one call, with results shaped like the input', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Row ${i} Owner May Chen Revenue ${i * 3}`.split(' '));
    const t0 = performance.now();
    const scores = await scorer.score(lines);
    const ms = performance.now() - t0;
    expect(scores).toHaveLength(200);
    scores.forEach((s, i) => expect(s).toHaveLength(lines[i].length));
    console.log(`200 lines scored in ${ms.toFixed(0)} ms`);
  });

  it('never touched the network', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
