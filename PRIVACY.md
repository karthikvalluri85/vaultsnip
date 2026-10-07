# VaultSnip privacy policy

**Short version: VaultSnip stores nothing about you or your images.**

- **No accounts, no backend, no database.** VaultSnip is static code that runs in your browser.
- **Your images stay on your device.** Text recognition (OCR), masking and the safety check run locally in your browser. Images and results are held in memory and disappear when you close the tab.
- **What leaves your device.** Only when you click send, and only the *masked* image you approved, goes directly from your browser to the AI provider you chose, **Anthropic (Claude)** or **OpenAI**, using your own API key. It never passes through a VaultSnip server. That provider's API terms and data policy apply to the request.
- **Samples** send nothing at all.
- **What your browser keeps.** The OCR language model (an app file, cached so it downloads once) and, only if you tick "remember", your API key, its provider and the model name. You can remove them at any time from "AI key" → "Forget key". "Check key" asks the provider which models the key can use; it sends only the key.
- **Extension permissions.** `activeTab` only: the extension can capture the tab you are on, and only when you click its icon.
- **Downloads** (the masked PNG and the CSV of generated data) are made in your browser and saved to your computer; nothing is sent.
- **Share links** hold the replica inside the link itself (the part after `#`, which browsers never send to a server). VaultSnip uploads and stores nothing. A link carries only what the level you pick shows: titles, labels and chart shapes (Shape-preserving), titles and labels (Structure-only) or the layout alone (Generic). It never carries your screenshot, the masked image or any real value. Anyone you give the link to can open it.
- **Exports** are files saved to your computer. They contain generated data, a watermark and a link to VaultSnip, and only the labels their privacy mode shows. They make no network calls by themselves.
- **Feedback is your choice.** The Feedback button prepares a report (VaultSnip version, browser, the step you were on, chart types and any error message, never your screenshot or dashboard text). Nothing is sent until you choose to continue on GitHub, where it is posted under your GitHub account, or to email it from your own mail app. GitHub's or your email provider's terms apply.
- **No analytics, cookies or tracking.**

_Last updated: 7 October 2026._

Contact: use **Feedback** in the app, open an issue or discussion on [GitHub](https://github.com/karthikvalluri85/vaultsnip), or report security concerns privately as described in [SECURITY.md](SECURITY.md).
