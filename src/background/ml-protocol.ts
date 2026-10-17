/**
 * Messages between the app page and the ML worker (Feature 2).
 *
 * The page sends OCR lines as arrays of words; the worker answers with one score pair per word, in the
 * same shape. Words go in already split, so results map back to OCR boxes by index, never by string search.
 */

/** Folder under the models base URL that tools/fetch-model.mjs fills. */
export const MODEL_ID = 'pii-bert-small';

/** [P(person), P(organisation)] for one word, from the model's prediction on the word's first sub-token. */
export type WordScore = [per: number, org: number];

export type MlRequest =
  | { id: number; type: 'score'; lines: string[][] }
  | { id: number; type: 'warmup' };

export type MlResponse =
  | { id: number; ok: true; scores?: WordScore[][] }
  | { id: number; ok: false; error: string };
