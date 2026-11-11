---
'thumbgate': patch
---

Scope PreToolUse lesson retrieval to current repository and drop transport transcripts

- Enforce fixed-schema scope at capture time with repo/project resolution from `cwd` and git remote
- Add repo-aware project filtering in PreToolUse hook and lesson retrieval, preventing cross-project context pollution (StockService/Dayglass/etc.)
- Reject and demote transport transcript blobs carrying XML task runner tokens (`<task-notification>`, `<tool-use-id>`, etc.)
- Add `scripts/project-scope.js` and `scripts/backfill-lesson-scopes.js` to backfill project scopes on existing memory logs
