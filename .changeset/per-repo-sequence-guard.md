---
"thumbgate": patch
---

Fix: workflow-sequence "source edited but not verified" guardrail now tracks the dirty flag per repo instead of via a single global `~/.thumbgate/sequence-state.json`. Previously an edit in any repo hard-denied the next commit/publish in every other repo (cross-repo contamination). The dirty state is keyed by the nearest `.git` root resolved from the action's path / `cd` target / `repoPath`; the guardrail still blocks an unverified commit within the same repo that was edited. Legacy flat-format state is dropped on load (worst case: one extra allowed commit, never a wrong block).
