---
"thumbgate": patch
---

The hook runtime now keeps itself on npm `latest`: `gate-check` and `session-start` check once a day in a detached child and refresh `~/.thumbgate/runtime` when a newer release exists (opt out with `THUMBGATE_NO_AUTO_UPDATE=1`). This covers Codex, plugin and hooks-only installs, which have no MCP server started from `@latest` to notice. The Claude plugin and the Claude Codex bridge now start the MCP server from `thumbgate@latest` instead of a cached or pinned version. `/v1/metrics/real` reports `installVersions`: the share of CLI installs on the current release.
