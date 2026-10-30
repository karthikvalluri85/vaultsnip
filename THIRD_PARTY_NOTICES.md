# Third-party components

Bundled in `web/lib` and `web/lang`, each under the Apache License 2.0:

- Tesseract.js and tesseract.js-core (OCR in the browser)
- Tesseract English language model (`eng.traineddata`, 4.0.0_best_int)

On-device name check, in `web/ml`, `web/lib/vs-context.js` and `web/models`:

- [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.0, Apache License 2.0 (bundled in `web/ml/models.js`)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.31, MIT License (`web/ml/models.js`, `web/ml/assets/ort-wasm-simd-threaded.wasm`)
- [gravitee-io/bert-small-pii-detection](https://huggingface.co/gravitee-io/bert-small-pii-detection), revision `f8c27a8`, Apache License 2.0
  (int8 ONNX weights, gzipped; tokenizer and config unchanged). Fine-tuned from
  [prajjwal1/bert-small](https://huggingface.co/prajjwal1/bert-small) (MIT License) on
  [gravitee-io/pii-detection-dataset](https://huggingface.co/datasets/gravitee-io/pii-detection-dataset) (Apache License 2.0,
  built from MIT and Apache-2.0 sources, mostly synthetic). `npm run fetch:model -- --check` verifies the files against the
  pinned revision.

Unread-text check, in `web/ml/models.js`, `web/models/pp-ocrv5-det` and `web/models/pp-ocrv5-rec-en`:

- [PP-OCRv5_mobile_det](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx), the PaddleOCR team's own ONNX
  export, revision `e6f4fa8`, Apache License 2.0, Copyright (c) PaddlePaddle Authors
  ([PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)). Weights unchanged (gzipped). Its post-processing in
  `src/shared/text-regions.ts` follows PaddleOCR's DBPostProcess and was written for VaultSnip; no PaddleOCR code is
  copied. `npm run fetch:model -- --check` verifies the file against the pinned revision.
- [en_PP-OCRv5_mobile_rec](https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx), the PaddleOCR team's own
  ONNX export, revision `3fafbc3`, Apache License 2.0, Copyright (c) PaddlePaddle Authors. Weights (gzipped) and its
  character list unchanged. Its decoding in `src/background/text-reader.ts` follows PaddleOCR's CTC decoding and was
  written for VaultSnip; no PaddleOCR code is copied. `npm run fetch:model -- --check` verifies both files.

PDF input, in `web/lib/pdfjs`:

- [PDF.js](https://github.com/mozilla/pdf.js) 4.4.168 (`pdfjs-dist`, `pdf.min.mjs` and `pdf.worker.min.mjs` as `pdf.min.js` and `pdf.worker.min.js`, otherwise unchanged), Apache License 2.0, Copyright Mozilla Foundation. Its licence is in `web/lib/pdfjs/LICENSE`.

Realistic synthetic names in the replica, bundled in `web/lib/vs-faker.js`:

- [Faker](https://github.com/faker-js/faker) 10.6.0 (`@faker-js/faker`), MIT License, Copyright (c) 2022-present Faker. The library and a slim copy of its name, company, place and product lists for 15 locales (`src/replica/faker-locales.json`, made by `tools/build-faker.mjs`).

Development only, never shipped in the web app, the extension or any export. Used by `tools/synth-bench` to draw the
fictional dashboards of the masking benchmark, installed as pinned `devDependencies`:

- [Vega](https://github.com/vega/vega) 6.4.0 and [Vega-Lite](https://github.com/vega/vega-lite) 6.4.3, BSD 3-Clause License
- [Plotly.js](https://github.com/plotly/plotly.js) 4.1.2 (`plotly.js-dist-min`), MIT License
- Map outlines in `tools/synth-bench/maps`, simplified from [Natural Earth](https://www.naturalearthdata.com) (public domain)
  by `tools/maps/build_maps.py`; the world and India outlines follow Natural Earth's India point of view
- Fonts through [Fontsource](https://fontsource.org): [Inter](https://github.com/rsms/inter) 5.3.0 and
  [IBM Plex Mono](https://github.com/IBM/plex) 5.3.0 under the SIL Open Font License 1.1, and
  [Roboto Slab](https://github.com/googlefonts/robotoslab) 5.3.0 under the Apache License 2.0
