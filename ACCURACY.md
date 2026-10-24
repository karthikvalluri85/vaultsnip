# Accuracy: what we measure, where we stand, and the plan

VaultSnip earns trust in two ways: it never lets sensitive text through, and the replica looks and behaves like the
dashboard in the screenshot. This page defines how both are measured, records the current figures, and sets out the
phases for raising them. Every figure here is reproducible with `npm run bench` (see [CONTRIBUTING](CONTRIBUTING.md)).

## What "accurate" means

People share a VaultSnip replica with a vendor, a forum, a client or a slide. For them it is trustworthy when:

1. **Nothing sensitive leaks.** This comes first and is never traded for anything else.
2. **It is recognisably their dashboard:** the same visuals in the same places, of the right kind.
3. **It is quick:** results within seconds, with no key needed for a first draft.
4. **It is honest when unsure:** it says which visuals it is unsure of instead of looking confidently wrong.

Numbers in a replica are invented on purpose, so matching the real values is never a goal. Accuracy means no leaks, the
right structure and the right shapes.

## The figures

| Figure | Meaning | Higher or lower is better |
|---|---|---|
| **Leaked area** | Share of the pixels of sensitive text left readable in the masked image | Lower. The target is 0 |
| **Over-masking** | Share of safe words (titles, axis labels) that were masked anyway | Lower, without raising leaked area |
| **Check caught leftovers** | Images where the pre-flight check, re-reading the masked image, still found readable text the first pass left | Lower. Today's proxy for leaks until leaked area is measured |
| **Visuals found** | Annotated visuals that the build places a panel on (the panel's centre is inside the visual, and the visual's centre inside the panel) | Higher |
| **Extra panels** | Panels the build adds where there is no visual | Lower |
| **Types right** | Visuals found that have the right chart type. Close cousins (line and area, combo and column) count | Higher |
| **End to end** | Visuals both found and typed right, out of all annotated visuals: the share of a dashboard that comes out right | Higher |
| **Report structure** | Checks on paginated reports (pivot or table, subtotals, grand total, row levels, parameters) that come out right | Higher |
| **Reading time** | Seconds from dropping an image in to the end of the pre-flight check, on the machine that ran the benchmark | Lower |
| **Honest confidence** | How far the on-device build's own confidence estimate is from its true score (`confidence-check.mjs`) | Lower |

Leaked area, over-masking and false alarms need every word in an image annotated, so they are measured on generated
dashboards (Phase 1, below), where every word's position and kind is known. Precisely:

- A sensitive word is **exposed** when more than 15% of its ink is not covered. Coverage is sampled over the word's ink
  box, the pixels its letters actually occupy, so a half-visible ID counts.
- **After masking** counts the masks alone; **after the check** also counts the pre-flight check's findings, which the
  user must resolve before anything can be sent. Exposure after the check is what would leak.
- **Leaked area** counts upright words only: a rotated label's box is mostly background. Rotated words are reported
  separately.
- A **false alarm** is a check finding that touches no sensitive word the masks left exposed.
- Word rates carry a 95% Wilson interval in brackets.

## Baseline (Phase 0)

Measured on 22 October 2026 at v0.6.0 with the on-device build ("Build on this device"), no AI key. This table rounds
the figures. [`tools/layout-bench/baseline.json`](tools/layout-bench/baseline.json) holds the latest accepted level
(Phase 2, below); its history holds this one.

| Figure | Baseline | Note |
|---|---|---|
| Visuals found | **80%** (64 of 80) | Power BI 89%, Looker 90%, Tableau 70%: Tableau KPI cards are the main miss |
| Extra panels | **31** | Mostly one Tableau page split into 20 panels for 9 visuals |
| Types right | **64%** of those found (41 of 64; 38 strict) | All 4 maps are mistyped; KPI cards read as charts and visuals left as placeholders are the other usual errors |
| End to end | **51%** | About half of a typical dashboard comes out right without an AI key |
| Report structure | **8 of 14** checks | The SSRS matrix is read in full; the grouped table and the parameter report are not |
| Check caught leftovers | **14 of 15** images | 100 items to resolve, 63 of them blocking, all numbers (the other 37 are words not on the allowlist, for review) |
| Reading time | **18 s** median, 35 s slowest | Headless Chromium on a mid-range Windows laptop |
| Honest confidence | Estimates off by **18 points** on average | No page reaches the 90% line, rightly: none is really above it. The estimate errs low, as designed |

