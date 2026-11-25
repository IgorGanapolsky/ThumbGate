---
"thumbgate": patch
---

`thumbgate self-update` now also updates the cached hook runtime in `~/.thumbgate/runtime`, which is what hooks actually run; before, hooks stayed on the first version ever installed. The MCP server notices an older hook runtime, mentions the update command once in its instructions, and sends one `runtime_version_skew` ping a day. Nothing is installed automatically.
