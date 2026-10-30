# Contributing to VaultSnip

Thanks for helping. VaultSnip is a static, browser-only app: no build step, no backend, no database.

## Ground rules

1. **No real data, ever.** Code, tests, fixtures, issues and screenshots use fictional or public material only.
2. **No new data flows.** Do not add analytics, trackers, error-reporting services or calls to any server: the app talks only to its own site, for its model files. Discuss first in an issue if you think one is needed.
3. **Mask by default.** Changes to OCR or masking must keep the "mask unless allowlisted" rule and the independent re-scan gate.
4. **Ethics and the law come first.** Before a change is made, check that it respects people's privacy, applicable privacy and data-protection law (for example GDPR and CCPA), copyright and licences, and the terms of the services involved. If it does not, it is not made, however useful it would be.
5. **Only compatible licences.** VaultSnip is Apache-2.0. Code, models and datasets must carry a declared licence that allows redistribution under it (MIT, BSD, Apache-2.0 and similar). No GPL code copied in, no "no licence" or non-commercial assets. Credit every third-party asset in `THIRD_PARTY_NOTICES.md`.
6. **Disclose before shipping.** Any new download, file kept by the browser or extension permission is described in `PRIVACY.md` in the same change.
7. **Free and open, for good.** No paywalls, licence keys, ads or selling of data. VaultSnip stays free and open source.

## Run it locally

```bash
git clone https://github.com/karthikvalluri85/vaultsnip.git
cd vaultsnip/web
python3 -m http.server 8080        # or: npx serve .
```

Open http://localhost:8080 and use **Try with sample dashboards**.

## Checks before a pull request

```bash
npm ci                    # once (Node 22 or later)
npm run check             # syntax, JSON, manifest, versions, privacy page in sync with PRIVACY.md
npx tsc -p .              # types
npm run test:unit         # unit tests (Vitest)
npm run e2e               # browser end-to-end test (first run: npx playwright install chromium)
```

CI runs these on every pull request, plus the extension and on-device name-check suites, and checks that every committed bundle matches its source (see *Built files* below).

A change to reading or masking should also show its effect on the masking benchmark, and a change to the replica on the
in-place benchmark:

```bash
npm run bench:synth       # draws 60 fictional dashboards (seeded, nothing downloaded) and scores masking on them
node tools/synth-bench/run.mjs --reuse --json synth.json   # scores again without re-reading
npm run bench:gate -- synth.json tools/synth-bench/baseline.json   # fails if a figure got worse than its baseline
npm run bench:inplace     # 50 fictional dashboards through the app: pixels changed outside boxes, leftover text,
                          # shrunk replacements, sensitive words left readable
npm run test:inplace      # the in-place replica's end-to-end checks
```

CI runs the masking benchmark on 8 generated dashboards for every pull request and on 60 nightly. A change that improves
a figure raises its baseline file in the same pull request.

[ACCURACY.md](ACCURACY.md) defines what each figure means, records the baseline and sets out the plan for raising it.

## Project layout

| Path | What it is |
|---|---|
| `web/` | The app, published as-is to Cloudflare Pages |
| `web/app.js` | Pipeline: OCR, masking, gate, review, preview, replica screen |
| `web/inpaint.js` | In-place replica: background sampling, pixel clearing, text redraw, hover layer |
| `web/synth.js` | Synthetic text for each hidden box, made on the device |
| `web/feedback.js` | In-app feedback and error reporting |
| `src/` | TypeScript sources, built into the committed bundles listed under *Built files* |
| `tests/` | Unit tests (`tests/unit`, Vitest) and extra end-to-end suites (`tests/e2e`) |
| `extension/` | Chrome/Edge (MV3) wrapper |
| `build.sh` | Builds the extension, web and Hugging Face packages into `dist/` |
| `tools/` | Checks, end-to-end test, build scripts, benchmarks (`synth-bench`, `inplace-bench`) and the map builder for the generated test dashboards |

## Style

- Plain modern JavaScript in `web/`, TypeScript in `src/`, no frameworks; 2-space indent (see `.editorconfig`).
- Commit messages: short imperative summary line, e.g. `Maps: match UK and United Kingdom`.

## Built files

The app has no build step, so code from `src/` ships as committed bundles. After changing a source, run its script and commit the output with the change; CI fails when a committed bundle differs from its source.

| Source | Script | Committed output |
|---|---|---|
| `src/replica` | `npm run build:faker` | `web/lib/vs-faker.js` |
| `src/background`, `src/content`, `src/shared` | `npm run build:ext` | `extension/*.js`, `extension/offscreen.html` |
| `src/background`, `src/content/context-classifier.ts` | `npm run build:ml` | `web/ml`, `web/lib/vs-context.js` |
| `PRIVACY.md` | `npm run build:privacy` | `web/privacy.html` |

`src/shared/allowlist.ts` must match the `ALLOW` list in `web/app.js` (a unit test checks this), and it is bundled into the extension, so run `npm run build:ext` after changing it. `npm run fetch:model -- --check` verifies the on-device model in `web/models` against its pinned revision.

## Upgrading vendored libraries

`web/lib` holds a copy of tesseract.js, so the app needs no build step. To upgrade one, update `package.json`, run `npm install`, copy the new files into `web/lib`, and run `npm run e2e`. Dependabot is told not to propose these upgrades for that reason.

## Releasing (maintainer)

1. Update the version in `package.json`, `extension/manifest.json` and `web/feedback.js` (`npm run check` verifies they match).
2. Move *Unreleased* notes in `CHANGELOG.md` under the new version.
3. Tag `vX.Y.Z` and push the tag. The release workflow builds and attaches the extension, web and Space packages.

## Licence

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
