/* On-device layout builder (Phase 2, beta), off the page's main thread.
   Receives the masked image's pixels, the OCR word boxes (masked words carry no text) and the mask boxes; returns a
   replica spec. Runs entirely here: it makes no network request and loads nothing but lib/vs-layout.js. */
importScripts('lib/vs-layout.js');

self.onmessage = (e) => {
  const { id, image, words, masks } = e.data || {};
  try {
    const result = self.VSLayout.buildSpec({ image, words, masks });
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