What this tells us, as a user would feel it:

- **Masking is safe but noisy.** The pre-flight check works: it caught every number the first pass left readable, so
  nothing went out. But a user has to resolve something on nearly every screenshot, about 7 items on average. That is
  the biggest everyday friction, and it raises the first question for Phase 1: how many of those 63 are real misses and
  how many are false alarms.
- **The key-free draft is half right.** Good enough to show the shape of a dashboard, not to send unchecked. The AI-key
  path is not measured yet (it needs recorded responses, Phase 1).
- **Reading is slow.** 18 seconds is long for a "quick snip". Phase 2 must not make it slower, and should aim to cut it.

The benchmark set is small: 11 public dashboards (4 Power BI, 4 Tableau, 3 Looker), VaultSnip's own demo and 3 SSRS
reports. Treat its figures as a direction, not a guarantee: one dashboard more or less moves them by several points.
The set grows to about 40 in Phase 1. The images are fetched from their public sources for evaluation and never
committed; `truth.json` records each source and its terms.

## Masking baseline (Phase 1)

Measured on 23 October 2026 at v0.6.0 on 60 generated dashboards (5,027 sensitive words, 1,975 safe words), before
Phase 2. [`tools/synth-bench/baseline.json`](tools/synth-bench/baseline.json) holds the latest accepted level (Phase 2,
below); its history holds this one.

| Figure | Baseline |
|---|---|
| Sensitive words exposed after masking | **11.6%** [10.7–12.5] |
| Sensitive words exposed after the check | **10.2%** [9.4–11.1], 515 words, 222 of them rotated labels |
| Leaked area after the check (upright words) | **3.1%** |
| Safe words masked anyway | **9.0%** [7.8–10.4] |
| Check findings that are false alarms | **57%** [51–63] of 264 |
| By kind, exposed after the check | IDs 1.5%, emails 6.7%, numbers 8.3%, places 10.9%, organisations 12.4%, people 12.4%, products 14.3% |

**This is the most important finding so far.** About one sensitive word in ten stays readable, mostly whole words the
reader never found, so neither the masks nor the check knew they were there. Typical cases are labels next to bars,
labels around a pie, rotated axis labels, and text in low-contrast or dark themes. On four of the 60 images the check
passed while words were still exposed. The check catches only what it can read, and it also raises more false alarms
than real ones. That is exactly what Phase 2 addresses: find every patch of text first, whether or not it can be read,
and mask what is not confidently safe.

The generated set is deliberately hard: dense, small text, rotated labels, low contrast and JPEG compression on
purpose. Its rates describe these conditions, not every screenshot. They are still a real warning: until Phase 2 ships,
looking over the masked image in *Preview masked image* before sending is not optional.

Phase 1 status: the generated set, false-alarm labelling and the CI gates are done. Two parts are still open:

- **The real set grown to about 40.** Each new dashboard needs its visuals annotated by a person. Ground truth is never
  guessed.
- **The AI-key path scored.** Recording answers needs a maintainer's own key and costs a little per run. Only the masked
  images of public or generated dashboards are ever sent.

## Phase 2: nothing unread stays visible

Measured on 23 October 2026 with the unread-text check on (its default). It runs on the same 60 generated dashboards
and 15 public ones as the baselines above. The baseline files now hold these figures, so CI guards the new level.

| Figure | Phase 1 | Phase 2 |
|---|---|---|
| Sensitive words exposed after the check | 10.2% [9.4–11.1] | **3.6%** [3.1–4.2] |
| Leaked area after the check (upright words) | 3.1% | **1.2%** |
| Check findings for the user to resolve, generated set | 264 | **136** |
| Items to resolve on the public dashboards | 100 | **50** |
| Safe words masked anyway | 9.0% | **13.9%** [12.5–15.5] |
| Visuals found, public dashboards | 80% | **76%** |
| Chart type right / end to end, public dashboards | 64% / 51% | **66% / 50%** |
| Report structure checks | 8 of 14 | **7 of 14** |

