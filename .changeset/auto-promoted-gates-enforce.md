---
"thumbgate": patch
---

Make auto-promoted gates actually enforce: match patterns derive from the captured command (not tag group keys), skip unmatchable gates, exclude originating incidents from regression quarantine, and prove capture→promote→deny end-to-end including the entity-tag failure class.
