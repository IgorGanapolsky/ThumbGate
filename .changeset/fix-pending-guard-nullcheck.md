---
"thumbgate": patch
---

fix(governance): commit guard null-check for compiled guards and graphrag frontier deduplication

- Guard against null/non-object entries in the compiled guards array before
  normalization, preventing a crash that would hard-block all agent actions.
- Replace naive BFS frontier push with a queuedInFrontier map that keeps only
  the strongest pending entry per node, preserving visited tracking and
  propagating improved state in place.
- Preserve baseline single-hop top-K seed results before appending graph-only
  candidates, upholding the "never worse than single-hop" contract.