How it works: a 5 MB text-region model (PP-OCRv5, Apache-2.0, on the device) finds every patch of text without reading
it. A patch that no mask and no confidently read safe word accounts for gets a *second look*: it is cut out
(straightened if slanted) and read again at a larger scale, as it is and with the contrast raised. It stays readable
only if every word is read confidently and is safe by the usual rules. A mark no bigger than one character in which no
letter or digit can be found (a line marker, a tick, a divider) is not text and stays as it is. Everything else is
masked as *unread text*.

The trade-off, accepted on purpose:

- **Gained.** Leaks fell to about a third, and users have half as many items to resolve. On VaultSnip's own demo, the
  end of the confidential client name in the header was readable before and is now masked.
- **Cost: labels.** About 5 more safe words in 100 are masked, mostly faint or slanted axis labels that cannot be read
  even on the second look. Text that cannot be read cannot be shown to be safe.
- **Cost: detection.** Visuals found on the public dashboards fell from 80% to 76% (3 of 80 visuals), and one report
  check was lost. The on-device layout builder reads a vertical stack of masked axis labels as several small KPI
  cards instead of one bar chart, and Phase 2 masks more such labels. Phase 4(a) fixes this first, and is done only
  when visuals found is back above 80%.
- **The false-alarm rate rose (57% → 83%)**, but there are fewer false alarms in absolute terms (113 against 150):
  almost all real misses are now masked before the check runs, so what it still flags is mostly noise.

The builder also learned one thing here: mask grey is never a panel's background. Without that, a page header made
mostly of masked text read as a bar chart.

Still open from this phase: the extension's *Blur text in charts on this page* does not use the detector yet.

## Phase 4(a): the on-device builder finds the visuals

Measured on 24 October 2026. Same 15 public dashboards and 60 generated ones, with Phase 2's masking on. The builder is
now also scored on the generated dashboards (`tools/synth-bench/layout.mjs`): a fix that only suits the 12 real
dashboards shows up there, so every change below was kept only if it helped both sets.

| Figure | Phase 1 | Phase 2 | Phase 4(a) |
|---|---|---|---|
| Visuals found, public dashboards | 80% | 76% | **94%** |
| Chart type right, public dashboards | 64% | 66% | **75%** |
| End to end, public dashboards | 51% | 50% | **70%** |
| Visuals found, generated dashboards | 62.6% | 62.6% | **92.8%** |
| End to end, generated dashboards | 41.9% | 40.8% | **69.8%** |
| KPI cards found and typed right, generated | | 10 of 97 | **83 of 97** |
| Sensitive words exposed after the check | 10.2% | 3.6% | 3.9% (within tolerance) |

What changed:

- **Outlined cards.** Many Tableau and Looker pages, and light themes, draw cards the page's own colour with only a thin
  border. The builder knew only filled cards, so it read such pages as dozens of fragments. It now pairs long thin lines
  into card rectangles, ignores a frame drawn round the whole image, and keeps only the outermost rectangles. This is
  most of the gain: the KPI page went from 2 of 9 visuals to 9 of 9.
- **KPI tiles.** A row of KPI cards across the top is no longer swallowed as the page title; a tall card holding a big
  value, a few words and next to no marks is a KPI however tall it is; a page of separate KPI tiles is not a report.
- **Charts kept apart.** A tall card is no longer glued to the chart below as if it were a title strip; two charts
  stacked one above the other stay two even when the upper one's title is masked.
- **Masks read for what they are.** A tight stack of masked axis labels is labels, not KPI values; a bar's baseline
  allows for a few pixels lost to an axis line or covered by a label's mask.
- **Masks the builder can read.** Unread-text masks are as tall as their text (no padding of their own), and a region
  the detector merged from labels and chart marks is no longer masked whole: only the words the second look reads
  there and cannot vouch for are masked.

Still open, in order of size: bars read as tables or lines when only a few of them are long enough to see, line charts
read as text, and maps (all four in the public set are still mistyped).

## The generated set, version 3 (24 October 2026)

Two changes to the generator, so the set measures real dashboards better. The figures from here on are on this set
and are not comparable with the ones above:

- **Realistic magnitudes.** Each chart's values now stay within one order of magnitude. Before, a value could be a
  thousand times its neighbours, leaving most bars a pixel long; that made the builder look worse on bars than it is.
- **Maps.** About one dashboard in three gets a filled map (world, Europe, USA, India or Brazil, from VaultSnip's own
  Natural Earth outlines) with a numeric legend: 27 maps in all.

