---
"thumbgate": patch
---

The Cursor shell hook now fails closed: if ThumbGate cannot check a command (bad input, engine error, no answer from the plugin script), the command is denied instead of allowed, and every Cursor hook entry ThumbGate ships or writes sets failClosed so Cursor also blocks when the hook crashes or times out.
