---
"thumbgate": patch
---

Make auto-promoted gates actually enforce: group and match only by executable actions (not tag co-counts), derive command patterns, skip unmatchable/prose-only feedback, exclude originating incidents from regression quarantine, and prove capture→promote→deny end-to-end including the entity-tag failure class. Demo proves ALLOW → 3× 👎 → auto-promote → DENY.
