---
"thumbgate": patch
---

The hook's "Stats:" line now uses the same thumb counter as the status line and the dashboard headline, so the three show one number. A thumb counts only when a person gave it: text such as "Explicit user thumbs-up" in a row no longer counts by itself, and the MCP `capture_feedback` tool marks a thumb as human only when it carries the user-prompt hook tag. An end-to-end test now runs the real status line command, the dashboard server, the hook and a headless browser against one fixture log and checks that all four print the same counts.
