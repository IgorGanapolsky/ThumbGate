---
'thumbgate': patch
---

Isolate issue-3702 PR-create gate tests from live task-scope and branch diffs of AGENTS.md so `gh api POST /pulls` is classified as `gh-api-pr-create-restricted`, not a catch-all protected-file deny.
