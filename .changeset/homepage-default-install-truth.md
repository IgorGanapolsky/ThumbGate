---
"thumbgate": patch
---

The homepage and `/pricing` now say what a default install does: a thumbs-down adds a warning gate, a repeat is warned about and allowed to run, and only secret leaks are denied. Strict mode (`THUMBGATE_STRICT_ENFORCEMENT=1`) blocks a learned rule after three thumbs-downs on the same command and blocks the built-in destructive gates at once. Codex and Gemini CLI enforcement claims are removed until a gated session has been run. Enforcement defaults are unchanged.
