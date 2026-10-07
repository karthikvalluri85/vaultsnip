# Contributing to VaultSnip

Thanks for helping. VaultSnip is a static, browser-only app: no build step, no backend, no database.

## Ground rules

1. **No real data, ever.** Code, tests, fixtures, issues and screenshots use fictional or public material only.
2. **No new data flows.** Do not add analytics, trackers, error-reporting services or calls to any server other than Anthropic (with the user's own key). Discuss first in an issue if you think one is needed.
3. **Mask by default.** Changes to OCR or masking must keep the "mask unless allowlisted" rule and the independent re-scan gate.

## Run it locally

```bash
git clone https://github.com/karthikvalluri85/vaultsnip.git
cd vaultsnip/web
python3 -m http.server 8080        # or: npx serve .
```

Open http://localhost:8080 and use **Try with sample dashboards**.

## Checks before a pull request

```bash
npm ci                    # once
npm run check             # syntax, JSON, manifest and version checks
npm run e2e               # browser smoke test (installs Chromium on first run: npx playwright install chromium)
```

Both run automatically on every pull request.

## Project layout

| Path | What it is |
|---|---|
| `web/` | The app, published as-is to Cloudflare Pages |
| `web/app.js` | Pipeline: OCR, masking, gate, review, Claude call, export |
| `web/replica.js` | Replica engine (also embedded in every export) |
| `web/feedback.js` | In-app feedback and error reporting |
| `web/maps/` | Map outlines, rebuilt by `tools/maps/build_maps.py` |
| `extension/` | Chrome/Edge (MV3) wrapper |
| `build.sh` | Builds the extension, web and Hugging Face packages into `dist/` |
| `tools/` | Checks, end-to-end test, map builder |

## Style

- Plain modern JavaScript, no frameworks; 2-space indent (see `.editorconfig`).
- Keep files self-contained: `replica.js` must work inside an offline exported file.
- Commit messages: short imperative summary line, e.g. `Maps: match UK and United Kingdom`.

## Releasing (maintainer)

1. Update the version in `package.json`, `extension/manifest.json` and `web/feedback.js` (`npm run check` verifies they match).
2. Move *Unreleased* notes in `CHANGELOG.md` under the new version.
3. Tag `vX.Y.Z` and push the tag. The release workflow builds and attaches the extension, web and Space packages.

## Licence

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
