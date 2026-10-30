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
masking worked. The replica **is** the original screenshot, changed in place (`web/inpaint.js`):

> **Every pixel of the original, except the text that was hidden, which is replaced in its place by synthetic text,
> and any area the user chose to blur.**

- Nothing is redrawn. No chart library, grid or generated layout recreates the dashboard body; charts, maps, gridlines,
  legends and proprietary visuals keep their original pixels.
- Only the text's own pixels inside a hidden box change; a bar edge or border running through the box survives.
- Synthetic text matches the original's place, size, colour, weight and alignment, and keeps the dashboard's numbers
  coherent (`web/synth.js`), all made on the device: nothing is sent anywhere.
- An area the user blurs ("Blur a chart") is the only other change: it is blurred over everything in it, and no synthetic
  text is drawn there.
- Measured by `node tests/e2e/inplace.e2e.mjs`: zero changed pixels outside the replaced boxes and blurred areas, no grey redaction blocks,
  hotspots aligned with their pixels. No change ships that breaks it.

## 4. Free and open, for good

Never add paywalls, licence keys, ads or selling of data. The app is and will stay free and open source.

See also the ground rules in `CONTRIBUTING.md`.
