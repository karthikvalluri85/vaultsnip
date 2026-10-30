# VaultSnip — Enterprise & Self-Hosting Guide

VaultSnip is a static web application. No server, no database, no backend logic. Everything that runs on your device. This guide explains how to run it inside a corporate network.

---

## Zero-install route (recommended)

The fastest enterprise deployment requires no software install at all. Users open the hosted app at https://vaultsnip.pages.dev in any modern browser (Chrome, Edge, Firefox, Safari). 

**No browser extension needed.** The extension adds chart-blur on external pages; the full redaction and replica workflow runs in the web app without it. For users on managed devices where unapproved extensions are blocked, point them to the URL directly.

---

## Self-host on internal infrastructure

The `web/` folder is a complete, self-contained app. Serve it from any static host — IIS, Nginx, Apache, Cloudflare Pages, AWS S3 + CloudFront, Azure Static Web Apps, GitHub Pages, or a corporate SharePoint site.

### Serve it locally for testing

```bash
cd web
python3 -m http.server 8080   # or: npx serve .
```

Opening `index.html` directly as a `file://` URL will not work — the OCR engine requires HTTP.

### Deploy to Nginx

```nginx
server {
    listen 443 ssl;
    server_name vaultsnip.internal.example.com;

    root /var/www/vaultsnip/web;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Required: the OCR WASM module and the on-device AI models are large binary files.
    # Allow large responses and set correct MIME types.
    types {
        application/wasm  wasm;
        application/octet-stream  onnx;
    }

    # The app caches its OCR model in the browser's cache storage.
    # No server-side sessions or cookies are needed.
    add_header Cache-Control "public, max-age=86400" always;
}
```

### Deploy to IIS (Windows)

1. Copy the `web/` folder to `C:\inetpub\wwwroot\vaultsnip` (or your preferred path).
2. In IIS Manager, add a MIME type: `.wasm` → `application/wasm` and `.onnx` → `application/octet-stream`.
3. Point a new site or virtual directory at the folder.

### Deploy to Cloudflare Pages (recommended for cloud)

The live app at https://vaultsnip.pages.dev is already a Cloudflare Pages deployment. To fork it to your own account:

1. Fork the repository on GitHub.
2. In Cloudflare Pages, connect the fork.
3. Build command: **none**. Output directory: `web`.
4. Every push to `main` deploys automatically.

---

## What the app downloads at runtime

VaultSnip loads several large resources on first use. On a corporate network with outbound filtering, allow these URLs:

| Resource | URL | Size | When |
|---|---|---|---|
| OCR engine (Tesseract WASM) | served from app origin | ~2 MB | First visit |
| OCR model (English) | served from app origin | ~9 MB | First visit |
| On-device PII model | `<origin>/models/` | 19 MB | First use of name-check |
| Text-region detector | `<origin>/models/` | 5 MB | First use of unread-text check |
| Text-region reader | `<origin>/models/` | 7 MB | First use of unread-text check |
| PDF.js (when processing PDFs) | `cdnjs.cloudflare.com` | ~1 MB | First PDF upload |

On a self-hosted deployment, all resources except PDF.js are served from your own origin. To remove the PDF.js CDN dependency, download `pdf.min.js` and `pdf.worker.min.js` from [Mozilla's releases](https://github.com/mozilla/pdf.js/releases) and place them in `web/lib/`, then update the `loadPdfJs()` URLs in `web/app.js`.

---

## AI-key path: what leaves the network

The **local-first path** (Build on this device) makes no external network calls at all. Nothing leaves your network.

The **AI-key path** (optional) sends one image to Anthropic or OpenAI. Before sending:
- All text is masked (grey boxes)
- All numbers are replaced with invented values (never the real figures)
- The user approves the exact masked image in a preview dialog

The API call goes directly from the user's browser to `api.anthropic.com` or `api.openai.com`. No traffic passes through a VaultSnip server. If your network blocks these domains, the AI-key path will not work — the local-first path (no key needed) still works fully.

To allow the AI-key path on a restrictive network, allowlist:
- `api.anthropic.com:443` (Claude)
- `api.openai.com:443` (OpenAI)

---

## Extension deployment (optional)

The browser extension adds the ability to blur text inside charts on any live dashboard page (Power BI, Tableau, Looker, etc.) without leaving that page.

### Chrome / Edge managed deployment

For organisations using Chrome Browser Cloud Management or Microsoft Intune:

1. Run `./build.sh --bundle-models` to build `dist/vaultsnip-extension.zip`.
2. Unzip it; host the folder on an internal file share or web server.
3. Push via policy:
   - **Chrome:** `ExtensionInstallForcelist` policy with the extension's ID and the URL of the `update_manifest.xml`.
   - **Edge:** equivalent `ExtensionInstallForcelist` group policy.

The extension uses only the `activeTab`, `scripting`, `offscreen`, and `contextMenus` permissions. It never reads the full browser history and never makes network calls (all OCR runs inside an offscreen document on this device).

---

## Air-gapped or no-CDN environments

For fully air-gapped deployments:

1. Download PDF.js and place it at `web/lib/pdf.min.js` and `web/lib/pdf.worker.min.js`.
2. In `web/app.js`, update the two CDN URLs in `loadPdfJs()` to relative paths: `lib/pdf.min.js` and `lib/pdf.worker.min.js`.
3. Do the same for `jszip.min.js` (used by batch-download): download from [npm](https://www.npmjs.com/package/jszip) and place at `web/lib/jszip.min.js`, then update the URL in `app.js`.

After these steps the app works with no external network calls at all, even in the AI-key path (which still calls Anthropic or OpenAI — that call cannot be removed, because it is the user's own API call going to their own key).

---

## Licence and data processing

VaultSnip is open source under the [Apache License 2.0](LICENSE). You may self-host, fork, and modify it freely. No licence key, no usage reporting, no call home.

No user data is ever sent to VaultSnip infrastructure. The Apache-2.0 licence and the [PRIVACY.md](PRIVACY.md) file in this repository govern what the software does. Review them before deployment to satisfy your organisation's data-processing requirements.

For questions about procurement, enterprise support, or custom deployments, open a [Discussion](https://github.com/karthikvalluri85/vaultsnip/discussions) or contact the maintainer via [SUPPORT.md](SUPPORT.md).
