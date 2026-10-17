# Masked session replay (Feature 4)

"Record this tab (text masked)" (right-click menu or Alt+Shift+R) records the tab with
[rrweb](https://github.com/rrweb-io/rrweb) and opens a replay in `web/replay.html`. The output is PII-free JSON
(or a self-contained HTML player) that replays clicks, hovers, scrolling, typing and page changes.

```
recorder.js (content script, isolated world)          service worker               app/replay.html
  rrweb record: all text + inputs masked,       ──►    holds it in memory     ──►   sanitize + audit again,
  media/canvas/iframes blocked; red badge               until asked once             play, download JSON/HTML
  stop → sanitize → audit (fail closed)
```

## Why rrweb's own masking is not enough

rrweb masks text nodes and inputs, but records attributes (`href="mailto:…"`, `alt`, `title`, `aria-label`,
`data-*`), CSS (`url(…)`, `content: "…"`) and the page URL as they are. `src/shared/replay-sanitize.ts` cleans every
event, deny by default:

| Channel | What happens |
| --- | --- |
| Text nodes, text changes | `maskText()`: words masked unless allowlisted (same rules as `web/app.js`, `src/shared/classify.ts`); shape kept ("Xxxxx 0,000"); emails become "xxxxxxxx" |
| Attributes | only layout/SVG geometry names kept; links become `#`; `value` becomes `*`; everything else dropped |
| CSS (style tags, inline, CSSOM rules) | `url()` and `@import` removed; `content`/`quotes` strings and attribute selectors masked |
| Inputs | `*` |
| Page URL | `about:blank` |
| Canvas, fonts, console logs, custom/plugin events | dropped |

`auditEvents()` is written separately and checks the result: visible text may only hold allowlisted or masked words;
no string may hold an email, a link or a URL. The recorder discards a recording that fails, and the replay page
refuses to play or download one, including files the user opens.

## Limits

- The recorder runs in the extension's isolated world, so the page cannot read or change it, but styles the page adds
  through CSSOM after recording starts are only picked up by the full snapshot taken every 15 s.
- Images, video, canvas (charts) and iframes replay as empty boxes of the same size.
- Allowlisted words (common report labels, countries and regions) stay readable, as in the app.

## Build and test

```sh
npm run build:replay      # web/lib/vs-replay.js (committed)
npm run build:ext         # extension/recorder.js and the service worker (committed)
npm run test:unit         # sanitizer + audit on a recording with PII in every channel; classify() vs the Rust scanner
npm run test:replay-e2e   # packaged extension in Chromium: record, replay, OCR the replay, offline HTML, zero network
```
