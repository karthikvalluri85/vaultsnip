# VaultSnip

[![CI](https://github.com/karthikvalluri85/vaultsnip/actions/workflows/ci.yml/badge.svg)](https://github.com/karthikvalluri85/vaultsnip/actions/workflows/ci.yml)
[![Live app](https://img.shields.io/badge/live-vaultsnip.pages.dev-0d6b5d)](https://vaultsnip.pages.dev)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/karthikvalluri85/vaultsnip)](CHANGELOG.md)

**Turn sensitive report snips into client-safe replicas.**

**Try it now:** https://vaultsnip.pages.dev (no sign-up; the sample dashboards need no key)

VaultSnip takes a screenshot of any dashboard or report (BI tools, Excel, PDF report pages, product analytics, SaaS apps), masks sensitive text **on your device**, and builds a watermarked, interactive replica that runs on **generated data**. Nothing is stored.

```
capture → local OCR → mask everything except an allowlist → independent re-scan gate
        → you approve the exact payload → Claude or OpenAI returns a layout spec (your key)
        → synthetic replica (3 privacy modes) → one self-contained HTML export
```

## See it in action

https://github.com/user-attachments/assets/0df82dff-e0f8-49a3-b7a6-e36bdc1e8ddf

*Snip → mask on your device → re-scan gate → approve the exact payload → interactive replica on synthetic data (click a country and every number changes).*

## Features (v0.4.0)

| Area | Status |
|---|---|
| Samples first on screen 1 (no key needed) | ✅ 3 samples; the first runs the full redaction demo |
| Upload, paste, extension snip with crop | ✅ |
| Local OCR (Tesseract.js, WASM) | ✅ normal, inverted, high-contrast and block passes; implausible "words" from chart shapes are ignored |
| Mask by default, allowlist to keep | ✅ client names, numbers/money, IDs, emails, unlisted text |
| Independent re-scan gate (Pass / Review / Blocked) | ✅ four independent re-reads of the masked image, plus "Mask all" |
| Review: click to toggle, drag to add masks | ✅ |
| Customer comments: keep the wording of verbatims, mask the names, emails and numbers inside them | ✅ opt-in; replicas quote only words that were readable in the approved image |
| Exact-payload preview before anything is sent | ✅ |
| Bring your own key: **Claude (Anthropic) or OpenAI**, direct browser call | ✅ key type detected automatically; "Check key" lists the models your key can use; held in memory unless you tick "remember" |
| Replica: KPI, bar, column, stacked, line, area, combo, pie, donut, treemap, funnel, waterfall, scatter, bubble, heatmap, gauge, box plot, histogram, Sankey, Gantt/timeline, table | ✅ Apache ECharts |
| Maps: filled, bubble, density and flow | ✅ world, Europe and 14 countries; names, ISO/postal codes and groups (Nordics, DACH, EMEA…) match |
| Cross-filtering | ✅ chips, chart clicks, map regions and table rows change every number |
| Privacy modes: Shape-preserving, Structure-only, Generic | ✅ |
| Watermark + synthetic banner + `synthetic-data` meta | ✅ cannot be turned off |
| Export: one offline HTML file | ✅ no network calls |
| Chrome/Edge extension (MV3, `activeTab` only) | ✅ model downloaded on first launch, cached in IndexedDB |
| In-app feedback with a private route for masking misses | ✅ |
| Pixel-measured shapes, PDF/PPTX input | ⏳ planned |

## Privacy

No backend, no database, no accounts, no analytics. Images, OCR text and results live in the tab's memory. The only thing that ever leaves the device is the masked image you approved, sent straight to the AI provider you chose (Anthropic or OpenAI) with your own key. The browser stores only the OCR model (an app asset) and, if you choose, your key. See [PRIVACY.md](PRIVACY.md).

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

Use the same `--bundle-models` build for the Chrome Web Store and Edge Add-ons: the OCR model ships inside the extension (about 7 MB zipped), so it works offline and makes no network request until you send an approved image to your AI provider. Tagged releases attach ready-made packages automatically.

## Deploy

- **Web app:** Cloudflare Pages, connected to this repo. Build command: none. Output directory: `web`. Every push to `main` deploys.
- **Hugging Face Space:** create a *Static* Space and upload the contents of `dist/hf-space`.
- **Chrome Web Store / Edge Add-ons:** run `./build.sh --bundle-models`, then upload `dist/vaultsnip-extension.zip`; privacy disclosures in [PRIVACY.md](PRIVACY.md).

## Project layout

```
web/              the app (static, no build step), published as-is
  index.html      screens and styles
  app.js          pipeline: OCR, masking, gate, review, AI call, export
  llm.js          AI providers (Claude, OpenAI): the only code that calls an AI service
  replica.js      replica engine, also inlined into every export
  feedback.js     in-app feedback and error reporting
  samples.js      bundled fictional samples
  maps/           map outlines (Natural Earth, simplified)
  lib/ lang/      tesseract.js + OCR model, echarts
extension/        manifest.json, background.js
tools/            check.mjs, e2e.mjs, maps/build_maps.py
build.sh          builds dist/web, dist/extension, dist/hf-space and zips
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). In short: no real data anywhere, no new data flows, and `npm run check` plus `npm run e2e` must pass. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[Apache License 2.0](LICENSE) © 2026 Karthik Valluri. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
