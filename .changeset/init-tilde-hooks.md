---
"thumbgate": patch
---

`thumbgate init` no longer deletes a working hook whose path starts with `~/` (for example `python3 ~/.claude/hooks/standing-orders.py`): it expands `~` like the shell before deciding a file is missing, and never judges `~otheruser/` paths. The status line's "Latest mistake" / "Latest lesson" stamp now uses your local 12-hour time ("Nov 27, 2:47 PM") instead of UTC 24-hour.
