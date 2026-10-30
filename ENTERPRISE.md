# VaultSnip — Enterprise & Self-Hosting Guide

VaultSnip is a static web application. No server, no database, no backend logic. Everything runs on the user's device. This guide explains how to run it inside a corporate network.

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
| PDF reader (PDF.js) | `<origin>/lib/pdfjs/` | 1.7 MB | First PDF opened |

Every file comes from the app's own origin, PDF reader included. On a self-hosted deployment nothing is fetched from anywhere else.

---

## What leaves the network

Nothing. VaultSnip has no AI service, no API key and no backend: reading, masking, the six-pass check and the replica all run in the browser tab. The page's Content-Security-Policy (`web/_headers`) lets it contact only its own origin, so a network monitor will see requests for the app's own files and nothing else. There is no domain to allowlist beyond the one you host it on.

---

## Extension deployment (optional)

The browser extension adds the ability to blur text inside charts on any live dashboard page (Power BI, Tableau, Looker, etc.) without leaving that page.

### Chrome / Edge managed deployment

For organisations using Chrome Browser Cloud Management or Microsoft Intune:

Once the Chrome Web Store and Edge Add-ons listings are live (in review at the time of writing), the simplest route is to force-install by store ID:

- **Chrome:** the `ExtensionInstallForcelist` policy with the extension's store ID and `https://clients2.google.com/service/update2/crx`.
- **Edge:** the `ExtensionInstallForcelist` group policy with its Edge Add-ons ID and `https://edge.microsoft.com/extensionwebstorebase/v1/crx`.

To host it yourself instead, build it with `./build.sh --bundle-models`, pack `dist/extension` as a signed `.crx` with your own key, and publish it with an `update_manifest.xml` on an internal server; Chrome and Edge accept off-store extensions only on managed devices.

The extension uses only the `activeTab`, `scripting`, `offscreen`, and `contextMenus` permissions. It never reads the full browser history and never makes network calls (all OCR runs inside an offscreen document on this device).

---

## Air-gapped environments

Copy the `web/` folder (or `dist/web` from `./build.sh`) to an internal static host. It needs nothing else: the OCR engine, its language model, the on-device AI models and the PDF reader are all files inside it, and the app calls no other server. The ZIP for batch downloads is made in the browser by the app itself.

---

## Licence and data processing

VaultSnip is open source under the [Apache License 2.0](LICENSE). You may self-host, fork, and modify it freely. No licence key, no usage reporting, no call home.

No user data is ever sent to VaultSnip infrastructure. The Apache-2.0 licence and the [PRIVACY.md](PRIVACY.md) file in this repository govern what the software does. Review them before deployment to satisfy your organisation's data-processing requirements.

For questions about procurement, enterprise support, or custom deployments, open a [Discussion](https://github.com/karthikvalluri85/vaultsnip/discussions) or contact the maintainer via [SUPPORT.md](SUPPORT.md).
