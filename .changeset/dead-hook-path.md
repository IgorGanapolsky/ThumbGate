---
"thumbgate": patch
---

auto-wire-hooks now prunes hook commands that run a missing script behind node, sh or bash (a deleted worktree path used to survive every cleanup). Adds a test that fails when a tracked .claude/settings.json hook points at a path that does not exist.
