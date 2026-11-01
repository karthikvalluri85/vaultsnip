# Store listing (Chrome Web Store and Edge Add-ons)

Text to paste into the store dashboards when uploading a new package (`./build.sh --bundle-models`, then
`dist/vaultsnip-extension.zip`). Keep it in step with [PRIVACY.md](PRIVACY.md) and `extension/manifest.json`: a listing
that describes something the package does not do (or the reverse) is a common reason for rejection.

## Name and summary

- **Name:** VaultSnip
- **Summary (132 characters max):** Turn sensitive dashboard snips into client-safe replicas. Text is masked on your device; nothing is sent or stored.

## Description

Paste this as plain text. It names no BI products on purpose: a list of product names reads as keyword spam to the Chrome
Web Store (the first submission was rejected for it).

```
VaultSnip turns a screenshot of a dashboard or report into a copy you can share safely.

Names, emails, phone numbers, IDs and amounts are found and hidden on your own device. A six-pass check then reads the masked image again before you share it. The replica is your own screenshot with each hidden text replaced, in the same place, by made-up text of the same size and colour. Charts, maps and visuals keep their original pixels.

How it works
• Click the VaultSnip icon to snip the tab you are on, or drop in any screenshot.
• Review the masks. Add one by dragging over anything you want hidden, or toggle one off.
• Look over the masked image, then download or copy the replica.

Private by design
• Everything runs in your browser: reading the text, masking, the check and the replica.
• No account, no upload, no analytics. The text reader and the small on-device AI models are packed inside the extension, and it makes no network requests.

Also included
• Blur a chart, or all charts at once, when the chart's shape itself is confidential.
• Each finding of the check comes with a close-up, likely leaks first.
• A safe-to-share receipt (PNG or PDF) lists what was hidden (counts and kinds, never the text) and the image's SHA-256 fingerprint.
• Right-click "Blur text in charts on this page" (Alt+Shift+B) blurs sensitive text inside charts on a live page.

Reads English dashboards.

Honest about limits: on our published test set about 0.25% of the area of sensitive text was still readable after masking and the check. That is why VaultSnip asks you to look over the masked image before you share it.

Free and open source (Apache-2.0): https://github.com/karthikvalluri85/vaultsnip
```

## Single purpose

Masks sensitive text in screenshots of dashboards and reports, on the user's device, so they can be shared safely.

## Permission justifications

- **activeTab:** to capture the tab the user is on when they click the icon, the menu item or the shortcut.
- **scripting:** to run the chart-text blur in that tab when the user asks for it.
- **offscreen:** a hidden extension page that reads chart text on the device for the blur.
- **contextMenus:** the "Blur text in charts on this page" menu item.
- **Host permissions:** none.

## Remote code

No. All code and models are in the package; the extension makes no network request.

## Data usage (privacy practices)

Collects nothing. No personally identifiable information, health, financial, authentication, personal communications,
location, web history, user activity or website content is collected or transmitted. Images and text read from them are
processed in memory on the device and discarded when the tab closes. Certify: data is not sold, not used or transferred
for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

**Privacy policy URL:** https://vaultsnip.pages.dev/privacy.html
