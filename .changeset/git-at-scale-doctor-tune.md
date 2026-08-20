---
"thumbgate": patch
---

chore(hygiene): doctor and self-heal Cursor client Git scale tunables

Wire the existing scorecard into agent-readiness and self-heal. Add
fetch.writeCommitGraph / gc.writeCommitGraph / pack.writeReverseIndex
tune, pack bitmaps on multi-pack-index write, and a check that only
fails closed on pack/loose sprawl — not on a fresh CI clone missing
indexes.
