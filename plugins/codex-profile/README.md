# ThumbGate for Codex

This directory is the repo-local Codex app plugin surface for ThumbGate.

It packages the same ThumbGate runtime you already use elsewhere:

- `plugins/codex-profile/.codex-plugin/plugin.json` for Codex plugin metadata
- `plugins/codex-profile/.mcp.json` for the MCP server launcher
- `adapters/codex/config.toml` for the version-pinned manual install path

## What it does

- adds ThumbGate's Pre-Action Gates to Codex workflows
- captures thumbs-up/down feedback that survives session boundaries
- reuses the same local-first MCP runtime as Claude, Cursor, Gemini, Amp, and OpenCode

## Install paths

### Codex app plugin

Use the repo-local Codex plugin metadata and MCP config in this folder when Codex is loading plugin surfaces from the repository.

### Manual install

Copy the MCP profile from `adapters/codex/config.toml` into `~/.codex/config.toml`.

That profile launches:

```toml
[mcp_servers.thumbgate]
command = "npx"
args = ["-y", "thumbgate@0.9.9", "serve"]
```

## Why this exists

The Codex support story is no longer just "copy this config block." This folder is the shipped Codex plugin artifact for ThumbGate, so the repo can truthfully claim a Codex app plugin surface alongside the Claude Desktop bundle and Cursor plugin.
