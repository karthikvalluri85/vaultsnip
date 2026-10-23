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

What is deliberately not in the plan:

- **Cloud text reading.** It would be more accurate, but the screenshot would leave the device.
- **Telemetry about accuracy in real use.** VaultSnip collects none. The only real-world signal is what people choose
  to report through *Report a problem*.
- **A headline accuracy claim before it is measured.** Published figures always name the set they come from, the
  version and the date, with real and generated results kept apart.
