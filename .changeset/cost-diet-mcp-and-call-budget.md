---
"thumbgate": patch
---

Compact default MCP replies (<600 bytes) for `capture_feedback`, `retrieve_lessons`, `recall`, and `search_lessons` (full JSON via `verbose: true`), enforce tag-overlap and lexical similarity floor on `inferCorrectiveActions`, and add an opt-in Claude Code session call-budget hook (`scripts/hook-call-budget.js`).
