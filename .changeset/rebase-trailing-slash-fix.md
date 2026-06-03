---
"thumbgate": patch
---

fix(gates): rebaseGlobsToRepoRoot handles repoPath with a trailing slash

`rebaseGlobsToRepoRoot` used `normalizePosix(repoPath)`, which preserved a
trailing slash and produced malformed rebased globs (e.g. `repo//**`) when a
task scope was set with a `repoPath` ending in `/`. Switched to
`normalizeGlob(repoPath)` so task-scope edit-boundary globs resolve correctly
regardless of trailing slash. (Addresses the edge case flagged on #2454.)
