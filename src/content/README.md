# Canvas redaction (Feature 3)

Charts in Power BI, Tableau, ECharts and Chart.js are `<canvas>` elements, so their text is not in the DOM.
"Blur text in charts on this page" (right-click menu, or Alt+Shift+B) blurs sensitive text inside them on the
live page. Running it again removes the blur.

```
canvas-ocr.js (content script) ──► service worker ──► offscreen document
  read canvas pixels                 tab screenshot       Tesseract (app/lib) + the app's masking rules
  draw overlays, follow, re-check    (fallback)           → mask boxes, no text
```

- **Pixels.** Each canvas's own pixels (`toDataURL`). If the canvas is tainted by cross-origin images, or is WebGL
  that reads back blank, it falls back to a tab screenshot cropped to the canvas.
- **OCR in an offscreen document**, not the content script: there, Tesseract's Worker and WASM would fall under the
  page's CSP, which strict sites use to block them.
- **What is masked:** the app's rules in TypeScript (`src/shared/classify.ts`, checked against `web/app.js` by
  `tests/unit/classify.test.ts`) with the app's allowlist (`src/shared/allowlist.ts`): names not on the allowlist,
  emails, IDs, numbers and money.
- **Overlays, not the chart's own context.** Chart libraries redraw on every hover or resize, which would wipe a blur
  drawn into their canvas, and WebGL has no 2D context. Overlays follow the chart every frame.
- **The blur cannot be undone.** Each region is shrunk to about one pixel per 12 CSS px before it is blurred, so no
  glyph shapes are left to match against.
- **Re-check.** After blurring, the page is screenshotted with the overlays and read again; anything flagged that is
  still readable is masked too.
- **Redraws fail closed.** Every 0.3 s each chart is compared pixel by pixel (64×64 thumbnail). The region that changed
  is covered at once and shown again only after the chart has been read; if the read fails, it stays covered and the
  badge says so (3 retries while it is on screen). A resized chart is covered whole until it is read.

## Build and test

```sh
npm run build:ext         # after changing src/: rebuild the extension/ scripts, then commit
npm run test:canvas-e2e   # Chromium, the packaged extension: PII readable before, unreadable after, redraws hidden
```

Shipped in the extension: `npm run build:ext` writes the scripts into `extension/` (committed, packaged as-is by
`build.sh`). The manifest adds `scripting`, `offscreen` and `contextMenus` (no permission warning, no host access)
and the Alt+Shift+B command; `tools/check.mjs` allows exactly these and requires each in `PRIVACY.md`.

Reference studied: romelancheta/AutoRedact (GPL-3.0). Mechanics only, no code taken: VaultSnip is Apache-2.0.
