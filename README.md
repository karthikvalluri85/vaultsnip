# VaultSnip

**Turn sensitive report snips into client-safe replicas.**

**Try it now:** https://vaultsnip.pages.dev (no sign-up; the sample dashboards need no key)

VaultSnip takes a screenshot of any dashboard or report (BI tools, Excel, PDF report pages, web analytics, SaaS apps), masks sensitive text **on your device**, and builds a watermarked, interactive replica that runs on **generated data**. Nothing is stored.

```
capture → local OCR → mask everything except an allowlist → independent re-scan gate
        → you approve the exact payload → Claude returns a layout spec (your key)
        → synthetic replica (3 privacy modes) → one self-contained HTML export
```

## See it in action

https://github.com/user-attachments/assets/0df82dff-e0f8-49a3-b7a6-e36bdc1e8ddf

*Snip → mask on your device → re-scan gate → approve the exact payload → interactive replica on synthetic data (click a country and every number changes). Also in the repo: [MP4](docs/video/vaultsnip-demo.mp4) · [animated preview](docs/video/vaultsnip-demo.gif).*

## What's in this MVP (v0.1.0)

| Area | Status |
|---|---|
| Samples first on screen 1 (no key needed) | ✅ 3 samples; the first runs the full redaction demo |
| Upload, paste, extension snip with crop | ✅ |
| Local OCR (Tesseract.js, WASM, bundled) | ✅ normal + inverted pass for light-on-dark text |
| Mask by default, allowlist to keep | ✅ client names, numbers/money, IDs, emails, unlisted text |
| Independent re-scan gate (Pass / Review / Blocked) | ✅ 2× zoom + inverted re-read of the masked image |
| Review: click to toggle, drag to add masks | ✅ |
| Exact-payload preview before anything is sent | ✅ |
| Bring-your-own Claude key, direct browser call | ✅ held in memory unless you tick "remember" |
| Replica: KPI, bar, column, stacked, line, area, combo, pie, donut, treemap, funnel, waterfall, scatter, bubble, heatmap, gauge, box plot, histogram, Sankey, table | ✅ (Apache ECharts) |
| Privacy modes: Shape-preserving, Structure-only, Generic | ✅ |
| Watermark + synthetic banner + `synthetic-data` meta | ✅ cannot be turned off |
| Export: one offline HTML file with footer link | ✅ no automatic network calls |
| Chrome/Edge extension (MV3, `activeTab` only) | ✅ model downloaded on first launch, cached in IndexedDB |
| Maps: filled (choropleth), bubble/symbol, density and flow | ✅ 16 bundled outlines: world, Europe, USA, Canada, Mexico, Brazil, UK, France, Germany, Italy, Spain, India, China, Japan, Australia, South Africa. Region names, ISO/postal codes and groups (Nordics, DACH, EMEA, England…) match; click a region to filter |
| Pixel-measured shapes | ⏳ Claude estimates shapes from the masked image for now |
| Model hash check, anonymous counters, PDF/PPTX | ⏳ next |

## Run it locally

Any static server works. From the repo root:

```bash
cd web
python3 -m http.server 8080      # or: npx serve .
```

Open http://localhost:8080 and click **Try with sample dashboards**. (Opening `index.html` directly as a file won't work: the OCR engine needs http.)

## Load the extension (Chrome or Edge)

```bash
./build.sh --bundle-models        # local testing: model packed inside the extension
```

1. Open `chrome://extensions` (or `edge://extensions`), switch on **Developer mode**.
2. **Load unpacked** → choose `dist/extension`.
3. Open any dashboard tab, click the VaultSnip toolbar icon, drag over the area, and go.

For a store release, host the web app first, then build without the model so it downloads on first launch:

```bash
./build.sh --model-url https://YOUR-SITE/lang
```

## Deploy

- **Web app:** Cloudflare Pages (or GitHub Pages / Netlify). Build command: none. Output directory: `web`.
- **Hugging Face Space:** create a *Static* Space and upload the contents of `dist/hf-space` (it includes the Space README header).
- **Chrome Web Store / Edge Add-ons:** upload `dist/vaultsnip-extension.zip`; privacy disclosures in `PRIVACY.md`.

## Project layout

```
web/            the app (static, no build step)
  index.html    screens and styles
  app.js        pipeline: OCR, masking, gate, review, Claude call, export
  replica.js    replica engine, also inlined into every export
  samples.js    bundled fictional samples
  config.js     model location (overwritten by the extension build)
  lib/          tesseract.js, OCR core (WASM), echarts
  lang/         English OCR model (2.9 MB)
  icons/        logo and store icons
extension/      manifest.json, background.js
build.sh        builds dist/web, dist/extension, dist/hf-space and zips
```

## Privacy in one paragraph

No backend, no database, no accounts. Images, OCR text and results live in the tab's memory. The only thing that ever leaves the device is the masked image you approved, sent straight to Anthropic with your key. The browser stores only the OCR model (an app asset) and, if you choose, your key. See `PRIVACY.md`.

## Before public launch (owner checklist)

- [ ] Replace `PRODUCT_URL` in `web/replica.js` with the live site
- [ ] Review employment agreement (IP and outside-business clauses)
- [ ] Never test with client material; use the bundled or synthetic samples
- [ ] Host the model and build the extension with `--model-url`

Licensed under Apache 2.0.
