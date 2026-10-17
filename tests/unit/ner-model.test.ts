// Real-model tests for the contextual fallback (Feature 2). Skipped until `npm run fetch:model` has run.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { contextualHits } from '../../src/content/context-classifier';
import { MODEL_ID } from '../../src/background/ml-protocol';
import type { NerScorer } from '../../src/background/ner-model';

const models = fileURLToPath(new URL('../../public/models/', import.meta.url));
const present = existsSync(`${models}${MODEL_ID}/onnx/model_quantized.onnx`);

describe.skipIf(!present)('NER model (real, local files only)', () => {
  let scorer: NerScorer;
  const fetchSpy = vi.fn();
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => { fetchSpy(String(a[0])); return Promise.reject(new Error('network used')); }) as typeof fetch;
    const { useLocalFilesOnly, loadNerScorer } = await import('../../src/background/ner-model');
    useLocalFilesOnly({ models });
    scorer = await loadNerScorer();
  }, 60_000);
  afterAll(() => { globalThis.fetch = realFetch; });

  const hits = async (line: string) => {
    const words = line.split(' ');
    const [scores] = await scorer.score([words]);
    return contextualHits(words.map((text) => ({ text, kept: true })), scores).map((i) => words[i].replace(/\W/g, ''));
  };

  // Allowlisted words used as names: the case the rules cannot see.
  it.each([
    ['Owner: May Chen', 'May'],
    ['Max Weber approved the budget', 'Max'],
    ['Customer Target Corporation', 'Target'],
    ['Account Delta Airlines', 'Delta'],
  ])('masks "%s" → %s', async (line, word) => {
    expect(await hits(line)).toContain(word);
  });

  // The same words as ordinary dashboard labels must stay readable.
  // Known misses of this model, for the record (P(person)+P(org) of the allowlisted word):
  // "Top accounts: Target, Walmart, Costco" (0.30), "Delta Air Lines renewal" (0.42),
  // "June Park leads the APAC team" (June 0.61, Park 0.07), "Escalated to June Park" (0.01).
  it.each([
    'Revenue by Month', 'May 2024', 'Target vs Actual', 'Delta vs last year', 'Max latency p95', 'Sales Target',
    'Q1 Target', 'EMEA APAC LATAM', 'Region Status Owner', 'Churn Rate', 'Open Tickets by Priority',
    'Customer Satisfaction Score', 'Paid Search Organic Social', 'Weekly Active Users', 'Max', 'Delta',
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
