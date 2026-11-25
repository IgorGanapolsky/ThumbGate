---
"thumbgate": minor
---

The MCP server now updates old hook runtimes in the background. When it sees the hooks on a machine running an older ThumbGate (including installs pinned to their first version), it installs its own version into a staging folder next to `~/.thumbgate/runtime`, checks it, and swaps it in, at most once a day. It never blocks the MCP server. Set `THUMBGATE_NO_AUTO_UPDATE=1` to turn it off.
