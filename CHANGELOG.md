# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **The AI-key path is measured** (`tools/ai-bench`, developer tool): generated, fictional dashboards are masked by the app and sent with the app's own request using the developer's key; the answers are scored against the on-device builder and checked for malformed layouts. On 60 dashboards Claude Sonnet 5.5 typed all 404 visuals right (96% end to end) for $1.44; see ACCURACY.md.

### Fixed
- **AI layouts fit the grid.** When an AI answer's row widths do not add up to the replica's 12-column grid (a quarter of answers did, on the AI-path benchmark), the app now scales them to fit instead of wrapping a visual onto its own line or leaving a gap.

## [0.7.0] - 2026-10-24

### Added
- **Combo and waterfall charts.** *Build on this device* now recognises columns with a line of their own over them (drawn on a second axis in the replica, with only the columns stacked) and waterfall charts, and reads stacked columns and grouped monthly columns more reliably. On the public dashboards 88% of visuals are now typed right (86% before).
- **Fewer stray panels.** A small figure inside a KPI card (a sub-total, a "vs LY" change) stays part of that card in the replica instead of becoming a panel of its own.
- **Pies, donuts and dense column charts are read right.** *Build on this device* now gets 81% of a public dashboard right end to end (74% before) and 88% of a generated one. It splits Tableau-style monthly columns packed side by side, ignores a legend's swatches and divider lines around a pie, reads a pie cut by the edge of the screenshot, and no longer takes a small multi-line chart for a KPI.
- **Build on this device reads more dashboards right.** On the generated benchmark it now gets 85% of a dashboard right end to end (77% before), and 74% on the public dashboards (70%). It keeps a line drawn in pieces as one line, reads a chart with coloured lines as a chart even when its labels line up like a table, no longer takes columns covering most of a chart for its background, reads a table's zebra stripes as rows instead of bars, and finds a pie whose edge is under a mask. Its confidence estimate is recalibrated: set on generated dashboards, checked on the public ones, where it is now within a few points on average.
- **A second reader for hard text (Phase 2b).** The unread-text check now reads each patch it finds once more with PaddleOCR's line reader (en_PP-OCRv5_mobile_rec, Apache-2.0, 7 MB, on the device), which is trained on single lines and reads small, faint and slanted text that the page reader misses; the page reader remains the fallback. On the generated benchmark, fewer sensitive words stay readable (5.8% to 5.6%) and fewer safe labels are masked (14.3% to 13.3%); on the public dashboards, users have 45 items to resolve instead of 56.
- **Maps and slanted text.** *Build on this device* now recognises filled maps (many irregular regions that touch one another), so a choropleth becomes a live map in the replica instead of a placeholder or a line chart. The extension's *Blur text in charts on this page* uses the same unread-text check as the app: text the reader cannot read, such as a slanted axis label with a name in it, is blurred too. It runs on the device with the model packed in the extension; if it cannot run, the reader's blur stands.
- **Build on this device finds far more of a dashboard (Phase 4(a)).** On the public benchmark it now finds 94% of the visuals (76% before) and gets 70% of a dashboard right end to end (50% before), with no AI key. It recognises outlined cards (the page's own colour with a thin border, as in Tableau and Looker), so a page of KPI tiles is read as one KPI per tile instead of dozens of fragments; it no longer swallows a top row of KPI cards as the page title, glues a tall card to the chart below, merges two stacked charts, or reads a stack of masked axis labels as KPI values; a bar's baseline allows for pixels lost to an axis line or a label's mask. Unread-text masks are now as tall as their text, and a region the detector merged from labels and chart marks no longer turns into one big grey block. The builder is also scored on the 60 generated dashboards (`tools/synth-bench/layout.mjs`, gated in CI), so a change that only suits the real benchmark shows up.
- **Text the reader missed is masked too (Phase 2).** A second on-device AI model (PP-OCRv5 text detection, Apache-2.0, 5 MB) finds every patch of text in the screenshot without reading it. Text that no mask and no confidently read safe word accounts for gets a second look (cut out, straightened if slanted, read again larger and with more contrast). It stays readable only if every word is read confidently and is safe; a mark the size of one character with no letter or digit in it (a line marker, a tick) is left alone; everything else is masked as *Unread text* (purple). On the generated benchmark, sensitive words left readable fall from 10.2% to 3.6%, and items to resolve on real dashboards from 100 to 50. On VaultSnip's own demo, the end of the confidential client name was readable before and is now masked. The cost: about 5 more safe labels in 100 are masked (mostly faint or slanted axis labels), and the on-device layout builder finds 76% of visuals on real dashboards instead of 80%, because it reads stacks of masked axis labels as small KPI cards; that is the first fix of Phase 4(a). It runs in the same Web Worker as the name check, only adds masks, and can be switched off under *Redaction policy*. Store packages include the model; see PRIVACY.md and THIRD_PARTY_NOTICES.md.
- **Accuracy you can rerun (Phase 0).** `npm run bench` downloads the public benchmark images, reads each one with the app's own review step in headless Chromium, and scores the on-device build against the hand annotations, so the benchmark no longer depends on files made by hand. [ACCURACY.md](ACCURACY.md) defines each figure, records the baseline (`tools/layout-bench/baseline.json`) and sets out the phases for raising it. Developer tool only: nothing changes for users, and the images are never committed.
- **Masking measured (Phase 1).** `tools/synth-bench` draws fictional dashboards with Vega-Lite, Plotly and HTML (never ECharts, which draws the replicas), with invented, seeded data and the position and kind of every word known, and scores the app's masking on them: words left readable after masking and after the pre-flight check, leaked area, safe words masked, and check false alarms, each with a 95% interval. Baseline on 60 dashboards: 10.2% of sensitive words still readable after the check, mostly words the reader never found; this is what Phase 2 targets. CI runs 8 of them on every pull request and the full set and the real-world layout benchmark nightly, failing if a figure gets worse than its baseline (`tools/bench-gate.mjs`). New development-only packages (Vega, Vega-Lite, Plotly.js, three Fontsource fonts) are pinned and listed in `THIRD_PARTY_NOTICES.md`; none ships in the app.

### Fixed
- **Pies are no longer masked whole.** The reader sometimes took a piece of a pie for a word, which was then masked; it is now left visible in the app and in the extension's chart blur. A value printed inside a slice, and any letters or digits, are still masked.
- **Tall full-page screenshots are masked properly.** The app shrank every image until its longest side was 2200 px, so a tall page came out with text too small to read, and unread text was not masked: on one tall test page 84 of 123 sensitive words stayed readable. The app and the text detector now keep a budget of pixels instead (a square screenshot is unchanged); that page now leaves 5. Across the generated benchmark, sensitive words left readable fall from 5.6% to 3.4%.
- **Charts' bars are no longer masked as text.** The reader sometimes took a bar for a word, and the unread-text check a bar beside its label for a line of text; both were masked, hiding the chart. A solid rectangle of colour with no letter-shaped hole in it is now left visible, in the app and in the extension's chart blur. Fewer safe labels are masked as a result (13.3% to 10.0%).
- **A reader that stops answering no longer freezes the review.** If the on-device text reader ever stops answering (for example when the computer sleeps in the middle of a reading), the progress figure used to stay stuck for good. A watchdog now notices when its progress has not moved for 30 seconds (silent, or repeating the same figure) or a pass runs past 2 minutes, restarts it and reads that pass again; if it stops a second time, the app says so and asks to try again instead of waiting forever.
- **A page header made mostly of masked text is no longer read as a chart** by *Build on this device*: mask grey is never taken as a panel's background, so the real background around the masks no longer looks like bars.

## [0.6.0] - 2026-10-22

### Added
- **Numbers are replaced with invented values instead of grey boxes.** In the masked image, every number (amounts, percentages, scores, temperatures, counts, changes) becomes a different, made-up value of the same size, so the image still reads like a real report: $4.2M might become $5.6M, 62.4% might become 41.9%, never the real value. Axis ticks are rebuilt as an even scale in the same order, years stay, and dates and times stay valid. Names, labels, emails and IDs stay masked. A note below the image, and above the masked view, says its numbers are made up. On by default; switch it off under *Redaction policy* for grey boxes. The pre-flight check still reads solid boxes, which cover exactly the same pixels.
- **How sure the on-device build is (Phase 3).** A replica built on this device now says how closely it is likely to match: *Looks complete*, *Check it before sharing* or *A draft*, with a rough percentage. Below 90% you choose what happens: **Fix it here** (a list of every visual with the uncertain ones marked *Check*, where you can change a visual's type, rename it or remove it, and the replica redraws), **Use my AI key**, or **Keep this result**. The estimate comes from measurable signals (how reliable each kind of visual is, fragments, titles, marks, panels that swallowed several visuals) and errs on the low side; developers can check it with `tools/layout-bench/confidence-check.mjs`.
- **A faithful benchmark.** `tools/layout-bench` now runs the builder in Chromium exactly as the app does (the browser decodes the image and draws the masks), so its figures match what users see.
- **Build on this device (beta).** The send dialog has a new choice: *Build on this device*. VaultSnip reads the layout from the masked image itself, with no AI key and nothing sent. It finds the panels (including cards), reads each one as a KPI, column, bar, line, area, pie, donut, scatter, treemap, table, pivot or text block, measures bar lengths, line heights, slice shares and dot positions as shapes, and takes titles, labels and report parameters from the words that stay readable. Masked words reach it only as positions. It runs in a Web Worker in about half a second. The replica says it was built on this device and offers *Use my AI key for a precise layout*. On a benchmark of 11 public Power BI, Tableau and Looker dashboards it finds 76% of the visuals and types 62% of those correctly; SSRS matrices are read in full. Developers can rerun the benchmark with `tools/layout-bench`.
- **Paginated reports.** Replicas now cover SSRS, Crystal Reports and BusinessObjects-style reports. A **matrix** (pivot / cross-tab) has up to two row and two column levels, several measures, subtotals and a grand total. Every total is the sum of the cells it covers, and clicking a row label filters the page. A **grouped table** shows each group value once and closes each group with a subtotal row and the table with a grand total. **Report parameters** (Fiscal Year, Territory…) appear above the page. The AI prompt describes these, and the allowlist keeps common report field words (Quantity, Invoice, Subcategory, Fiscal…). The CSV, HTML, Figma SVG and both React exports include them. The TypeScript export gains `<PivotCard>` and `<ParameterBar>`. In Generic mode, share links and exports keep the structure but no labels, members or parameter values. There is a new sample: *Paginated sales report*.
- **Industry-style synthetic names.** A covered organisation is named for what it is and for the dashboard's industry: on a healthcare dashboard a masked hospital becomes "Larchmont Health System" or "St. Perpetua Regional Hospital", a payer "Brightwater Health Plan", a clinician "Dr. …" (instead of "Item 1" or "Gutmann Inc"). The industry is read from the dashboard's own visible words; dimension names are matched in the plural too ("Top Accounts", "Facilities"). Names are assembled from Faker's seeded name lists and checked against well-known real organisations, which are never produced. Generic mode keeps neutral labels.
- **Editable TypeScript React export.** *Export React code* now offers an editable TypeScript project as well as the one-file component. The page structure is read from the replica (each card's kind, width and height, in order) and written as typed JSX, one component per card (`<KpiCard>`, `<ChartCard>`, `<TableCard>`…), plus a `useReplica` hook and types; reordering, removing or restyling a card is an ordinary JSX edit. Nothing is frozen: values, labels, table rows and chart options come at runtime from the engine's new `DSCReplica.model()`, so filters, chart clicks, "Download data (CSV)", search, the `seed`, `mode` and `realistic` props all work. Built on the device with no AI and no network; passes `tsc --strict`.
- **Realistic names.** Replicas fill people, companies, emails, phone numbers, IDs, places and products, and covered labels such as "[Client]" or "Item 2", with realistic made-up values (Faker, MIT) instead of "Person 3" or "TKN-4F2A". What each value is comes from its column or dimension name; the locale comes from each row's country, else the dashboard's map or currency. Emails in a row match that row's person. Values are seeded, so they stay the same on screen, in CSV and in HTML exports, and "Regenerate data" draws new ones. Emails use only example.com/.net/.org and phone numbers only fictional ranges. On by default in Shape-preserving and Structure-only modes, switchable in the toolbar; Generic mode keeps neutral placeholders. The React export ships the injector too, with a `realistic` prop.
- **Design export.** *Export for Figma (SVG)* saves the replica as one layered SVG: titles and labels are editable text, charts stay vectors, and the SYNTHETIC DATA watermark is drawn in. It opens in Figma, Penpot and Illustrator. *Export React code* saves a zip with a live React component that runs the VaultSnip replica engine: values, bubble sizes, labels, tooltips, cross-filtering and "Download data (CSV)" are all generated at runtime from its spec and a `seed` prop, and it can never show a less private mode than it was exported at. Both carry only what the current privacy mode shows and are made on your device.
- Extension: "Blur text in charts on this page" (right-click menu or Alt+Shift+B). Text inside charts drawn on canvas (Power BI, Tableau, ECharts, Chart.js, WebGL) is read on your device and sensitive text is blurred in place, with a re-check; redrawn charts are read again. Run it again to remove the blur. New permissions `scripting`, `offscreen` and `contextMenus` (no install warning, no host access); see PRIVACY.md.
- On-device name check: a small PII model (Apache-2.0, 19 MB) runs in a Web Worker and masks safe words used as names, such as "May Chen" or "Delta Airlines", that the allowlist would otherwise keep. It only adds masks ("Name in context", brown), never touches words you marked safe, runs before the pre-flight check, and can be switched off under *Redaction policy*. Model and runtime are served by VaultSnip itself; store packages include them.
- `CLAUDE.md` and new ground rules in `CONTRIBUTING.md`: ethics, privacy law and licences are checked before any change; only compatible licences; disclosure in `PRIVACY.md`; VaultSnip stays free and open source.

### Changed
- **Clearer review pane.** A summary shows how many words and numbers are **Hidden**, how many are **Kept readable**, and how many decisions are **yours**, with one plain sentence on what to do next. Categories use plain words ("Numbers and amounts", "IDs and codes"). *Review every item* lists each one with a Hidden/Shown switch, marks your own choices, and filters by All, Hidden, Shown or Your choices.
- CI and `engines` move to supported Node.js LTS (Node 20 reached end of life in April 2026): CI runs Node 24, and Node 22 or later is required.
- CI checks that every committed `web/lib` bundle matches its source, as it already did for the extension and the name-check model.
- CONTRIBUTING lists every build step and the full set of checks.

### Fixed
- **One progress figure while a screenshot is read.** The percentage used to restart for each of the ten reading and checking passes, so it ran to 100% several times. It now climbs once from 0 to 100% across reading and the check that follows, each pass counted by how much of the image it reads.
- **Numbers that label a visual are no longer masked.** A count after a ranking word ("Top 5 performers", "Bottom 10", "Last 30 days"), a position after a sequence word ("Week 34", "Step 2", "Page 1 of 3") and standard period labels (L12M, R12M, Q1-Q3, FY25-26, 2025-26, #1) stay readable. A number standing as a value ("Revenue 5", "Avg resolution 3 days") is still masked.
- **Your choices stick.** A mask you switch off is remembered: the pre-flight check no longer re-flags that spot, and *Re-apply policy* keeps it off. Before, unmasking a number blocked sending with no way out.
- **Blocking findings can be kept.** A number or ID the check flags now offers *Not sensitive, keep it* next to *Mask it*. It applies to that spot only; the same number elsewhere stays masked.
- **One click clears a spot.** Clicking a spot switches every mask there together, so a box you drew over an automatic one no longer leaves the automatic one in place.
- The in-app privacy page had fallen behind PRIVACY.md (it lacked *Realistic names* and *Design exports*). It is now generated from PRIVACY.md (`npm run build:privacy`), and `npm run check` fails if they differ.

### Security
- The web app now sends a **Content-Security-Policy** (`web/_headers`): scripts and data only from VaultSnip itself, and network access only to VaultSnip and the two AI providers a user can choose, so the browser itself enforces "no hidden data flow". The end-to-end test runs under the same headers and fails if anything is blocked.
- CI actions are pinned to commit SHAs; releases run the type check and unit tests before building packages; the release job alone gets write access.
- Dev dependency Vitest upgraded to 5 (fixes critical advisories in its worker pool; tests only, nothing shipped).

## [0.5.2] - 2026-10-11

### Fixed
- The app failed to start on Hugging Face Spaces ("Failed to execute 'insertBefore' on 'Node'"). The host adds its own script to the page's `<head>`, and the footer was inserted before that script instead of before the app's scripts in `<body>`.

## [0.5.1] - 2026-10-10

### Fixed
- Extension packages are accepted by Microsoft Edge Add-ons: `manifest.json` sits at the root of the zip, and the bundled OCR model ships uncompressed (the store refuses packages that contain compressed files).

## [0.5.0] - 2026-10-07

Brings together two lines of work that both started from 0.3.2: the 0.4.0 release (mask-only download, share links, CSV, ink pass) and customer comments.

### Added
- **Keep customer comments.** On voice-of-customer, support and review screens, VaultSnip finds quotes and free-text feedback and offers to keep their wording. Names, companies, emails, numbers and IDs inside the comments stay masked; everything else in the screen is masked as before. Off by default; the send dialog says when comments are included.
- Replicas show verbatims as a comment list (who said it, the quote, the score badge), like the source. Hidden words appear as a redaction bar. Generic mode replaces the quotes.
- The replica can only quote words that were readable in the image you approved; any other word the AI returns becomes a redaction bar.
- Table number columns can follow the source's visual cues (in-cell bars, green/amber/red badges), so a 2 stays red and a 10 stays green.

### Changed
- 0-10 survey scores are whole numbers. Organisation columns read "Company 01" instead of "Item 01".
- Extension packages for the Chrome Web Store and Edge Add-ons include the OCR model, so the extension works offline and makes no network request until an approved image is sent.
- Generic exports and share links never carry comment wording.

### Fixed
- With comments kept, the new ink pass could read stray numbers on top of comment words and mask them. Such readings are now ignored inside kept comments, and the check does not re-flag kept wording it reads again.

## [0.4.0] - 2026-10-07

From a product-owner, tester and BI review of eight sample screens (`test-samples/`, kept off GitHub).

### Added
- **Mask-only download.** After the pre-flight check, download the masked screenshot as a PNG. No AI key and no network needed, for forum posts, bug reports and slides. An optional small "masked with VaultSnip" tag is on by default.
- **Share links.** "Share link" packs the replica into the link itself (`#r=…`, compressed). Nothing is uploaded or stored. The sharer picks what the link keeps: Shape-preserving (labels and chart shapes), Structure-only (labels, no shapes) or Generic (layout only, all text replaced). Whoever opens the link cannot switch to a less private mode, re-sharing cannot widen it, and a hand-edited link is cut back to the level it claims.
- **Synthetic data download (CSV).** One row per data point (visual, dimension, member, series, value, format), read from what is on screen, so filters and the privacy mode apply. Opens directly in Excel, Power BI, Tableau, Looker Studio and Sheets. Also in the footer of exported and shared replicas.
- Review screen: Zoom 2×, a keyboard-friendly list of every mask, and a list of words kept as safe that masks any of them in one click.
- Replica: ratio KPIs ("4.52 / 5"), durations with units ("38 min"), "lower is better" measures (a fall shows green), a second axis for combo charts, box plots that follow the measured boxes, and empty cohort cells that stay empty.

### Fixed
- **Masking:** numbers could stay readable after the check passed. The reader and the check now add an "ink" pass that isolates text beside coloured bars, on tinted cells and in coloured deltas, keep low-confidence digits, ignore "1111" readings of bars, and mask a whole table column when a number between masked ones was skipped.
- **Untrusted labels:** chart labels could inject markup into tooltips and exported files. Every label from the AI is now stripped of markup and escaped.
- **Generic and Structure-only exports** embedded the original titles, labels and shapes in the file's source. Exports now carry only what their mode shows.
- Typing a name to mask after the check left "Pass" in place; sending is now blocked until the policy is re-applied.
- "Safe to keep" choices carried over to the next screenshot.
- A rejected key stayed remembered on the device.
- Wrong file types used a pop-up; WebP, GIF and BMP screenshots were refused.
- Exports and downloads are named after the dashboard (never in Generic mode).
- The header wrapped onto several lines on phones.

### Changed
- "Preview what is sent" is now "Preview masked image". Nothing can be downloaded or sent until you tick "I have looked over the masked image".
- Table dates are recent rather than fixed to 2026.

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

[Unreleased]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/karthikvalluri85/vaultsnip/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/karthikvalluri85/vaultsnip/releases/tag/v0.1.0
