# src/exporters

Exporters that turn a rendered replica into code a developer can own. Everything runs in the browser, with no AI and no
network.

| File | Feature | Built as | What it does |
|---|---|---|---|
| `dom-to-react.ts` | 8 | `web/lib/vs-react.js` (`window.VSReact`, `npm run build:react`) | Reads the replica DOM (each card's `data-component`, `data-vid`, span and chart height, in page order) and writes an editable TypeScript React project: one typed component per card, a `useReplica` hook and types. |

The generated project draws its values from the VaultSnip engine at runtime (`DSCReplica.model` in `web/replica.js`), so
nothing is frozen into the code: values, labels, table rows and chart options follow the spec, the seed, the privacy level
and the filters the user clicks.

Related exporters outside this folder: `src/export/design-export.ts` (Feature 5: Figma SVG and the one-file JSX
component).

Studied for ideas only, no code taken: [Mitosis](https://github.com/BuilderIO/mitosis) (a JSON component tree) and
[html-to-react-components](https://github.com/roman01la/html-to-react-components) (HTML to React components).
