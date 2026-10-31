# Store listing (Chrome Web Store and Edge Add-ons)

Text to paste into the store dashboards when uploading a new package (`./build.sh --bundle-models`, then
`dist/vaultsnip-extension.zip`). Keep it in step with [PRIVACY.md](PRIVACY.md) and `extension/manifest.json`: a listing
that describes something the package does not do (or the reverse) is a common reason for rejection.

## Name and summary

- **Name:** VaultSnip
- **Summary (132 characters max):** Turn sensitive dashboard snips into client-safe replicas. Text is masked on your device; nothing is sent or stored.

## Description

VaultSnip turns a screenshot of any dashboard or report (Power BI, Tableau, Looker, Excel, PDF report pages, product
analytics, SaaS apps) into a copy you can share: names, IDs, emails and numbers are found and hidden on your device, a
six-pass check re-reads the result before you share it, and the in-place replica is your own screenshot with each hidden
text replaced by made-up text of the same size and colour. Charts, maps and visuals keep their original pixels.

- Everything runs in your browser: reading (OCR), masking, the check and the replica. No account, no key, no upload,
  no analytics. The reader and the on-device AI models are packed inside the extension.
- Dashboards in English, German, French and Spanish: recognised automatically, with that language's report words kept
  readable and made-up names in that language.
- Blur a chart, or blur all charts at once, when a chart's shape is itself confidential.
- Each finding of the check comes with a close-up, likely leaks first.
- A safe-to-share receipt (PNG or PDF) records what was hidden (counts and kinds, never the text) and the image's
  SHA-256.
- Right-click "Blur text in charts on this page" (Alt+Shift+B) blurs sensitive text inside charts drawn on a live page.
- Measured, not promised: on our published test set about 0.3% of the area of sensitive text was still readable after
  masking and the check, so the review screen asks you to look before you share.

Free and open source (Apache-2.0): https://github.com/karthikvalluri85/vaultsnip

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
