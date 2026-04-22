---
"thumbgate": patch
---

fix(api): lazy-load lesson search and semantic private boundaries

Move the remaining lesson-search and semantic-schema routes in the HTTP
API server behind the private API module loader. The hosted runtime keeps
the current behavior when those modules are present, while public-shell
or partially extracted runtimes now fail with the standard
`PRIVATE_CORE_REQUIRED` 503 instead of assuming the modules are always
bundled.

This pins two more hosted-only edges:

1. `/v1/lessons/search` now resolves through the lesson-search private
   boundary.
2. `/v1/semantic/describe` now resolves through the semantic-layer
   private boundary.
3. API regression tests cover both the normal route behavior and the
   unavailable-module fallback contract.
