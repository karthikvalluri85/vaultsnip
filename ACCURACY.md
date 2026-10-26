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
| **Layout match** | Visuals that share a row in the original share one in the replica (pairs), and each visual's width and position overlap its original's | Higher |
| **Shape match** | Charts with the right number of categories, and how closely their bars, lines and slices follow the original's relative sizes | Higher |
| **Text match** | Of the title words and category labels left readable by masking, the share the replica shows | Higher |
| **Colour match** | Dashboards whose replica's main colour is close to the original's main series colour | Higher |
| **Generic labels left** | Labels in the rendered replica (outside Generic mode) that are placeholders: "Item 1", "Value", "Series 2", "Category", "Period", "KPI" and the like | Lower. The target is 0, and it is non-negotiable |

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

## Phase 5: combo and waterfall charts (24 October 2026)

The replica already drew combos and waterfalls; the builder now reads them, so a replica shows what the original
shows instead of a plain column chart:

- **Combo.** Columns with a line over them in a colour of its own (a "% change" over counts, a total over stacked
  columns). The line is read at each category, on a scale of its own, so the replica draws it on a second axis. It
  must cross each column of pixels once and keep changing height: a gridline network of a tinted grey (dark themes) is
  not a line. In the replica only a combo's columns stack.
- **Waterfall.** Columns that do not share a baseline but chain, each starting where the one before ended, with
  totals on the baseline; read before columns, since two of its columns stand on the baseline.
- **Stacked columns** count segments standing on another segment as standing (the bar reader had missed a stacked
  chart whose segments mostly float on one another).
- **Grouped columns** split categories at the threshold that best separates the gaps (Otsu's method): one unusually
  wide gap, where a mask hides a column, had merged eleven months into two.
- A broken line's pieces must not overlap across, so gridlines at several heights never join into a "line".

| Public dashboards | Before | After |
|---|---|---|
| Visuals typed right (lenient) | 65 of 76 | **67 of 76** (88.2%) |
| Typed exactly right (strict) | 61 | **64** |
| End to end | 81.3% | **83.8%** |

The Power BI HR page is now read entirely right: both its combos (clustered and stacked columns, each with a line),
its waterfall, and its grouped monthly columns with every month. On the generated set (which has no combos or
waterfalls) nothing changes: 94.9% typed right; 65 of 76 visuals on the public dashboards are typed exactly right.

The clustered combo's line crossed eleven pairs of columns and broke into small pieces; small pieces now join a broken
line, but only as a chain (each starting near where the one before ended, at about its height), so a map's small
regions of one colour never join into a "line". A flat stretch of line is solid enough to pass for a sliver of a
column; a colour whose "columns" are all a few pixels tall and that forms a long line is the line.

## The AI-key path, measured (24 October 2026)

`tools/ai-bench/run.mjs` measures the optional AI path the way a user meets it: each generated dashboard is read and
masked by the app, and the approved masked image goes to the provider with the app's own request (same instructions,
parsing and retry), using the developer's key from the environment. The on-device builder reads the same masked image,
and both are scored by chart type: each annotated visual is matched to a visual of its type (or a close cousin), and
extra visuals count against it. Only generated, fictional dashboards are sent; the public dashboards were collected for
local evaluation only and are never sent. Answers are recorded, so `--rescore` scores them again with no key and no cost.

| 60 generated dashboards (set v5), 404 visuals | Typed right | Extra | End to end |
|---|---|---|---|
| Claude Sonnet 5.5 (the app's default model), with a key | **404** | 15 | **96.4%** |
| On the device, no key | 343 | 17 | **81.5%** |

The run cost **## The AI-key path, measured (24 October 2026)

`tools/ai-bench/run.mjs` measures the optional AI path the way a user meets it: each generated dashboard is read and
masked by the app, and the approved masked image goes to the provider with the app's own request (same instructions,
parsing and retry), using the developer's key from the environment. The on-device builder reads the same masked image,
and both are scored by chart type: each annotated visual is matched to a visual of its type (or a close cousin), and
extra visuals count against it. Only generated, fictional dashboards are sent; the public dashboards were collected for
local evaluation only and are never sent. Answers are recorded, so `--rescore` scores them again with no key and no cost.

