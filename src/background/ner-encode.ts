/**
 * Pure tokenisation helpers for the NER model. No model or library imports, so they are unit-tested directly.
 *
 * Each OCR word is tokenised on its own and its label is read from its FIRST sub-token (the CoNLL convention).
 * This keeps word ↔ token alignment exact: transformers.js's token-classification pipeline returns no
 * character offsets, so its grouped entities cannot be mapped back to OCR boxes reliably.
 */
import type { WordScore } from './ml-protocol';

/** Label indexes that count as a person or an organisation, from the model's config. */
export interface LabelGroups { per: number[]; org: number[]; size: number }

/** Reads B-/I- person and organisation labels from id2label ("B-PERSON", "I-ORGANIZATION", "B-PER", …). */
export function labelGroups(id2label: Record<string | number, string>): LabelGroups {
  const per: number[] = [], org: number[] = [];
  let size = 0;
  for (const [k, v] of Object.entries(id2label)) {
    const i = Number(k);
    size = Math.max(size, i + 1);
    const tag = String(v).replace(/^[BIES]-/, '').toUpperCase();
    if (tag === 'PERSON' || tag === 'PER') per.push(i);
    else if (tag === 'ORGANIZATION' || tag === 'ORG') org.push(i);
  }
  if (!per.length || !org.length) throw new Error('model has no person/organisation labels');
  return { per, org, size };
}

export interface Row {
  ids: number[];
  /** For each word in this row: where its score goes, and the position of its first sub-token in `ids`. */
  words: { line: number; word: number; pos: number }[];
}

/**
 * Packs lines into model rows of at most `maxLen` tokens ([CLS] … [SEP] included).
 * A line longer than that continues in the next row; a single word longer than that is cut.
 * Words with no tokens (empty after tokenisation) get no entry and keep a zero score.
 */
export function packLines(
  lines: readonly (readonly string[])[],
  encode: (word: string) => number[],
  cls: number,
  sep: number,
  maxLen = 512,
): Row[] {
  const rows: Row[] = [];
  const room = maxLen - 2;
  lines.forEach((line, li) => {
    let row: Row = { ids: [cls], words: [] };
    line.forEach((text, wi) => {
      let pieces = encode(text);
      if (pieces.length === 0) return;
      if (pieces.length > room) pieces = pieces.slice(0, room);
      if (row.ids.length - 1 + pieces.length > room) {
        row.ids.push(sep);
        rows.push(row);
        row = { ids: [cls], words: [] };
      }
      row.words.push({ line: li, word: wi, pos: row.ids.length });
      row.ids.push(...pieces);
    });
    if (row.words.length) {
      row.ids.push(sep);
      rows.push(row);
    }
  });
  return rows;
}

/** Empty score grid shaped like `lines`. */
export function emptyScores(lines: readonly (readonly string[])[]): WordScore[][] {
  return lines.map((l) => l.map((): WordScore => [0, 0]));
}

/** Softmax of one token's logits, folded to [P(person), P(organisation)] (B- and I- labels together). */
export function personOrg(logits: ArrayLike<number>, offset: number, g: LabelGroups): WordScore {
  let max = -Infinity;
  for (let k = 0; k < g.size; k++) max = Math.max(max, logits[offset + k]);
  let sum = 0;
  const e = new Array<number>(g.size);
  for (let k = 0; k < g.size; k++) sum += e[k] = Math.exp(logits[offset + k] - max);
  const total = (idx: number[]) => idx.reduce((s, i) => s + e[i], 0) / sum;
  return [total(g.per), total(g.org)];
}
