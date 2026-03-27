# Codex: RLHF MCP Plugin Install

Install the MCP plugin in under 60 seconds. Copy-paste the config block — no manual editing required.

## One-Command Install

Add the MCP server block to your Codex config:

```bash
cat adapters/codex/config.toml >> ~/.codex/config.toml
```

Or create the config file if it does not exist:

```bash
mkdir -p ~/.codex
cat adapters/codex/config.toml >> ~/.codex/config.toml
```

## What Gets Added

The following block is appended to `~/.codex/config.toml`:

```toml
[mcp_servers.rlhf]
command = "npx"
args = ["-y", "mcp-memory-gateway@0.8.3", "serve"]
```

## Verify

Start the MCP server manually to confirm it runs:

```bash
node adapters/mcp/server-stdio.js
# Expected: MCP server listening on stdio
# Press Ctrl+C to stop
```

Then restart Codex. The `rlhf` MCP server will appear in the tool list.

## Available Tools (via MCP)

- `capture_feedback` — POST `/v1/feedback/capture`
- `feedback_summary` — GET `/v1/feedback/summary`
- `prevention_rules` — POST `/v1/feedback/rules`
- `plan_intent` — POST `/v1/intents/plan`

## Requirements

- Codex with MCP support
- Node.js 18+ in PATH
- Config file at `~/.codex/config.toml`

## Uninstall

Remove the `[mcp_servers.rlhf]` section from `~/.codex/config.toml`.