| 60 generated dashboards (set v5), 404 visuals | Typed right | Extra | End to end |
|---|---|---|---|
| Claude Sonnet 5.5 (the app's default model), with a key | **404** | 15 | **96.4%** |
| On the device, no key | 343 | 17 | **81.5%** |

The run cost **$1.44** (370,234 tokens in, 69,965 out): about 2.4 cents a dashboard. No request failed.

**What this means for the plan.** Phase 3 (a strict answer format) was meant to stop malformed or invented answers.
`tools/ai-bench/validate.mjs` checks every answer against the shape the instructions define. The only problem found:
in 25 of 60 answers, 41 rows whose widths did not add up to the 12-column grid, which made the replica wrap a visual
onto its own line or leave a gap. No unknown types, no series of the wrong length, no failed parse. The app now fits a
row's widths to 12 when it reads an answer, keeping their proportions, so a full strict format is not needed for this
model; it stays a candidate if another provider or model misbehaves.

The gap between the two paths (96% and 82% end to end, by type) is mostly visuals the on-device builder misses
entirely, not visuals it types wrongly: it is the target of the resemblance work below.
.44** (370,234 tokens in, 69,965 out): about 2.4 cents a dashboard. No request failed.

**What this means for the plan.** Phase 3 (a strict answer format) was meant to stop malformed or invented answers.
`tools/ai-bench/validate.mjs` checks every answer against the shape the instructions define. The only problem found:
in 25 of 60 answers, 41 rows whose widths did not add up to the 12-column grid, which made the replica wrap a visual
onto its own line or leave a gap. No unknown types, no series of the wrong length, no failed parse. The app now fits a
row's widths to 12 when it reads an answer, keeping their proportions, so a full strict format is not needed for this
model; it stays a candidate if another provider or model misbehaves.

The gap between the two paths (96% and 82% end to end, by type) is mostly visuals the on-device builder misses
entirely, not visuals it types wrongly: it is the target of the resemblance work below.

## Phase 4(d): does the replica resemble the original? (24 October 2026)

Finding the visuals and their types does not make a replica recognisably the user's dashboard. The generated set's
truth now records each visual's title, categories, values (in the order they are drawn) and series colour, and
`tools/synth-bench/resemble.mjs` compares each visual the on-device builder found with its original. It also renders
every replica as the app shows it (Shape-preserving mode, realistic names on) and counts placeholder labels.

| Generated set v5, on-device builder | Before | After |
|---|---|---|
| Visuals sharing a row in the original share one in the replica (pairs) | 91.6% | 91.6% |
| Width and position match (overlap) | 76.5% | 76.5% |
| Charts with the right number of categories | 59.2% | **70.9%** |
| Bars, lines and slices follow the original, where the count is right | 97.8% | 97.5% |
| Readable title and label words the replica shows | 64.2%* | **89.3%** |
| of which titles / category labels | | 95.9% / 46.8% |
| Main colour right | 85% | 85% |
| **Generic labels left in the rendered replicas** ("Item 2", "Value", "Series 2", "Category", "[Client]"…) | **357** | **0** of 2,246 |

\* Before the measure was made fair: a KPI's label is its measure name, and a category label counts only when all its
words stayed readable (one with a masked name in it should not be shown).

**What changed:**

- **No generic labels (non-negotiable).** The replica engine (`web/replica.js`, also shipped in the React exports)
  never shows a placeholder outside Generic mode. A covered axis or legend label is filled from context: a time
  dimension (or an unnamed line or area axis) becomes months, quarters, years or weeks in order; a named dimension draws
  on a fixed list (regions, segments, channels, sources, departments, statuses, priorities, tiers, age groups, types);
  an unnamed one on the page's industry (departments for healthcare, lines of business for finance…) then general
  product categories; past a list, the dimension's name with a letter ("Store C"). "Value" or "KPI" becomes a measure
  the page names, or one that fits its format ("Revenue", "Rate"); "Series 2" becomes Actual, Target, Prior year…;
  a one-letter or placeholder table header is named for its kind; table cells without realistic names are named from
  their column ("Owner A", "Account B"); "[Client]" in a title becomes "Client A" when realistic names are off.
  Realistic names, when on, still come first. Nothing is taken from masked text. The count is gated in CI with a
  tolerance of 0, and an end-to-end check renders placeholder-filled charts with realistic names off and on.
- **Real labels where they are visible.** A line chart's axis labels are found on the axis row, not just below the
  line's lowest point (which can sit far above the axis); slanted labels still give one group per category; a title
  word whose box the reader drew too tall ("By") stays in the title. Category labels shown: 16.5% to 46.8%.
- **Category counts.** A label printed inside a pie slice no longer splits the slice in two (pies with too many slices:
  40 to 11); a line whose labels cannot be read takes its points from the label groups below it instead of a fixed 12.

**The two paths compared** (the 60 recorded AI answers, scored with `resemble.mjs --ai`: an AI answer has no pixel
boxes, so its visuals are matched to the originals in reading order, each taking the next visual of its type):

| Generated set v5 | On the device (no key) | Claude Sonnet 5.5 (with a key) |
|---|---|---|
| Visuals sharing a row in the original share one in the replica | 91.6% | **100%** |
| Width and position match | 76.5% | **85.2%** |
| Charts with the right number of categories | 72.6% | **99.6%** |
| Bars, lines and slices follow the original, where the count is right | **96.9%** | 94.5% |
| Readable title and label words shown (titles / category labels) | 92.0% (96.9% / 60.1%) | **100%** (100% / 100%) |
| Main colour right | 85% | **98.3%** |
| Generic labels left in the rendered replica | **0** | **0** |

The on-device builder measures shapes a little more exactly; the AI reads labels, counts categories and lays the page
out better. Its category labels are the on-device path's largest remaining gap.

**More real labels on the device.** A line chart's axis row is found across the whole panel (the line's own extent can
be narrower than its axis), grouping labels by their middle; an axis of months in order is completed from its readable
months, so a month the reader misread ("Max" for Mar) or that was masked as unread text becomes the month its
neighbours imply (months are not sensitive, and nothing is taken from a mask); a KPI whose label the reader drew as
tall as a value takes the card's title. Category labels shown: 46.8% to 60.1%; titles and labels overall 89.3% to 92.0%.

