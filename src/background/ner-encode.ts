/**
 * Pure tokenisation helpers for the NER model. No model or library imports, so they are unit-tested directly.
 *
 * Each OCR word is tokenised on its own and its label is read from its FIRST sub-token (the CoNLL convention).
 * This keeps word ↔ token alignment exact: transformers.js's token-classification pipeline returns no
 * character offsets, so its grouped entities cannot be mapped back to OCR boxes reliably.
 */
import type { WordScore } from './ml-protocol';

/** CoNLL-2003 label order. The model's config only says LABEL_0..LABEL_8; this order was checked on real text. */
export const LABELS = ['O', 'B-PER', 'I-PER', 'B-ORG', 'I-ORG', 'B-LOC', 'I-LOC', 'B-MISC', 'I-MISC'] as const;

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

/** Softmax of one token's logits, folded to [P(B-PER)+P(I-PER), P(B-ORG)+P(I-ORG)]. */
export function personOrg(logits: ArrayLike<number>, offset: number, numLabels = LABELS.length): WordScore {
  let max = -Infinity;
  for (let k = 0; k < numLabels; k++) max = Math.max(max, logits[offset + k]);
  let sum = 0;
  const e = new Array<number>(numLabels);
  for (let k = 0; k < numLabels; k++) sum += e[k] = Math.exp(logits[offset + k] - max);
  return [(e[1] + e[2]) / sum, (e[3] + e[4]) / sum];
}
