# Third-party components

Bundled in `web/lib` and `web/lang`, each under the Apache License 2.0:

- Tesseract.js and tesseract.js-core (OCR in the browser)
- Tesseract English language model (`eng.traineddata`, 4.0.0_best_int)
- Apache ECharts (charts in the replica and in every export)

Masked session replay, bundled in `extension/recorder.js` and `web/lib/vs-replay.js`:

- [rrweb](https://github.com/rrweb-io/rrweb) 2.1.7 with rrweb-snapshot, rrdom, @rrweb/types and @rrweb/utils, MIT License
- Bundled by rrweb: PostCSS (MIT), nanoid (MIT), picocolors (ISC), source-map-js (BSD 3-Clause, Copyright 2009-2011 Mozilla Foundation and contributors), @xstate/fsm (MIT), base64-arraybuffer (MIT), mitt (MIT)

On-device name check, in `web/ml`, `web/lib/vs-context.js` and `web/models`:

- [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.0, Apache License 2.0 (bundled in `web/ml/ner-model.js`)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.31, MIT License (`web/ml/ner-model.js`, `web/ml/assets/ort-wasm-simd-threaded.wasm`)
- [gravitee-io/bert-small-pii-detection](https://huggingface.co/gravitee-io/bert-small-pii-detection), revision `f8c27a8`, Apache License 2.0
  (int8 ONNX weights, gzipped; tokenizer and config unchanged). Fine-tuned from
  [prajjwal1/bert-small](https://huggingface.co/prajjwal1/bert-small) (MIT License) on
  [gravitee-io/pii-detection-dataset](https://huggingface.co/datasets/gravitee-io/pii-detection-dataset) (Apache License 2.0,
  built from MIT and Apache-2.0 sources, mostly synthetic). `npm run fetch:model -- --check` verifies the files against the
  pinned revision.

Map outlines in `web/maps` are simplified from [Natural Earth](https://www.naturalearthdata.com) (public domain) by `tools/maps/build_maps.py`. The world and India outlines follow Natural Earth's India point of view, matching official Indian boundaries.
