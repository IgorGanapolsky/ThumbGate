---
"thumbgate": patch
---

The npm package now ships `scripts/hook-pre-tool-use.js` and the four modules it loads, so the Claude plugin hooks file no longer points at a script that is missing from the package. A new test fails when any path named in the plugin files, or any local module those scripts load, is absent from `npm pack`.
