# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-07

### Added
- Bring your own **OpenAI** key as well as Claude. The key type is detected automatically, "Check key" lists the models the key can use and picks a recommended one, and the masked image goes straight to the chosen provider.
- Provider and model appear in feedback diagnostics (never the key).

### Changed
- "Claude key" is now "AI key". All provider calls live in `web/llm.js`.
- Unticking "remember" in the key dialog now also forgets a previously remembered key.
- The launch guide is kept privately, outside the public repository.

## [0.2.0] - 2026-10-07

### Added
- Maps: filled, bubble, density and flow maps with 16 bundled outlines (world, Europe and 14 countries), clickable and cross-filtering.
- Real cross-filtering on every visual: chips, chart clicks and table rows change every number on the page.
- In-app feedback: report a bug, a replica problem, an idea or a question, with a private route for masking misses; errors offer "Report this".
- Live web app at https://vaultsnip.pages.dev.
- Community and quality files: issue forms, security policy, contributing guide, code of conduct, CI checks and an end-to-end test.

### Changed
- Dimensions that mean the same thing ("Country", "Countries", "Country/Region") share one filter; places match by geography ("UK" = "United Kingdom").
- Exported replicas link to the live site.

## [0.1.0] - 2026-10-06

### Added
- First browser-only release: local OCR, mask-by-default with allowlist, independent re-scan gate, exact-payload approval, bring-your-own Claude key, synthetic replica with three privacy modes, offline HTML export, Chrome/Edge extension.

[Unreleased]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/karthikvalluri85/vaultsnip/releases/tag/v0.1.0
