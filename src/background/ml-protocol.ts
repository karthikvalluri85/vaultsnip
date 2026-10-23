/**
 * Messages between the app page and the ML worker (Feature 2, Phase 2).
 *
 * Name check: the page sends OCR lines as arrays of words; the worker answers with one score pair per word, in the
 * same shape. Words go in already split, so results map back to OCR boxes by index, never by string search.
 * Text regions: the page sends the screenshot's pixels at the detector's input size (multiples of 32); the worker
 * answers with boxes in those pixels. Only pixels go in and only boxes come out: the detector reads no text.
 */
import type { Region } from '../shared/text-regions';

/** Folder under the models base URL that tools/fetch-model.mjs fills. */
export const MODEL_ID = 'pii-bert-small';
/** The text-region detector's folder and file under the models base URL. */
export const DETECTOR_FILE = 'pp-ocrv5-det/inference.onnx';

/** [P(person), P(organisation)] for one word, from the model's prediction on the word's first sub-token. */
export type WordScore = [per: number, org: number];

/** RGBA pixels, as ImageData holds them. */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export type MlRequest =
  | { id: number; type: 'score'; lines: string[][] }
  | { id: number; type: 'warmup' }
  | { id: number; type: 'detect'; image: Pixels };

export type MlResponse =
  | { id: number; ok: true; scores?: WordScore[][]; regions?: Region[] }
  | { id: number; ok: false; error: string };
