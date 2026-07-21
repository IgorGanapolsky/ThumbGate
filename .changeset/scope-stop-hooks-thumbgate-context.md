---
"thumbgate": patch
---

Scope the deploy-claim and PR-thread Stop hooks to actual ThumbGate context instead of bare keyword matches, so unrelated claims (a local model's deploy state, a sibling repo's merged PR) no longer false-positive block the turn while genuine ThumbGate production/PR claims without evidence still hard-block as before.