**A gallery to judge by eye.** `tools/synth-bench/gallery.mjs` writes one self-contained page with, for generated
dashboards, the masked image a user approves, the on-device replica and the AI replica, drawn live by VaultSnip's engine,
with each path's visuals typed right and totals computed on the page.

Next: category labels masked as unread text (mostly slanted axis labels the second look cannot read), and placeholder
cards (a visual the builder finds but cannot type is drawn as a placeholder card).

## Phase 4(b): close-ups of the visuals the device is unsure of (25 October 2026)

Below the 90% line, the on-device result now offers **Check the uncertain visuals with my AI key**: each visual the build
scored below 60% (at most six) is cut from the masked image the user approved and sent with the app's own instructions,
asking for that one visual; each answer replaces that visual only, and the layout and every other visual stay as built.
Nothing else leaves the device. `tools/ai-bench/run.mjs --closeups` measures it with the app's own code.

| 60 generated dashboards (set v5), 404 visuals | Typed right | End to end | Cost |
|---|---|---|---|
| On the device only | 343 | 81.5% | none |
| On the device + close-ups of the uncertain visuals | **375** | **89.1%** | **$0.79** (74 visuals asked) |
| The whole page with Claude | 404 | 96.4% | $1.44 |

Close-ups cost about half as much as sending whole pages and recover most of the gap; resemblance rises with them
(visuals in the original's row 91.6% to 96.8%, category labels shown 60.1% to 70.5%, no generic labels). A whole page
with a key remains the most faithful; the close-ups are the cheaper step between.

## Finishing Phase 4(d) (25 October 2026)

- **Slanted labels.** A slanted axis label the page reader read as a scrap of low-confidence letters ("Fe", "AY") was
  masked as unknown text, and so never reached the second look. It now gets one: if it reads confidently as safe words,
  the scraps are dropped from the masks; a reading with a digit, or anything the rules flag beyond unknown text, stays
  masked whatever the second look reads. Rotated crops also keep a margin in proportion to the text, on the label's own
  background. Masking on the same 60 images: exposed after the check unchanged at 2.48%, safe words masked 9.34% to 8.71%.
- **Placeholder cards.** A visual the builder finds but cannot type is drawn as a best-guess column chart when it has
  marks, at a low certainty that the confidence score flags for checking (and that never stops a page being read as a
  report); a card with nothing to draw says plainly to choose its type in "Fix it here". Public dashboards: 68 of 76
  visuals typed right (67 before), 85.0% end to end.
- **ECharts advisory GHSA-fgmj-fm8m-jvvx** (Lines series tooltips render data names as HTML, before ECharts 6.1): the
  replica's flow-map lines have their own escaping tooltip and carry no raw names, so it does not apply; an end-to-end
  check keeps it so. Moving to ECharts 6 is a separate, major upgrade.

## Phase 1(b): the real set grown to 39 dashboards (26 October 2026)

27 more public dashboards were labelled with `tools/layout-bench/annotate.html` and checked against their images: 10 Power
BI and 3 Looker pages from Microsoft Learn and Google Cloud documentation (CC BY 4.0), 10 Tableau Public Viz of the Day
dashboards (their authors' content, used for local evaluation only and never sent to any AI), and 4 Apache Superset
dashboards from its documentation (Apache-2.0), plus 4 more Report Builder reports. They bring dark themes, sidebars,
dense control-tower layouts, small multiples, gauges, a funnel, a sunburst and a Gantt chart. Slicers and page headers
are ignore areas, as before. The images are fetched from their sources; none is stored in the repository.

| Real set, on the device | Dashboards | Visuals | Found | Types right (of found) | End to end |
|---|---|---|---|---|---|
| The first 12, tuned against | 12 | 80 | 95.0% | 89.5% | 85.0% |
| The 27 new ones, never tuned against | 27 | 221 | 64.3% | 62.7% | **40.3%** |
| All 39 (the new baseline) | 39 | 301 | 72.4% | 72.0% | **52.2%** |

Paginated reports: 18 of 28 structure checks right on 7 reports (both new matrix reports fully right; a map and a bar
chart report are read as a single KPI).

The first 12 are unchanged; the drop is the honest measure on dashboards the builder has never been tuned on. What the
new ones show, largest first: cards on a tinted or coloured page merged into one panel (a page of ten visuals found as
one or three); rows of KPI cards with an icon or a sparkline missed; types the builder has no reader for (gauge, funnel,
Gantt, dot matrix, decomposition tree, sunburst); and some charts read as maps or treemaps. These are the next targets,
measured on all 39 so that the first 12 cannot regress unseen.

## Phase 5: clustered, stacked and 100% stacked series, and reference lines (26 October 2026)

The on-device builder now tells how a bar, column or combo chart's series sit (one series, clustered side by side,
stacked, or 100% stacked) and reads **reference lines**: a straight target, average or threshold line across a column,
bar, line or area chart, solid or dashed, at its value and named by the words beside it ("Target", "Average"), else
"Target". The replica draws them as dashed lines at the same place; "Fix it here" switches a chart between side by side,
stacked and 100% stacked and adds, moves or removes a reference line; the AI instructions ask for both. Generic exports
keep a reference line without its name or value.

Along the way: bars a line crosses are no longer cut in two; colours that never share a category are one series coloured
by category (or one highlighted bar), not a clustered chart; a 100% stack is no longer read as a treemap; and a panel's
background is a neutral colour that holds a fair share of its border, not vivid bars that run to its edges.

| Measured on | Series layout right | Reference lines found | Added where there is none |
|---|---|---|---|
| 48 generated charts (`tools/synth-bench/chart-variants.mjs`, drawn by Vega-Lite) | 26/27 (96.3%) | 16/19 (84.2%; dashed 9/9, solid 7/10) | 0 of 24 |
| 39 real dashboards (labelled in `truth.json`) | 48/55 (87.3%) | 1/1 | 1 |

Found lines sit where they were drawn (median position error 0 on the 0-100 scale) and take
their label's word in 11/13 labelled cases. On the generated charts, types read right rose from 77%
to 89.6% (horizontal bars against a vivid edge and 100% stacks); on the real set, visuals found and typed
are unchanged. Misses left: a solid line in nearly a series' own colour joins that series' bars, and one real dashboard's
aligned per-bar target ticks read as a line. The real set has only one labelled reference line, so the generated charts
carry most of this measurement; more real examples are welcome.

## Phase 4(a), continued: cards on tinted, framed and shaded pages (27 October 2026)

The largest loss on the 27 new real dashboards was a page of cards found as one panel. Three causes, three fixes in the
panel finder (`src/layout/panels.ts`):

- **Narrow gutters beside a box.** A header box over a sidebar and content, a few pixels apart, left no gutter as wide as
  the page needs, so nothing was cut. A narrower gutter now counts beside a box's edge: a long line across the region
  that turns a corner one way at both ends (a table's row line has column lines both ways, a letter's upright is short,
  and a mask's edge never counts).
- **Cards in the page's frame colour.** White cards on a light blue page inside a white screenshot frame: the card
  colour was taken for the page. The finder now also tries the frame's colour.
- **Shaded cards.** Translucent cards over a gradient page shade from top to bottom, so no single colour is theirs. The
  finder grows each card through gently changing neighbours from a family of close colours.

The last two run only as a rescue, when the page's cuts leave one region over about half the page and its cards hold
words (a single chart's bars never count); pages that worked before are read as before, and a report's table is never
taken for cards.

| 39 real dashboards | Visuals found | Types right (of found) | End to end | Report checks |
|---|---|---|---|---|
| Before | 72.4% | 72% | 52.2% | 18/28 |
| After | **81.1%** | 72.1% | **58.5%** | 18/28 |

Amazon Sales went from 1 of 10 visuals found to 10, Renewals Forecasting from 2 of 11 to 10, Supply Chain from 1 of 9
to 5, Superset's SaaS dashboard from 1 of 4 to 4. Two charts read right before are now typed wrong (a map cut in two,
and a combo read as a KPI), against 26 more visuals found. The generated sets are unchanged or better (60 dashboards:
80.1% end to end against 79.0%).

## Phase 4(a), continued: KPI cards with icons, sparklines and mini charts (27 October 2026)

KPI cards were the commonest visual on the real set (113 of 301) and among the most missed. Three changes:

- **A KPI card with a small chart in it** (a sparkline, mini columns, an icon) or with its delta and comparison masked too
  is read as a KPI, with its sparkline: a really big value (at least 15% of the card's height), few words and little
  ink. Before, the small chart decided the type (Northstar's cards read as pies, Superstore's as columns, Amazon's as lines).
- **KPI cards found as one panel are split** between their values: a panel holding two or more big masked values side
  by side, each with a label and few words, is cut where a line from top to bottom crosses no word and next to no ink.
  Never in a table or on a report.
- **A card that is mostly a picture** (a map card, whose fill runs only round its edge) is still a card; before, its
  map and the KPI tiles beside it were lost.

| 39 real dashboards | Visuals found | Types right (of found) | End to end | KPIs found / read as KPIs (of 113) |
|---|---|---|---|---|
| Before | 81.1% | 72.1% | 58.5% | 77 / 60 |
| After | 83.4% | **76.1%** | **63.5%** | **83 / 75** |

Still missed: a row of small KPI boxes over a chart on a dark page (SaaS), and borderless cards that come apart into an
icon, a value and a label (Supply Chain). The generated dashboards rose slightly (80.4% end to end).

## Phase 5: gauges, funnels, Gantt charts and heatmaps (27 October 2026)

The on-device builder now reads four more types, which the replica already draws:

- **Gauge**: a half ring round a centre at its bottom, running from end to end; the value is how far the coloured arc
  reaches. Read before the KPI rule, since a gauge shows its value big in its middle.
- **Funnel**: three or more bars centred on one line, narrowing; a funnel's bars, each holding only its masked value, are
  kept in one panel.
- **Gantt**: one bar per row, starting at spread-out points (a diverging bar chart's bars all touch its zero line, and are
  not one).
- **Heatmap**: a regular grid of cells in shades of one colour, found from colour changes that fall at evenly spaced
  positions across and down (neighbouring cells of close shades join into one mark, so cell outlines cannot be used).

"Fix it here" offers the four types too. A new generated set (`tools/synth-bench/chart-types.mjs`: Plotly gauges and
funnels, Vega-Lite Gantt charts and heatmaps, with column, pie and line charts as controls) measures them nightly:

| 40 generated charts | Right |
|---|---|
| New types | **89.3%** (gauge 7/8, funnel 6/8, gantt 8/8, heatmap 4/4) |
| Controls | 100% |

On the real set, the Campaign dashboard's gauge is read as one (the real Gantt and calendar heatmap, relabelled from
"other", are not yet); nothing read right before is lost. Still open: dark funnels whose connectors join their bars,
a gauge's value when its progress arc is a darker grey of the same track, and sunbursts (read as donuts; the replica has
none yet).

## Phase 4(d), continued: more category labels read on the device (27 October 2026)

Most category labels a replica missed were a line chart's months, slanted: each slanted label's box starts above the
line's lowest point, so it was not counted as "below the line", and words at slightly different heights fell apart into
phrases of one or two. The builder now takes a word as below the line by its middle, and groups an axis row's words by
the labels' even spacing (word centres much closer than the usual step are one label: "Fe" + "b", "North America").
The existing months-in-order rule then fills the months between.

| 60 generated dashboards (set v5), on the device | Before | After |
|---|---|---|
| Category labels shown (of those left readable) | 59.4% | **63.5%** |
| Charts with the right number of categories | 72.2% | **74.4%** |
| Visuals sharing a row as in the original | 91.6% | 95.3% |

Real dashboards unchanged. Category labels shown now has its own gate in CI.

## Phase 4(a), continued: bars of equal length, and KPIs with round icons (27 October 2026)

- **Equal bars are not table stripes.** A bar chart whose bars are nearly one length, each with its category and value
  beside it, was read as a table's zebra stripes. Stripes run across most of their table; these bars cover a small part
  of their panel (Amazon's three category charts).
- **A KPI with a round icon is a KPI.** The KPI-with-a-small-chart rule now takes a value at least 12% of the card's
  height (it was 15%), as the plain KPI rule does, but never on a line chart or where bars cover much of the panel.
  Northstar's cards, read as pies from their round icons, are KPIs again.

| 39 real dashboards | Visuals found | Types right (of found) | End to end |
|---|---|---|---|
| Before | 83.4% | 76.5% | 63.8% |
| After | **85%** | 77.3% | **65.8%** |

Tableau now reads 83.2% of its visuals and types 80.6% of them
right, ahead of Power BI. Two misses traded away earlier remain: a Power BI map whose pale land areas pass for two
cards (each half then read on its own), and SaaS's row of small KPI boxes over a chart.

## Phase 4(c): the on-device self-check (27 October 2026)

After a replica is built on the device, each charted visual is compared with its panel in the masked image, on the
device (`web/selfcheck.js`; nothing leaves the page). Each side is reduced to the kind of marks it holds (how long ink
runs across and down, how much of its area is filled), a coarse grid of where they lie, and its main colour; text is
left out on both sides, and faint greys count as background.

Measured on the 60 generated dashboards (`tools/synth-bench/self-check.mjs`, 258 charted visuals, 24 of them built
wrong), by how well a score ranks the visuals built wrong below those built right (AUC, 0.5 is chance):

| Score | AUC | "Check" marks (below 0.5) |
|---|---|---|
| The builder's own confidence | 0.862 | 13: 13 of 24 wrong, 0 right ones marked |
| The self-check alone | 0.736 | |
| The two averaged | **0.88** | 45: 18 of 24 wrong, 27 right ones marked |

The average ranks better, but as a "Check" mark it would mark 27 visuals built right to catch 5 more built wrong,
noise a user would learn to ignore. So it is used where ranking is what counts: choosing which uncertain visuals to send
as close-ups to the user's own AI. The "Check" marks stay on the confidence alone, which marks none built right. A first
version comparing only where ink lay (AUC 0.65) was not good enough to use; the replica draws its axes and legends its
own way, so the kind of marks carries the signal.

## Phase 3: the chart catalogue (27 October 2026)

`web/catalog.js` declares every visual type the replica draws (24), with the data each needs and an invented example.
Everything that used to list types reads it: the AI instructions' list of types, the answer checker
(`tools/ai-bench/validate.mjs`), the types offered in "Fix it here", and a new public page, **Supported charts**
(`web/charts.html`, linked from the app), which draws every example live with the replica engine. An end-to-end check
draws every type in the catalogue and fails if one falls back to a placeholder, and checks that the AI instructions list
exactly the catalogue's types. Adding a type now means one entry in one file.

**The strict answer format is not used, by measurement and by limit.** The recorded Claude answers had no malformed
structure beyond row widths (which the app fits), so it was never needed for correctness. And it cannot express the
spec faithfully: Claude's structured outputs require every object closed (`additionalProperties: false`) and allow at
most 24 optional fields in a request, while a visual has well over 24 optional, type-specific fields across the 24
types. Squeezing them in (a type's data as a JSON string inside a strict outer shape) would trade measured-good answers
for a weaker format. OpenAI keeps its JSON mode; its strict mode requires every field present, which fits this optional-
heavy shape no better. The answer checker runs on every recorded answer instead, and stays the guard.

## The plan

Each phase ships on its own branch, must not lower any figure it does not target, and records its before-and-after
figures here. Every phase is checked first against the [ground rules](CLAUDE.md): privacy, law, licences and no hidden
data flow.

| Phase | What | Why it matters to someone sharing a dashboard | Done when |
|---|---|---|---|
| **0. Baseline** | A reproducible benchmark (fetch, read with the app's own review step, score), these definitions and the first figures | Every later change can prove what it does | This page and `baseline.json` exist and anyone can rerun them |
| **1. Measure leaks** | (a) A generated test set: fictional dashboards drawn with other charting tools than VaultSnip's (so we are not grading our own drawing), in many fonts, themes, sizes and compression levels, with every word's position known. (b) The real set grown to about 40 (done: 39 dashboards and 7 reports). (c) Each pre-flight finding labelled as a real miss or a false alarm. (d) Recorded AI answers, so the AI-key path is scored too. (e) CI: a quick on-device run on each pull request and the full set nightly, failing if a figure drops | "Never leaks" becomes a measured number per kind of data (emails, names, numbers, IDs) instead of a promise, and we learn why users have something to resolve on almost every screenshot | Leaked area, over-masking and false alarms are reported with confidence intervals; both build paths are scored; CI guards every figure |
| **2. Nothing unread stays visible** | A small on-device text-region detector (an Apache-2.0 model, run in the browser) finds every patch of text, whether or not the reader could read it. Any region not covered by a confidently read, allowlisted word is masked. Applies to the app and to the extension's chart blur. Numbers the first pass misses are then masked before the check runs, instead of being left for the user | Text the reader misses (tiny, rotated, coloured) is masked instead of leaking, and the check stops asking the user to fix the first pass's misses | Leaked area falls; items to resolve per image fall from about 7 towards 1; over-masking rises no more than an agreed margin; reading time no slower than 18 s median |
| **2b. Better reader, if it wins** | Compare a stronger on-device reader with Tesseract on the Phase 1 set; switch only if it wins | More words kept readable, so better titles and labels | Data-backed decision either way |
| **3. A catalogue of chart types** | One schema of every chart type VaultSnip draws, with the data shape each needs. The AI prompt, a strict answer format for each provider, a check that each type is drawn, and a public gallery are all generated from it | Fewer malformed or invented answers from the AI; users can see what is supported | No malformed answers across recorded runs; adding a type means changing one file |
| **4. Spend effort where it is unsure** | (a) Fix the on-device build's largest misses: stacks of masked axis labels read as KPI cards (since Phase 2), KPI cards, pages split into too many panels, and maps. (b) The on-device build places the panels; only the panels it is unsure of are sent, as close-ups, to the user's AI. (c) The replica is compared with the masked image on the device and the panels that differ are flagged | Hard dashboards get more attention, easy ones stay fast and cheap; the key-free draft becomes good enough to share more often | Visuals found back above 80%; key-free end to end from 50% towards 70%; AI-key end to end rises while AI calls per screenshot stay about the same; confidence estimates within 10 points |
| **4(d). Resembles the original** | (a) Measure resemblance on the generated dashboards, whose truth records each visual's box, title, categories, values and colour (`tools/synth-bench/resemble.mjs`): layout, shape, text and colour match, for the on-device build and the recorded AI answers. (b) A side-by-side gallery of originals (masked) and replicas, to judge by eye. (c) **No generic labels, non-negotiable:** read the real labels wherever they are visible (axis labels found from the axis, not from the line's lowest point; slanted labels grouped per category); fill every other label from context, never with "Item N", "Value" or "Series 2" (a time dimension becomes months or quarters in order, geography real places for the page's country, a business dimension realistic values for the page's industry, else a label built from the dimension's name), in the builder's output, in AI answers and in the rendered replica; never copy masked text. (d) Measure it: generic labels left in the rendered replica, target 0 outside Generic mode | A replica that is recognisably the user's dashboard: "the same visuals in the same places, of the right kind", with real words where the original shows them and believable ones where it hides them | Generic labels left 0; text match and categories right rising; layout and shape match reported for both paths |
| **5. More chart types** | The types the benchmark shows we miss most, in that order (candidates: radar, sunburst, bullet, small multiples, slicers) | Fewer placeholders in replicas | "Chart types we cannot draw" falls |

**Priority (24 October 2026).** VaultSnip's goal is to find the visuals, charts and KPIs, mask the data and build an
interactive replica without any AI key. Work that improves the key-free path comes first: the rest of Phase 4(a), an
on-device self-check (4c), more chart types the builder reads (5), the detector in the extension's chart blur, and a
better reader (2b). Work that only improves the AI-key path (scoring it, the strict answer formats of Phase 3 and the
close-ups of 4b) comes after.

**Status (27 October 2026).** All phases are done: 0, 1 (a)-(e), 2, 2b, 3 (the catalogue; the strict format measured
unnecessary and inexpressible, above), 4 (a)-(d) and 5 (combo, waterfall, series layouts, reference lines, gauges,
funnels, Gantt charts and heatmaps). The extension's chart blur has used the detector since Phase 2. Open items are
named under each phase (dark funnels, sunbursts, a gauge's value on a grey track, SaaS-style KPI rows, the real set's
Gantt and calendar heatmap).

What is deliberately not in the plan:

- **Cloud text reading.** It would be more accurate, but the screenshot would leave the device.
- **Telemetry about accuracy in real use.** VaultSnip collects none. The only real-world signal is what people choose
  to report through *Report a problem*.
- **A headline accuracy claim before it is measured.** Published figures always name the set they come from, the
  version and the date, with real and generated results kept apart.
