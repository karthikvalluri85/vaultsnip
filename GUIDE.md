# VaultSnip launch guide (first-timer friendly)

Follow the steps in order. Each step ends with a check so you know it worked. Total time: about 3 to 4 hours spread over a few days, mostly waiting for store reviews.

**The three channels**

| Channel | What users get | Where it lives |
|---|---|---|
| Web app | vaultsnip.pages.dev (or your domain) | Cloudflare Pages, free |
| Chrome and Edge extension | Toolbar button that snips the current tab | Chrome Web Store, Microsoft Edge Add-ons |
| Hugging Face Space | Try-it-now demo for the AI community | huggingface.co/spaces/<you>/vaultsnip, free |

Plus a launch blog post on karthik.datagunner.com and the open-source repo on GitHub.

---

## Step 0. What you have

`vaultsnip-source.zip` is the whole project, already a Git repository with a first commit. `vaultsnip-extension-dev.zip` is a ready-to-load extension for testing (the OCR model is packed inside).

Unzip `vaultsnip-source.zip` somewhere easy, for example `Documents/vaultsnip` (Windows) or `~/Projects/vaultsnip` (Mac).

## Step 1. Install three tools (once)

1. **Git**: https://git-scm.com/downloads. On Windows this also installs **Git Bash**, which you need for `build.sh`.
2. **VS Code**: https://code.visualstudio.com
3. **Python 3** (for a local test server): https://www.python.org/downloads. On Windows, tick "Add python.exe to PATH" during install.

Check: open a terminal and run `git --version` and `python --version` (Mac: `python3 --version`). Both print a version.

## Step 2. Open it in VS Code and run it locally

1. VS Code → **File → Open Folder…** → choose the `vaultsnip` folder.
2. **Terminal → New Terminal**, then:
   ```bash
   cd web
   python -m http.server 8080        # Mac: python3 -m http.server 8080
   ```
3. Open http://localhost:8080 in Chrome. Click **Try with sample dashboards → Run the demo**.

Check: in about 15 seconds you see coloured boxes, and the pre-flight check says **Blocked** because it caught a missed value. Click **Mask it** on each item, then **Preview what is sent → Build replica**. You get the interactive replica. Try the three privacy modes and **Export HTML**.

Stop the server with Ctrl+C when done.

## Step 3. Put the code on GitHub

**Easiest way (inside VS Code)**
1. Click the **Source Control** icon on the left (the branch symbol).
2. Click **Publish Branch** → sign in to GitHub when asked → choose **Publish to GitHub public repository** → name it `vaultsnip`.

**Or with commands**
1. Go to https://github.com/new → Repository name `vaultsnip` → **Public** → do **not** add a README, .gitignore or license (they already exist) → **Create repository**.
2. In the VS Code terminal (at the project root, not inside `web`):
   ```bash
   git remote add origin https://github.com/karthikvalluri85/vaultsnip.git
   git branch -M main
   git push -u origin main
   ```
   A browser window asks you to sign in the first time.

Check: https://github.com/karthikvalluri85/vaultsnip shows the README.

**Day-to-day after this:** change files → Source Control → type a message → **Commit** → **Sync Changes**.

## Step 4. Channel 1: web app on Cloudflare Pages

1. Sign up at https://dash.cloudflare.com/sign-up (free).
2. **Workers & Pages → Create → Pages → Connect to Git** → authorise GitHub → pick `vaultsnip`.
3. Settings:
   - Project name: `vaultsnip` (gives `vaultsnip.pages.dev` if free; otherwise note the name you get)
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `web`
4. **Save and Deploy**.

Check: open `https://vaultsnip.pages.dev` and run the sample demo again. Also open `https://vaultsnip.pages.dev/privacy.html`; you'll need this link for the stores.

From now on, every push to GitHub redeploys the site automatically.

Optional: point `vaultsnip.datagunner.com` at it via **Custom domains** in the Pages project.

## Step 5. Point the product at its new home

Edit two things, commit, and push:

1. `web/replica.js`, line with `PRODUCT_URL`: set it to your live site, e.g. `https://vaultsnip.pages.dev`. This is the footer link in every export.
2. Build the release extension so the OCR model downloads on first launch instead of sitting in the package. In **Git Bash** (Windows) or Terminal (Mac), at the project root:
   ```bash
   ./build.sh --model-url https://vaultsnip.pages.dev/lang
   ```
   This creates `dist/vaultsnip-extension.zip`, `dist/vaultsnip-web.zip` and `dist/vaultsnip-hf-space.zip`.

## Step 6. Channel 2: the extension

