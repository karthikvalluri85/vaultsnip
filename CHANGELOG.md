# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-07

### Added
- **Keep customer comments.** On voice-of-customer, support and review screens, VaultSnip finds quotes and free-text feedback and offers to keep their wording. Names, companies, emails, numbers and IDs inside the comments stay masked; everything else in the screen is masked as before. Off by default; the send dialog says when comments are included.
- Replicas show verbatims as a comment list (who said it, the quote, the score badge), like the source. Hidden words appear as a redaction bar. Generic mode replaces the quotes.
- The replica can only quote words that were readable in the image you approved; any other word the AI returns becomes a redaction bar.
- Table number columns can follow the source's visual cues (in-cell bars, green/amber/red badges), so a 2 stays red and a 10 stays green.

### Changed
- 0-10 survey scores are whole numbers. Organisation columns read "Company 01" instead of "Item 01".
- Extension packages for the Chrome Web Store and Edge Add-ons include the OCR model, so the extension works offline and makes no network request until an approved image is sent.

## [0.3.2] - 2026-10-07

Tested against four product-owner screens (app health, pricing spreadsheet, voice of customer, support operations).

### Fixed
- Masking missed single digits, small numbers in pills and partial email addresses ([#8](https://github.com/karthikvalluri85/vaultsnip/issues/8)). The reader now also runs a high-contrast pass, and the pre-flight check adds a block-layout pass.
- Chart shapes read as giant "words" produced huge masks over charts ([#9](https://github.com/karthikvalluri85/vaultsnip/issues/9)). Implausible readings are now ignored; large KPI numbers are kept.
- The pre-flight check could keep flagging 1–2 letter fragments, there was no way to mask every finding at once, and common product words were masked ([#10](https://github.com/karthikvalluri85/vaultsnip/issues/10)). Added **Mask all N findings** and about 80 everyday product, support, finance and survey words to the allowlist.
- Table columns all had the same kind of numbers ([#12](https://github.com/karthikvalluri85/vaultsnip/issues/12)). Each column now gets values that fit its name (price, discount, margin, CSAT, NPS, change, ARR…), row labels keep their order and Total stays last.
- Implausible KPI, gauge and axis values, such as CSAT above 5 or a 99% KPI moving by 12% ([#13](https://github.com/karthikvalluri85/vaultsnip/issues/13)). A scale hint on one visual now applies to the same measure everywhere; gauges support min/max (for example NPS −100 to 100).
- Layout fidelity: heatmap rows were upside down, legends ran off the tile, crowded category labels were hidden ([#14](https://github.com/karthikvalluri85/vaultsnip/issues/14)). Labels now rotate instead of disappearing, narrow donuts label inside the ring.

### Known limits
- Slanted or vertical labels may not be read and so not masked ([#11](https://github.com/karthikvalluri85/vaultsnip/issues/11)). The send dialog now warns about them; check the preview and drag a mask over any you see.
- Masking takes about 20–25 seconds per screen (was about 11) because of the extra passes.

## [0.3.1] - 2026-10-07

### Fixed
- Hovering a waterfall chart, or a map region without data, raised "v.toFixed is not a function" ([#7](https://github.com/karthikvalluri85/vaultsnip/issues/7)). It affected replicas built with either provider. Number formatting now never throws; a value that is not a number shows as "–".
- A "column" chart is always vertical, even when the AI also sends `horizontal: true`.

### Added
- Gantt / timeline / roadmap visual: tasks drawn from start to end on the source's time axis, clickable to filter. Older replicas whose Gantt was a placeholder now draw one too.
- AI instructions now spell out vertical versus horizontal, stacked versus side-by-side, and how to describe a Gantt.
- Regression tests: hover every chart in both samples, and render AI-shaped edge cases.

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

[Unreleased]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/karthikvalluri85/vaultsnip/releases/tag/v0.1.0
