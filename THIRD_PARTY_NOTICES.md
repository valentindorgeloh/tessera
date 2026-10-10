# Third-party notices

Tessera is written from scratch. The Plane work tracker (makeplane/plane, AGPL-3.0) served as a behavioural reference only: no Plane source, assets or strings are included, and `scripts/check-conventions.ts` rejects Plane identifiers in this code base.

Runtime and development dependencies are listed in `package.json`; every one of them is under MIT, ISC, Apache-2.0, BSD or an equally permissive licence, enforced by `scripts/check-licenses.ts`. The reviewed exceptions below are transitive packages that are never shipped in the product or are unused optional binaries.

## Code adapted into this repository

| What | Where | Licence | Notes |
|---|---|---|---|
| Pointer drag-and-drop from the Astryx `kanban-board` page template (`@astryxdesign/cli` 0.6.0, assets/templates/pages/kanban-board) | `src/components/dnd/use-pointer-drag.ts` (added in P2a) | MIT, Copyright (c) Meta Platforms, Inc. and affiliates | Ported by hand: className + design tokens instead of `xstyle`, Phosphor icons instead of heroicons. |

MIT licence text for the Astryx template:

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Reviewed licence exceptions (transitive, not shipped)

| Package | Licence | Why it is acceptable |
|---|---|---|
| `@img/sharp-libvips-darwin-arm64`, `@img/sharp-wasm32` | LGPL-3.0-or-later (libvips) | Optional binaries of `sharp`, pulled by `next` for image optimisation, which Tessera does not use. Dynamically linked and unmodified. |
| `axe-core` | MPL-2.0 | Used by `eslint-plugin-jsx-a11y` during lint only. |
| `lightningcss`, `lightningcss-darwin-arm64` | MPL-2.0 | Used by `vite` inside `vitest` during tests only. |
| `caniuse-lite` | CC-BY-4.0 | Browser-support data read by `browserslist` while building. Attribution: "caniuse-lite" data by Alexis Deveria and contributors, https://caniuse.com, licensed under CC-BY-4.0. The data never appears in the product. |
| `css-mediaquery` | BSD-3-Clause (package.json says "BSD") | Transitive via `@astryxdesign/core` → `@stylexjs/stylex`. |

Full details and the review date are in `licenses.exceptions.json`.