### 6a. Test it on your own browser first
1. Chrome: open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right in Chrome, left panel in Edge).
3. Click **Load unpacked** and choose the `dist/extension` folder (or the unzipped `vaultsnip-extension-dev` folder).
4. Pin the VaultSnip icon (puzzle-piece menu → pin).
5. Open any dashboard or report page, click the VaultSnip icon, drag over the area, **Use selection**.

Check: the first run shows "Loading the on-device text reader (first run only)", then the boxes appear. After a change to the code, click the **reload** arrow on the extension card.

### 6b. Publish to the Chrome Web Store
1. Register at https://chrome.google.com/webstore/devconsole (one-time registration fee, US$5 at the time of writing; check the current amount there).
2. **New item** → upload `dist/vaultsnip-extension.zip`.
3. Fill in the listing (copy-paste text below), upload the 128 px icon (`web/icons/icon128.png`) and at least one 1280×800 screenshot (`docs/store/`).
4. **Privacy practices** tab:
   - Single purpose: *Converts a screenshot of the current tab into a redacted, interactive replica.*
   - `activeTab` justification: *Captures the visible tab only when the user clicks the toolbar icon, so they can choose the area to convert.*
   - Remote code: **No.** (The OCR model is data, not code. All code ships in the package.)
   - Data usage: tick **none** of the data types. Certify the three statements.
   - Privacy policy URL: `https://vaultsnip.pages.dev/privacy.html`
5. **Submit for review.** Reviews usually take a few days.

### 6c. Publish to Microsoft Edge Add-ons
1. Register at https://partner.microsoft.com/dashboard/microsoftedge (Partner Center).
2. **Create new extension** → upload the same `dist/vaultsnip-extension.zip`.
3. Fill the same listing text and privacy URL → **Publish**. Certification can take up to 7 business days.

### Store listing text (copy-paste)
- **Name:** VaultSnip
- **Short description (max 132 characters):** Turn sensitive report snips into client-safe replicas. Masks sensitive text on your device. Stores nothing.
- **Category:** Productivity (or Developer Tools)
- **Description:**
  > VaultSnip turns a screenshot of any dashboard or report into a watermarked, interactive replica that runs on generated data, so you can share the design without sharing the data.
  >
  > • Click the icon, drag over the report, done.
  > • Sensitive text is masked on your device: names, numbers, IDs and anything not on the safe list.
  > • A second scan checks the masked image before anything leaves, and you approve exactly what is sent.
  > • Three privacy modes: keep the shape, keep only the structure, or make it fully generic.
  > • Export one self-contained HTML file that works offline.
  > • No account. Nothing stored. Bring your own Claude key for your own images; the samples need none.

## Step 7. Channel 3: Hugging Face Space
1. Create an account at https://huggingface.co/join.
2. https://huggingface.co/new-space → Space name `vaultsnip` → License `apache-2.0` → SDK **Static** → Public → **Create Space**.
3. In the Space: **Files → Add file → Upload files** → drag in **everything inside** `dist/hf-space` (including `README.md`, `lib`, `lang`, `icons`, `samples`) → **Commit changes**.

Check: the Space page shows the VaultSnip app and the sample demo runs.

## Step 8. Blog post and launch
1. `docs/blog-launch.md` is your launch post. Paste it into the blog editor on karthik.datagunner.com; upload the images from `docs/images/` where the post marks them.
2. Replace the `[link]` placeholders with your Cloudflare, store, Space and GitHub links.
3. Share on LinkedIn with a 20–30 second screen recording: snip → boxes → Blocked → mask → replica → export.

## Step 9. Before you announce
- [ ] Employment agreement checked (IP and outside-business clauses)
- [ ] Only fictional or public material in every demo and screenshot, never client dashboards
- [ ] `PRODUCT_URL` points at the live site
- [ ] Extension built with `--model-url` and tested once more after loading unpacked
- [ ] Privacy page live and linked in both stores

## When something goes wrong
| Symptom | Fix |
|---|---|
| Blank page or "reader could not start" when opening `index.html` by double-click | Use a local server (Step 2); OCR needs http |
| `./build.sh: Permission denied` | Run `chmod +x build.sh` once, or use `bash build.sh` |
| `./build.sh` not recognised on Windows | Run it in **Git Bash**, not PowerShell |
| Extension shows an error on chrome:// pages | Browsers don't allow capturing their own pages; use a normal website |
| "Claude rejected the key" | Create a new key at console.anthropic.com and paste it again |
| Store review rejects for permissions | Paste the `activeTab` justification above word for word |
