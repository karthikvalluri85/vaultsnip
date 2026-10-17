# On-device name check (Feature 2)

A small PII model gives a second opinion on words the rules in `classify()` keep: a safe word used as a name
("May Chen", "Delta Airlines"). It only adds masks ("Name in context"), never touches words the user marked or
listed as safe, and runs before the pre-flight check. If it cannot run, the rules' masks stand and the user is told.
It is on by default and can be switched off under *Redaction policy*.

| File | Role |
| --- | --- |
| `ml-worker.ts` | Web Worker entry. Installs the network guard and model-file layer, then loads the model on first use. |
| `model-files.ts` | Unpacks the `.onnx.gz` weights; for the store extension, maps model requests to VaultSnip's own site. |
| `network-guard.ts` | Refuses any fetch/XHR outside the worker's origin and the configured VaultSnip model site. |
| `ml-handler.ts` | Runs requests one at a time; retries a failed model load on the next request. |
| `ner-model.ts` | Turns off transformers.js's remote defaults; tokenises each OCR word and scores its first sub-token. |
| `ner-encode.ts` | Pure packing, label-group and softmax helpers. |
| `ml-protocol.ts` | Message types shared with the page. |
| `../content/context-classifier.ts` | Page client (ids, timeouts, crash recovery) and `contextualHits()`; built as `web/lib/vs-context.js`. |

`web/app.js` calls it in `scoreContext()` / `contextMasks()`. The app page starts the worker; a Manifest V3 service
worker cannot start Web Workers.

## Model

[gravitee-io/bert-small-pii-detection](https://huggingface.co/gravitee-io/bert-small-pii-detection), int8 ONNX, 28.7 MB
(18.9 MB gzipped, because Cloudflare Pages refuses files over 25 MiB). Apache-2.0; base model MIT; training data
Apache-2.0 from MIT/Apache-2.0 sources, mostly synthetic. Credited in `THIRD_PARTY_NOTICES.md`.

Chosen over the first candidate (TinyBERT-NER, 14.5 MB) because that model and its sources declare no licence.
On the dashboard test lines both catch four of eight names; this one catches "June Park", misses "Target Corporation".
Known misses are listed in `tests/unit/ner-model.test.ts`.

## Where the files are served from

| Build | Model | Config |
| --- | --- | --- |
| Web app (`web/`, Cloudflare Pages) | `web/models/…/model_quantized.onnx.gz` | `mlModels: 'models/'` |
| Extension, `build.sh --bundle-models` (stores) | inside the package, unzipped | `mlModels: 'models/', mlGzip: false` |
| Extension, `build.sh` | from `https://vaultsnip.pages.dev/models/` | `mlModels: '<url>'` |

## Build and test

```sh
npm run fetch:model -- --check   # committed model matches the pinned revision (no network)
npm run build:ml                 # rebuild web/ml and web/lib/vs-context.js after changing src/; commit the result
npm run test:unit                # includes real-model tests on the committed model
npm run test:ml-e2e              # Chromium, extension CSP, model from a second origin: zero third-party requests,
                                 # no PII in requests, model fetched once, main thread never blocked >= 50 ms
npm run e2e                      # the whole app, including the name check on the redaction demo
```
