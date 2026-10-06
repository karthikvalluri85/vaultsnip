# VaultSnip privacy policy

**Short version: VaultSnip stores nothing about you or your images.**

- **No accounts, no backend, no database.** VaultSnip is static code that runs in your browser.
- **Your images stay on your device.** Text recognition (OCR), masking and the safety check run locally in your browser. Images and results are held in memory and disappear when you close the tab.
- **What leaves your device.** Only when you click send, and only the *masked* image you approved, goes directly from your browser to Anthropic's API using your own API key. It never passes through VaultSnip's servers. Anthropic's API terms apply to that request.
- **Samples** send nothing at all.
- **What your browser keeps.** The OCR language model (an app file, cached so it downloads once) and, only if you tick "remember", your API key. You can remove the key at any time from "Claude key" → "Forget key".
- **Extension permissions.** `activeTab` only: the extension can capture the tab you are on, and only when you click its icon.
- **Exports** are files saved to your computer. They contain generated data, a watermark and a link to VaultSnip. They make no network calls by themselves.
- **No analytics, cookies or tracking** in this version.

Contact: open an issue or discussion on the GitHub repository.
