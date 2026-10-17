# Contextual ML fallback (Feature 2)

A 14.5 MB named-entity model gives a second opinion on words the rules in `classify()` keep: an
allowlisted word used as a name ("May Chen", "Target Corporation", "Delta Airlines"). It can only add
masks, never remove them. If the worker fails, the rules' result stands.

| File | Role |
| --- | --- |
| `ml-worker.ts` | Web Worker entry. Installs the network guard, then loads the model on first use. |
| `ml-handler.ts` | Runs requests one at a time; retries a failed model load on the next request. |
| `ner-model.ts` | Turns off transformers.js's remote defaults; tokenises each OCR word and scores its first sub-token. |
| `ner-encode.ts` | Pure packing and softmax helpers. |
| `network-guard.ts` | Refuses any fetch/XHR outside the worker's own origin. |
| `ml-protocol.ts` | Message types shared with the page. |
| `../content/context-classifier.ts` | Page-side client (ids, timeouts, crash recovery) and `contextualHits()`, which decides what to mask. |

The app page starts the worker. A Manifest V3 service worker cannot start Web Workers.

## Build and test

```sh
npm run fetch:model   # pinned revision, SHA-256 checked, into public/models/ (not committed)
npm run build:ml      # Vite: public/ml/ml-worker.js + chunk + ONNX runtime .wasm
npm run test:unit     # includes the real-model tests, which skip until the model is fetched
npm run test:ml-e2e   # Chromium, with the extension's CSP: zero network, no PII in requests, main thread never blocked ≥ 50 ms
```

## Model

`onnx-community/TinyBERT-finetuned-NER-ONNX`, int8 (CoNLL-2003, F1 0.858). **No license is declared** by
the model or the repos it comes from. `build.sh` does not package `public/`, so the model does not ship.
Settle the license (or pick a licensed model) before wiring this into a release.

Known misses: "Top accounts: Target, Walmart, Costco", "Delta Air Lines renewal", "June Park". See
`tests/unit/ner-model.test.ts`.

## Not wired in yet

`web/app.js` does not call it yet. To wire it in: copy `public/ml` and `public/models` into the app,
group words with `textLines()`, send each line's word texts, and pass `kept` = (the rules returned no type
and the word is not in the session or extra allowlist). Words picked by `contextualHits()` get the type
`Name in context`.
