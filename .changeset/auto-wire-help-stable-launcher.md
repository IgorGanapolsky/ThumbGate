---
"thumbgate": patch
---

auto-wire-hooks: --help, -h and --dry-run write nothing; hooks wired from a git worktree call the stable ~/.thumbgate/bin/thumbgate-hook launcher instead of a path inside the worktree.
