---
"thumbgate": patch
---

Codex MCP installs now resolve `thumbgate@latest` when Codex starts the MCP server or hook bundle, instead of preferring a stale already-installed runtime binary. The repo-local Codex plugin, standalone bundle config, README, landing page, and distribution docs now advertise the auto-updating Codex plugin path truthfully while preserving local source fallback for unpublished development builds.
