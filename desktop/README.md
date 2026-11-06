# VaultSnip desktop

The same VaultSnip as the web app, in a window of its own, with the three things a web page cannot do:

- **a hotkey that works anywhere** — Ctrl+Alt+V (Control+Option+V on a Mac),
- **a screenshot of the screen** — drag over the part you want,
- **the clipboard without a click** — once the check passes, the masked image is on it. Paste it anywhere.

Closing the window keeps VaultSnip in the tray, so the hotkey keeps working; *Quit* is in the tray menu.

Everything runs on this computer: the screenshot goes from the screen to the window and to the clipboard as pixels in
memory. Nothing is written to disk, sent anywhere or stored. The page inside the window is `web/` exactly as published,
served from the app itself (no site is contacted, not even vaultsnip.pages.dev).

## How it is built

A [Tauri 2](https://tauri.app) shell (`src-tauri/`, Rust, about 150 lines) around `../web`:

- `tauri-plugin-global-shortcut` registers the hotkey,
- [`xcap`](https://github.com/nashaofu/xcap) takes the screenshot of the primary monitor, with the VaultSnip window hidden first,
- `tauri-plugin-clipboard-manager` puts the PNG on the clipboard,
- `web/app.js` has a small bridge (`isDesktop`): it listens for the shell's `snip` event and opens its crop screen, sends
  the finished PNG to the shell's `copy_png` command, and copies on its own once the check passes.

The window's content security policy is the same as the site's (`web/_headers`), plus the cross-origin isolation headers
the on-device AI's multi-threaded WASM needs.

## Build it yourself

Needs [Rust](https://rustup.rs) and Node 22+. On Linux also the WebKitGTK and GTK development packages
(see `.github/workflows/desktop.yml` for the exact list).

```bash
cd desktop
npm ci
npm run icons     # the platform icon set from web/icons/logo-1024.png (already checked in; run after changing the logo)
npm run dev       # run it
npm run build     # installers in src-tauri/target/release/bundle/
```

Or run the **Desktop app** workflow on GitHub (Actions → Desktop app → Run workflow): it builds Windows (.msi, .exe),
macOS (.dmg, universal) and Linux (.AppImage, .deb) and keeps them as workflow artifacts. A `desktop-vX.Y.Z` tag does
the same and attaches them to a draft release.

## Signing

The builds are unsigned. Windows SmartScreen and macOS Gatekeeper will warn on first launch ("unknown publisher");
users can still run it. To remove the warning, add a code-signing certificate: Tauri reads
`TAURI_SIGNING_PRIVATE_KEY` (updater), `APPLE_CERTIFICATE` / `APPLE_ID` (macOS notarization) and a Windows certificate
from the workflow's secrets; see [Tauri's signing guide](https://tauri.app/distribute/sign/). Certificates cost money, so
this is a step for later, once the app has users.

## Not yet

- The screenshot is of the primary monitor. Choosing a monitor, or snipping across monitors, is not there yet.
- The hotkey is fixed. Making it configurable is a small change to `lib.rs` and a settings control.
- No auto-update; a new version is a new installer.
