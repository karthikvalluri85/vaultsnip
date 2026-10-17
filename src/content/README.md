# Canvas redaction (Feature 3)

Charts in Power BI, Tableau, ECharts and Chart.js are `<canvas>` elements, so their text is not in the DOM.
"Blur text in charts on this page" (right-click menu, or Alt+Shift+B) blurs sensitive text inside them on the
live page. Running it again removes the blur.

```
canvas-ocr.js (content script) ──► service worker ──► offscreen document
  read canvas pixels                 tab screenshot       Tesseract (app/lib) + Rust scanner (wasm/)
  draw overlays, follow, re-check    (fallback)           → mask boxes, no text
```

- **Pixels.** Each canvas's own pixels (`toDataURL`). If the canvas is tainted by cross-origin images, or is WebGL
  that reads back blank, it falls back to a tab screenshot cropped to the canvas.
- **OCR in an offscreen document**, not the content script: there, Tesseract's Worker and WASM would fall under the
  page's CSP, which strict sites use to block them.
- **What is masked:** the Rust scanner (Feature 1) with the app's allowlist (`src/shared/allowlist.ts`; a unit test
  fails if it drifts from `web/app.js`): names not on the allowlist, emails, IDs, numbers and money.
- **Overlays, not the chart's own context.** Chart libraries redraw on every hover or resize, which would wipe a blur
  drawn into their canvas, and WebGL has no 2D context. Overlays follow the chart every frame.
- **The blur cannot be undone.** Each region is shrunk to about one pixel per 12 CSS px before it is blurred, so no
  glyph shapes are left to match against.
- **Re-check.** After blurring, the page is screenshotted with the overlays and read again; anything flagged that is
  still readable is masked too.
- **Redraws.** Readable canvases are compared every 1.5 s; a changed or resized chart is read again. New text is
  visible for that long (plus OCR time, about 1–2 s per chart). Tainted and WebGL charts are re-read only when resized.

## Build and test

```sh
npm run build:wasm
npm run build:ext            # dist/extension-dev, load unpacked; add -- --test for the test build
npm run test:canvas-e2e      # Chromium, real extension: PII readable before, unreadable after (OCR of a screenshot)
```

`build.sh` and `extension/manifest.json` are unchanged: the release does not include this yet. The dev manifest adds
`scripting`, `offscreen` and `contextMenus` (none shows a permission warning) and the Alt+Shift+B command.

Reference studied: romelancheta/AutoRedact (GPL-3.0). Mechanics only, no code taken: VaultSnip is Apache-2.0.
