# VaultSnip

[![CI](https://github.com/karthikvalluri85/vaultsnip/actions/workflows/ci.yml/badge.svg)](https://github.com/karthikvalluri85/vaultsnip/actions/workflows/ci.yml)
[![Live app](https://img.shields.io/badge/live-vaultsnip.pages.dev-0d6b5d)](https://vaultsnip.pages.dev)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/karthikvalluri85/vaultsnip)](CHANGELOG.md)

**Turn sensitive report snips into client-safe replicas.**

**Try it now:** https://vaultsnip.pages.dev (no sign-up; the sample dashboards need no key)  
Also on Hugging Face: https://huggingface.co/spaces/karthikvalluri/vaultsnip · Chrome and Edge store listings are in review.

VaultSnip takes a screenshot of any dashboard or report (BI tools, Excel, PDF report pages, product analytics, SaaS apps), finds and masks sensitive text **on your device**, and gives you back **the same screenshot with every sensitive text replaced in place by synthetic text**: every chart, map and visual keeps its original pixels, and only the hidden text changes. Nothing is stored.

```
capture → local OCR → mask everything except an allowlist → independent re-scan gate
        → you approve the exact payload → synthetic text for each hidden box:
              written on your device (no key, nothing sent)
              or by Claude or OpenAI (your key; it gets the masked image and each box's kind and pattern, never the hidden text)
        → in-place replica: hidden text wiped from the background around it and redrawn in the same place, size and colour
        → hover a replaced value to see what it stands for → download or copy the PNG
```

## See it in action

https://github.com/user-attachments/assets/0df82dff-e0f8-49a3-b7a6-e36bdc1e8ddf

*This recording shows the earlier, chart-rebuilding replica (before 0.9); the steps up to the payload are unchanged. A new recording of the in-place replica is to follow.*

## Features

| Area | Status |
|---|---|
| Sample on screen 1 (no key needed) | ✅ runs the full demo on a fictional dashboard: OCR, masking, check, in-place replica |
| Upload, paste (on any screen, or with the Paste button), extension snip with crop | ✅ |
| Local OCR (Tesseract.js, WASM) | ✅ normal, inverted, high-contrast and block passes; implausible "words" from chart shapes are ignored |
| Mask by default, allowlist to keep | ✅ client names, IDs, emails and unlisted text are masked; numbers are replaced with invented values of the same size (or masked, if you prefer) |
| Blur text in charts on any page (extension) | ✅ right-click → "Blur text in charts on this page" or Alt+Shift+B: charts drawn on canvas (Power BI, Tableau, ECharts…) are read on your device and sensitive text is blurred in place; run again to remove |
| On-device name check (AI) | ✅ a 19 MB PII model in a Web Worker masks safe words used as names ("May Chen", "Delta Airlines"); only adds masks; can be switched off |
| Unread-text check (AI) | ✅ two small PP-OCRv5 models (5 MB and 7 MB) find every patch of text and read it again line by line, and mask any the reader missed or could not vouch for; only adds masks; can be switched off |
| Independent re-scan gate (Pass / Review / Blocked) | ✅ six independent re-reads of the masked image, plus one-click **Hide everything uncertain** |
| Review: click to toggle, drag to add masks | ✅ |
| Customer comments: keep the wording of verbatims, mask the names, emails and numbers inside them | ✅ opt-in |
| Exact-payload preview before anything is sent | ✅ the masked image and, under *Show exactly what is sent*, the full list of box descriptions that goes with it |
| **In-place replica** | ✅ the original screenshot, pixel for pixel, with each hidden text wiped from its surrounding background (only the text's own pixels; bar edges and borders through a box survive) and synthetic text drawn back in the same place, size, colour, weight and alignment. Any visual works, because none is redrawn: decomposition trees, custom maps, proprietary widgets |
| **Hover explanations** | ✅ an invisible layer over the picture, aligned to its pixels at every size: hover or tab to a replaced value to see its kind, the labels beside it and where it came from; never the hidden text |
| Synthetic text **on this device** (no key) | ✅ numbers of the same size (axis ticks on an even new scale), made-up people, companies and IDs (Faker), emails only at example.com/.net/.org |
| Synthetic text **by Claude or OpenAI** (your key, direct browser call) | ✅ the AI acts only as a data generator: it gets the masked image and each box's kind, position, nearby visible labels and a number's pattern ("$99.9M") or a text's length; never the hidden text. Answers that break the format or repeat hidden text are replaced on the device |
| Bring your own key | ✅ key type detected automatically; "Check key" lists the models your key can use; held in memory unless you tick "remember" |
| **Download / Copy image** of the replica | ✅ PNG with a strip below the picture saying its text is synthetic |
| **Mask-only download** (no key) | ✅ masked PNG for forums, bug reports and slides, or **Copy masked image** to paste it anywhere |
| **Safe-to-share receipt** | ✅ PNG or PDF beside the masked image: what was hidden (counts and kinds, never the text), the check, made on this device, and the image's SHA-256 |
| Chrome/Edge extension (MV3, `activeTab` only) | ✅ model downloaded on first launch, cached in IndexedDB |
| In-app feedback with a private route for masking misses | ✅ |
| PDF/PPTX input | ⏳ planned |

## Privacy

No backend, no database, no accounts, no analytics. Images, OCR text and results live in the tab's memory. Built on your device, nothing leaves it. Only if you choose an AI to write the synthetic text do the masked image you approved and a list of box descriptions (shown in full before you send; never the hidden text) go straight to Anthropic or OpenAI with your own key. The replica keeps your charts' real shapes; only text is replaced. The browser stores only the app's model files and, if you choose, your key. See [PRIVACY.md](PRIVACY.md).

## Feedback and support

- **In the app:** click **Feedback** (top right) or **Report a problem** (footer). Errors also offer **Report this**. Your report opens on GitHub, pre-filled with the version, browser and step, and never includes your screenshot or dashboard text. No GitHub account? Choose **Email instead**.
- **Bugs:** [open a bug report](https://github.com/karthikvalluri85/vaultsnip/issues/new?template=bug_report.yml) · **Replica problems:** [open a replica report](https://github.com/karthikvalluri85/vaultsnip/issues/new?template=replica.yml)
- **Ideas and questions:** [Discussions](https://github.com/karthikvalluri85/vaultsnip/discussions)
- **Sensitive text left unmasked:** report it **privately**, see [SECURITY.md](SECURITY.md)

More in [SUPPORT.md](SUPPORT.md).

## Run it locally

```bash
cd web
python3 -m http.server 8080      # or: npx serve .
```

Open http://localhost:8080 and click **Try with sample dashboards**. Opening `index.html` directly as a file won't work, because the OCR engine needs http.

## Load the extension (Chrome or Edge)

```bash
./build.sh --bundle-models        # model packed inside the extension (local testing and store uploads)
```

1. Open `chrome://extensions` (or `edge://extensions`) and switch on **Developer mode**.
2. **Load unpacked** → choose `dist/extension`.
3. Open any dashboard tab, click the VaultSnip toolbar icon, drag over the area, and go.
4. To blur sensitive text inside the page's charts without leaving it, right-click → **Blur text in charts on this page** (or Alt+Shift+B). Run it again to remove the blur.

Use the same `--bundle-models` build for the Chrome Web Store and Edge Add-ons: the OCR model ships inside the extension (about 7 MB zipped), so it works offline and makes no network request until you send an approved image to your AI provider. Tagged releases attach ready-made packages automatically.

## Deploy

- **Web app:** Cloudflare Pages, connected to this repo. Build command: none. Output directory: `web`. Every push to `main` deploys.
- **Hugging Face Space:** a *Static* Space with the two files in `dist/hf-space` (`README.md` and a page that shows the live web app), so it always runs the latest release. Live at https://huggingface.co/spaces/karthikvalluri/vaultsnip.
- **Chrome Web Store / Edge Add-ons:** run `./build.sh --bundle-models`, then upload `dist/vaultsnip-extension.zip`; privacy disclosures in [PRIVACY.md](PRIVACY.md).

## Project layout

```
web/              the app (static, no build step), published as-is
  index.html      screens and styles
  app.js          pipeline: OCR, masking, gate, review, payload preview, replica screen
  inpaint.js      in-place replica: background sampling, pixel clearing, text redraw, hover layer
  synth.js        synthetic text: box descriptions sent to the AI, its prompt, answer checks, on-device values
  llm.js          AI providers (Claude, OpenAI): the only code that calls an AI service
  replica.js …    the earlier chart-rebuilding replica; no longer loaded by the app, to be removed
  feedback.js     in-app feedback and error reporting
  samples.js      bundled fictional sample
  maps/           map outlines (Natural Earth, simplified)
  lib/ lang/      tesseract.js + OCR model, echarts, vs-context.js (on-device AI client)
  ml/ models/     on-device AI: Web Worker + ONNX runtime (npm run build:ml), PII and text-region models (npm run fetch:model)
extension/        manifest.json; background.js, canvas-ocr.js, offscreen.*, wasm/ built from src/ (npm run build:ext)
src/              TypeScript sources: name check, chart blur (background/, content/), exports (export/, exporters/), realistic names (replica/)
tools/            check.mjs, e2e.mjs, build-ml.mjs, fetch-model.mjs, maps/build_maps.py
build.sh          builds dist/web, dist/extension, dist/hf-space and zips
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). In short: no real data anywhere, no new data flows, and `npm run check`, `npm run test:unit`, `npm run e2e` and `npm run test:inplace` must pass. Changes are listed in [CHANGELOG.md](CHANGELOG.md). How accuracy is measured, today's figures and the plan for raising them are in [ACCURACY.md](ACCURACY.md).

## License

[Apache License 2.0](LICENSE) © 2026 Karthik Valluri. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