| Figure (generated set v3) | Without map reading | With it |
|---|---|---|
| Visuals found | 89.1% | 89.1% |
| Type right, of those found | 81.1% | **85.8%** |
| End to end | 72.3% | **76.5%** |
| Maps typed right | 8 of 27 | **25 of 27** |
| Sensitive words exposed after the check | 5.8% [5.2–6.5] | (masking unchanged) |
| Safe words masked | 14.3% | |

**Maps.** The builder now reads filled maps: either many irregular regions touching one another, or one large
irregular mark holding many shades (neighbouring regions in close shades join), as long as the bar reader does not
find bars on a shared baseline in it and it is not round like a pie. On the public dashboards, the two Looker maps are
now read as maps (57 of 75 visuals typed right, 56 before); the Power BI map over street tiles and the Tableau map are
not yet.

**Masking on this set** is harder than on version 2: more numbers per dashboard, and map legends. Numbers are the
weakest kind (8.1% exposed after the check), which is the next masking target.

The extension's *Blur text in charts on this page* now runs the same unread-text check as the app (without the
app's second look, so a region far thicker than a line of text is left alone rather than blurring a whole chart).

## Phase 2b: a second reader for hard text

The plan's rule was to switch reader only if a better one wins. PaddleOCR's line reader (en_PP-OCRv5_mobile_rec,
Apache-2.0, 7 MB, on the device) now reads each patch the unread-text check finds once more, before the page reader
(Tesseract), which remains the fallback. It is trained on single lines, so it reads small, faint and slanted text the
page reader misses, and a patch it reads as safe words stays visible. Measured on 24 October 2026 on generated set v3
and the public dashboards:

| Figure | Without it | With it |
|---|---|---|
| Sensitive words exposed after the check | 5.79% | **5.58%** |
| Safe words masked anyway | 14.26% | **13.25%** |
| Items to resolve, public dashboards | 56 | **45** |
| Report structure checks | 7 of 14 | **8 of 14** |
| Visuals typed right, public dashboards | 76.0% | 74.7% (one visual, within tolerance) |

It wins on both sides of masking at once, so it ships, on by default with the rest of the unread-text check. The
page reader stays the main reader: replacing it everywhere would be a much larger change, for a later measurement.

## Generated set v4, and fixes from what it showed (24 October 2026)

