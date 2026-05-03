---
'thumbgate': patch
---

Keep `npm run pr:manage` usable from detached verification worktrees by falling back to repository-wide PR discovery when GitHub CLI cannot resolve the current branch.
