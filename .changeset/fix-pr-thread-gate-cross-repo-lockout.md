---
thumbgate: patch
---

Fix pr-thread-resolution-verified-required gate leaking across repos/worktrees and never clearing once an evidence command ran, which could permanently lock out an unrelated session's PreToolUse hook.