Three changes to the generator, so its dashboards look like real ones: pie legends sit below the pie (beside it,
Plotly's legend box covered half the pie); category labels get at most a third of the panel's width, shortened with an
ellipsis as BI tools do (the chart libraries had squeezed a narrow panel's plot to a sliver); and overlapping axis
labels are hidden. Figures from here on are on this set (v4) unless marked v3.

Masking, both sets, measured with the app as committed in this change:

| Figure | v3 before | v3 now | v4 now |
|---|---|---|---|
| Sensitive words exposed after the check | 5.58% | **3.44%** [2.98–3.98] | **2.74%** [2.33–3.23] |
| Exposed by the masks alone | 5.72% | **3.52%** | **2.80%** |
| Safe words masked anyway | 13.25% | **10.04%** | **9.64%** |

Two changes did this:

- **A pixel budget instead of a longest side.** The app worked on images with their longest side cut to 2200 px, and
  the text detector at 1536 px. A tall full-page capture was shrunk by its height, until its text was too small to
  read, and text that is not read is not masked: one generated page (1920 x 4436) left 84 of its 123 sensitive words
  readable. Both now keep at most the pixels of a 2200 x 2200 (detector: 1536 x 1536) image, so a square screenshot is
  unchanged and a tall one costs no more than a large square one. That page now leaves 5.
- **A chart's bar is not a word.** The reader sometimes took a bar beside its label for a word, which was then masked,
  and the detector joined label and bar into one line of "unread text". A box that is one solid rectangle of colour
  with no hole in it, or a part of a line holding only such blocks, thin lines and specks, is no longer text. Glyphs
  never fill their box as one solid rectangle, and a value printed inside a bar is a hole in it or another colour, so
  both stay masked. The extension's chart blur does the same.

The on-device builder, v4 and the public dashboards:

| Figure | Before (v3) | Now (v4) | Public dashboards before | Now |
|---|---|---|---|---|
| Visuals found | 89.1% | **92.8%** | 94% | **95%** |
| Type right, of those found | 85.8% | **92.0%** | 74.7% | **77.6%** |
| End to end | 76.5% | **85.4%** | 70.0% | **73.8%** |

What changed in the builder, each checked on both sets:

- a line drawn in pieces (cut by a word box, a mask or a marker gap) is still one line;
- words on a grid make a table only when the panel has no coloured strokes and fewer than two vivid colours; otherwise
  the line and scatter readers come first, and the table is the fallback;
- a panel's background is the commonest colour along its inner border, not across the whole panel: columns covering
  most of a chart had been taken for its background, and the gaps between them for marks;
- a table's zebra stripes (four or more row-tall bands of one length with the row's words in them) are rows, not bars;
- a pie with an edge hidden under a mask is still found (the circle is fitted from the hull's longer side).

**Confidence (Phase 4(c)).** The rules in `src/layout/confidence.ts` were set on the generated pages
(`tools/synth-bench/layout.mjs --dump`) and checked on the public dashboards, which they never saw: maps have their
own prior, KPI and column priors rise, a "KPI" is penalised only over 15% of the page, and only a panel over 55% of the
page is penalised hard. Panel Brier score on the public dashboards 0.182 (0.190 before); page estimates there are 2.4
points low on average, and every page scored 90 or more on v4 really is.

**Still to do.** On the public dashboards, users now have 53 items to resolve (45 before): reading at a larger size
finds more words for the check to ask about. The builder's largest misses are small pies read as KPIs or tables,
Tableau's dense or grey monthly columns, and KPI cards with a sparkline; masking still covers some map regions as text.

## Pies, dense columns and generated set v5 (24 October 2026)

**Generator v5.** A pie's legend sits below it with a row of room per item (in v4 the legend was cut off and the pie
shrank to a dot). Figures from here on are on v5.

**A piece of a pie is not a word.** The reader took parts of pie slices for words, and the whole pie was masked. A
"word" taller than one and a half lines of text made of at least two thick regions of one colour each (slices, the
background), with any other pixels only on the seams between them, is now left visible, in the app and in the
extension. A value printed inside a slice, a letter's stroke and large KPI digits (even across a two-tone card) all
fail the test and stay masked. On the v4 images, masking held: exposed after the check 2.72% (2.74% committed), safe
words masked 9.59% (9.64%).

| Figure | v4 (committed) | v5 now |
|---|---|---|
| Sensitive words exposed after the check | 2.74% | **2.48%** [2.08–2.95] |
| Safe words masked anyway | 9.64% | **9.34%** |
| Generated: type right, of those found | 92.0% | **94.9%** |
| Generated: end to end | 85.4% | **87.9%** |
| Pies typed right (generated) | 33 of 48 found | **46 of 49** |
| Public dashboards: type right | 77.6% | **85.5%** (65 of 76) |
| Public dashboards: end to end | 73.8% | **81.3%** |

Builder changes, each checked on both sets:

- dense columns joined by 1 px lighter separators are split into columns even when the block is solid (Tableau's
  monthly columns: FinanceDashboard 12 to 15 of 18);
- a pie's outline ignores legend swatches and divider rules, and a pie cut by the panel's edge is still a pie (a
  Tableau donut, a Looker pie cut by the screenshot);
- two or more long coloured lines make a line chart, never a KPI, whatever its masks look like (a small Power BI
  line chart);
- the line prior of the confidence score rises to 0.7: the 90% line stays honest (every page scored 90 or more
  really is), and the panel Brier score is 0.154 on the public dashboards.

A rule to keep a KPI's sparkline from reading as a map (a map's outline has no straight bottom) was tried and dropped:
it lost a Looker map cut by its panel.

