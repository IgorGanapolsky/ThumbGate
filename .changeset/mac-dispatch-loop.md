---
"thumbgate": patch
---

Add a cloud-to-Mac dispatch loop (`scripts/mac-dispatch-loop.js`) that runs open `ready-for-agent` GitHub issues through `claude -p` on a Mac under the owner's own permission settings, with cross-machine claim locking, allow-listed authors and folders, redacted evidence comments, and `agent-done`/`agent-blocked` labels. Adds a launchd installer, an optional Working directory field on the Ready for Agent issue template, and docs/guides/mac-dispatch-loop.md.
