# Rules for AI assistants working on VaultSnip

VaultSnip is free, open-source (Apache-2.0) software that protects people's data. These rules come before any task.

## 1. Ethics and the law first

Before making any change, check that it:

- respects the privacy of the people whose data appears in screenshots, and of the user;
- follows applicable law: privacy and data-protection law (GDPR, CCPA and similar), copyright and licences, and the terms
  of any service involved;
- adds no hidden data flow: no analytics, telemetry, tracking or calls to servers the user did not choose;
- uses only code, models and datasets whose declared licence allows redistribution under Apache-2.0. Nothing GPL copied in,
  nothing with no licence or a non-commercial licence. Studying such a project for ideas is fine; copying it is not.

If a change fails any of these, do not make it. Say why and propose an alternative that passes.

## 2. Then ship it properly

Only after that check passes:

- make the change, test it, and push it to GitHub on its own feature branch;
- make sure the app actually uses it. Unused code is not finished work;
- describe any new download, stored file or extension permission in `PRIVACY.md`, and credit any third-party asset in
  `THIRD_PARTY_NOTICES.md`, in the same change.

## 3. The replica must match the original

This is the product. A replica that does not look like the screenshot it came from is a failure, however well the
masking worked. The rule:

> **Every visual of the original, in its place, of its kind, with its title, and nothing else.**

- Nothing invented. A panel VaultSnip draws that is not a visual in the original (a toolbar, a filter bar, a page
  header read as a card) is the worst kind of error: the user sees it immediately.
- Nothing dropped. A KPI row of six tiles is six visuals, not one.
- The right kind. A map is not a treemap; an area chart is not a map.
- Measured by `node tools/layout-bench/fidelity.mjs`, which scores
  `right / max(visuals in the original, panels produced)` on the real dashboards, counting **every** panel the builder
  produces. The target is 100%.
- No change ships that lowers fidelity. `tools/bench-gate.mjs` enforces it; run it before opening a PR.
- `ignore` regions in `truth.json` are for scoring *found visuals* only. Fidelity never uses them: a panel over
  application chrome is an invention and is counted as one.

## 4. Free and open, for good

Never add paywalls, licence keys, ads or selling of data. The app is and will stay free and open source.

See also the ground rules in `CONTRIBUTING.md`.