**Sub-figures of a KPI card.** A tiny KPI or placeholder panel with no chart in it ("Current workforce: 6,009" under a
card's big value) now joins the card that holds it or sits right above or below it: 3 fewer stray panels on the public
dashboards (89 instead of 92), nothing lost on either set.

Two masking ideas were measured and dropped, both for privacy:

- **Borders between regions as chart shapes** (so map pieces with white borders would stay visible). On a dashboard
  with a gradient background, a letter's stroke also lies between two shades, and the reader dropped real words
  ("Budget", "Trends") and three masked ones. A test now pins this: a word on a gradient is text for every shape test.
- **The pre-flight check skipping chart shapes.** It cut findings from 179 to 168 on the generated set, but the check is
  the independent second layer: filtering it with the same tests as the first reading would let one mistake pass both.

## The plan

Each phase ships on its own branch, must not lower any figure it does not target, and records its before-and-after
figures here. Every phase is checked first against the [ground rules](CLAUDE.md): privacy, law, licences and no hidden
data flow.

| Phase | What | Why it matters to someone sharing a dashboard | Done when |
|---|---|---|---|
| **0. Baseline** | A reproducible benchmark (fetch, read with the app's own review step, score), these definitions and the first figures | Every later change can prove what it does | This page and `baseline.json` exist and anyone can rerun them |
| **1. Measure leaks** | (a) A generated test set: fictional dashboards drawn with other charting tools than VaultSnip's (so we are not grading our own drawing), in many fonts, themes, sizes and compression levels, with every word's position known. (b) The real set grown to about 40. (c) Each pre-flight finding labelled as a real miss or a false alarm. (d) Recorded AI answers, so the AI-key path is scored too. (e) CI: a quick on-device run on each pull request and the full set nightly, failing if a figure drops | "Never leaks" becomes a measured number per kind of data (emails, names, numbers, IDs) instead of a promise, and we learn why users have something to resolve on almost every screenshot | Leaked area, over-masking and false alarms are reported with confidence intervals; both build paths are scored; CI guards every figure |
| **2. Nothing unread stays visible** | A small on-device text-region detector (an Apache-2.0 model, run in the browser) finds every patch of text, whether or not the reader could read it. Any region not covered by a confidently read, allowlisted word is masked. Applies to the app and to the extension's chart blur. Numbers the first pass misses are then masked before the check runs, instead of being left for the user | Text the reader misses (tiny, rotated, coloured) is masked instead of leaking, and the check stops asking the user to fix the first pass's misses | Leaked area falls; items to resolve per image fall from about 7 towards 1; over-masking rises no more than an agreed margin; reading time no slower than 18 s median |
| **2b. Better reader, if it wins** | Compare a stronger on-device reader with Tesseract on the Phase 1 set; switch only if it wins | More words kept readable, so better titles and labels | Data-backed decision either way |
| **3. A catalogue of chart types** | One schema of every chart type VaultSnip draws, with the data shape each needs. The AI prompt, a strict answer format for each provider, a check that each type is drawn, and a public gallery are all generated from it | Fewer malformed or invented answers from the AI; users can see what is supported | No malformed answers across recorded runs; adding a type means changing one file |
| **4. Spend effort where it is unsure** | (a) Fix the on-device build's largest misses: stacks of masked axis labels read as KPI cards (since Phase 2), KPI cards, pages split into too many panels, and maps. (b) The on-device build places the panels; only the panels it is unsure of are sent, as close-ups, to the user's AI. (c) The replica is compared with the masked image on the device and the panels that differ are flagged | Hard dashboards get more attention, easy ones stay fast and cheap; the key-free draft becomes good enough to share more often | Visuals found back above 80%; key-free end to end from 50% towards 70%; AI-key end to end rises while AI calls per screenshot stay about the same; confidence estimates within 10 points |
| **5. More chart types** | The types the benchmark shows we miss most, in that order (candidates: radar, sunburst, bullet, small multiples, slicers) | Fewer placeholders in replicas | "Chart types we cannot draw" falls |

**Priority (24 October 2026).** VaultSnip's goal is to find the visuals, charts and KPIs, mask the data and build an
interactive replica without any AI key. Work that improves the key-free path comes first: the rest of Phase 4(a), an
on-device self-check (4c), more chart types the builder reads (5), the detector in the extension's chart blur, and a
better reader (2b). Work that only improves the AI-key path (scoring it, the strict answer formats of Phase 3 and the
close-ups of 4b) comes after.

What is deliberately not in the plan:

- **Cloud text reading.** It would be more accurate, but the screenshot would leave the device.
- **Telemetry about accuracy in real use.** VaultSnip collects none. The only real-world signal is what people choose
  to report through *Report a problem*.
- **A headline accuracy claim before it is measured.** Published figures always name the set they come from, the
  version and the date, with real and generated results kept apart.
