---
"thumbgate": patch
---

Fix wire-hooks to clean stale project-level Claude Code hooks referencing missing files. Previously only cleaned user-level settings, leaving broken hooks in .claude/settings.json that caused "UserPromptSubmit hook error".
