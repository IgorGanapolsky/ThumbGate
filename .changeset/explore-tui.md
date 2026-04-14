---
"thumbgate": minor
---

Add `thumbgate explore` — interactive TUI explorer for lessons, gates, stats, and rules

Inspired by Cloudflare's Local Explorer pattern: a zero-dependency, keyboard-driven
terminal interface that lets developers and AI agents discover what ThumbGate has
learned and what gates are active.

Features:
- 4 tabs (1-4 or Tab key): Lessons · Gates · Stats · Rules
- ↑/↓ or j/k to navigate, `/` to search/filter, Enter for detail view
- Color-coded signal indicators (● negative = red, ● positive = green)
- Relative timestamps, truncation, terminal-resize awareness
- Works entirely from local JSONL/SQLite — no network required
