/**
 * Messages for canvas redaction (Feature 3). Everything stays inside the extension:
 * content script ⇄ service worker ⇄ offscreen document (OCR + scanner). No network.
 */

/** A box in image pixels, with the reason it is masked. The text itself is not sent back to the page. */
export interface MaskBox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
}

export interface OcrImage {
  id: string;
  dataUrl: string;
}

export type ToBackground =
  | { type: 'dsc-get-snip' } // the app asking for the toolbar screenshot (existing)
  | { type: 'vs-canvas-capture' }
  | { type: 'vs-canvas-ocr'; images: OcrImage[] };

export type ToOffscreen = { target: 'offscreen'; type: 'vs-ocr'; images: OcrImage[] };

export interface OcrResult {
  id: string;
  boxes: MaskBox[];
  /** Words read, masked or not: lets the page tell "nothing sensitive" from "nothing readable". */
  words: number;
  /** The text-region check: how many boxes it added, or why it could not run (shown on the page for diagnosis). */
  unread?: string;
}

export type CaptureReply = { ok: true; dataUrl: string } | { ok: false; error: string };
export type OcrReply = { ok: true; results: OcrResult[] } | { ok: false; error: string };
