---
"thumbgate": minor
---

New opt-in shared-tree gate for checkouts that several agents use. Set `THUMBGATE_SHARED_TREE=1` and ThumbGate denies `git stash`, any `git reset`, `git checkout` and `git switch`, plain force pushes, and any force push (even with a lease) to `main`, `master` or `trunk`, with a one-line pointer to a linked worktree. `git status`, `git diff`, `git log`, `git worktree add`, `git commit` and `git push --force-with-lease` to your own branch stay allowed. It is off by default and not part of the default config.
