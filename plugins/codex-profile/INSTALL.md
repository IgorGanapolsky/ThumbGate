# ThumbGate for Codex

ThumbGate now ships a standalone Codex plugin bundle, a repo-local Codex app plugin surface, and an auto-updating Codex MCP profile.

## Option 1: Use the standalone release bundle

Download the latest bundle:

- `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`

Or build it from source:

```bash
npm run build:codex-plugin
```

After extracting `thumbgate-codex-plugin.zip`, the folder already contains:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `.agents/plugins/marketplace.json`
- `config.toml`

The bundled marketplace catalog points at `./`, so the extracted directory is a self-contained plugin root instead of a repo-relative stub.

## Option 2: Use the repo-local plugin files

## Shipped plugin files

- Codex plugin manifest: `plugins/codex-profile/.codex-plugin/plugin.json`
- Codex MCP config: `plugins/codex-profile/.mcp.json`
- Codex marketplace entry: `.agents/plugins/marketplace.json`
- Manual install profile: `adapters/codex/config.toml`

## Option 3: Manual Codex install

Preferred path:

```bash
npx thumbgate init --agent codex
```

That now installs:

- the ThumbGate MCP server in `~/.codex/config.toml`
- Codex hooks plus the ThumbGate status line target in `~/.codex/config.json`

If you only want the MCP server block manually, add it to your Codex config:

```bash
cat adapters/codex/config.toml >> ~/.codex/config.toml
```

Or create the config file if it does not exist:

```bash
mkdir -p ~/.codex
cat adapters/codex/config.toml >> ~/.codex/config.toml
```

## What Gets Added

The following block is appended to `~/.codex/config.toml` when the published package is available:

```toml
[mcp_servers.thumbgate]
command = "sh"
args = ["-lc", "mkdir -p \"$HOME/.thumbgate/runtime\" && npm \"install\" \"--prefix\" \"$HOME/.thumbgate/runtime\" \"--no-save\" \"--omit=dev\" \"thumbgate@latest\" >/dev/null 2>&1 && exec \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" \"serve\""]
```

The launcher resolves `thumbgate@latest` each time Codex starts the MCP server instead of reusing a stale installed binary. If you are developing from an unpublished local checkout, `npx thumbgate init --agent codex` falls back to the local `adapters/mcp/server-stdio.js` path so work-in-progress code still runs.

The repo-local Codex app plugin ships the same auto-updating runtime path through `plugins/codex-profile/.mcp.json`, so the manual config and plugin metadata stay aligned.

The Codex status line and hook bundle live in `~/.codex/config.json`. `npx thumbgate init --agent codex` writes:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest && ~/.thumbgate/runtime/node_modules/.bin/thumbgate gate-check" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest && ~/.thumbgate/runtime/node_modules/.bin/thumbgate hook-auto-capture" }] }],
    "PostToolUse": [{ "matcher": "mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard", "hooks": [{ "type": "command", "command": "npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest && ~/.thumbgate/runtime/node_modules/.bin/thumbgate cache-update" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest && ~/.thumbgate/runtime/node_modules/.bin/thumbgate session-start" }] }]
  },
  "statusLine": {
    "type": "command",
    "command": "npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest && ~/.thumbgate/runtime/node_modules/.bin/thumbgate statusline-render"
  }
}
```

The real generated command includes a `mkdir -p ~/.thumbgate/runtime` guard before the `npm install` call and suppresses install noise.

## Verify

Start the MCP server manually to confirm it runs:

```bash
node adapters/mcp/server-stdio.js
# Expected: MCP server listening on stdio
# Press Ctrl+C to stop
```

Then restart Codex. The `thumbgate` MCP server will appear in the tool list, and `~/.codex/config.json` will contain the ThumbGate hook bundle plus the `statusLine` command target for your local Codex build to exercise.

## Available Tools (via MCP)

- `capture_feedback` — POST `/v1/feedback/capture`
- `feedback_summary` — GET `/v1/feedback/summary`
- `prevention_rules` — POST `/v1/feedback/rules`
- `plan_intent` — POST `/v1/intents/plan`

## Requirements

- Codex with MCP support
- Node.js 18+ in PATH
- Config file at `~/.codex/config.toml` when using the manual MCP install path

## Uninstall

Remove the `[mcp_servers.thumbgate]` section from `~/.codex/config.toml`.
