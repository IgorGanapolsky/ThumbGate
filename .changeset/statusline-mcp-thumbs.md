---
"thumbgate": patch
---

The status line now counts thumbs an agent recorded for the person through MCP `capture_feedback` even when an older server saved them as `automated`: such a row counts when the history sync captured the person's own thumb within 90 seconds of it. "Latest mistake" now shows the newest counted thumbs-down for the project instead of the last lesson the inference step happened to write, which could be days old.
