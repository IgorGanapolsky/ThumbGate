---
"thumbgate": minor
---

`thumbgate serve` now starts a thin stdio shim that forwards to one shared ThumbGate daemon per machine, instead of loading the whole MCP server in every agent session. Each session keeps its own project, feedback directory, MCP profile and agent identity, and every tool name and schema is unchanged. The daemon starts on first use, exits five minutes after its last client leaves, and the shim falls back to the old per-session server if the daemon cannot start. A call that outlives `THUMBGATE_SERVE_REQUEST_TIMEOUT_MS` (default 120000) returns an MCP error instead of hanging. Set `THUMBGATE_SERVE_MODE=standalone` to keep one server per session.
