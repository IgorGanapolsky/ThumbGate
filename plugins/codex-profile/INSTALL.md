# ThumbGate for Codex

ThumbGate now ships an auto-updating Codex MCP profile, a repo-local Codex app plugin surface, and a standalone plugin bundle.

## Fastest supported path: CLI setup

Use this path first. It is the current supported install path for Codex Desktop users because it writes the Codex MCP and hook config directly.

```bash
npx thumbgate init --agent codex
```

That installs:

- the ThumbGate MCP server in `~/.codex/config.toml`
- Codex hooks plus the ThumbGate status line target in `~/.codex/config.json`

Immediately verify the feedback loop:

```bash
npx thumbgate feedback-self-test
```

This is the dogfood check: it captures a synthetic thumbs signal and verifies the local feedback + lesson files. Use `npx thumbgate feedback-self-test --persist` only when you want the self-test stored in the active ThumbGate project memory.

Restart Codex after setup. In the Codex app, open **Plugins** or MCP settings and confirm ThumbGate is enabled before expecting tools or hooks to fire.

## Why this matters now

Codex plugins are no longer just a developer convenience. Role-specific plugins, Sites, annotations, and shared workspace installs move Codex into sales, analytics, design, finance, documents, dashboards, and team operating systems. ThumbGate should sit underneath that expansion as the pre-action governance layer:

- role-plugin writes need allowed tool scopes and evidence labels
- Sites deploys need build proof, audience proof, and secret-handling proof
- annotated document edits need source-region evidence and document-level invariants
- Agentic OS files such as skills, MCP config, hooks, and workflow contracts need protected-path checks
- shared team memory needs client/user/workspace scope before it is queried or promoted into gates

## Codex Desktop plugin install: what the zip does and does not do

The release zip is not a double-click macOS installer, and it is not a guaranteed one-click Codex Desktop import path. It is a portable Codex plugin folder for review, offline handoff, release assets, and manual marketplace/local-plugin workflows.

If your Codex Desktop build exposes a local plugin install flow:

1. Download and unzip the release bundle.
2. Select the extracted `thumbgate-codex-plugin/` folder, not the zip file.
3. Confirm the selected folder contains `.codex-plugin/plugin.json`.
4. Install or enable ThumbGate from the Codex plugin directory.
5. Restart Codex and run `npx thumbgate feedback-self-test`.

If your Codex Desktop build does not expose a local plugin import flow, use `npx thumbgate init --agent codex`. Do not double-click the zip and expect Codex to install it.

For CLI or repo-based plugin distribution, use a Codex marketplace:

```bash
codex plugin marketplace add ./path/to/thumbgate-codex-plugin
```

Then restart Codex, open the plugin directory, choose the marketplace source, and install ThumbGate from there.

## Codex Desktop marketplace modal fields

If you are using the Codex Desktop **Add marketplace** dialog, the default sparse path shown by Codex may not match this repository. Use one of these working configurations instead.

### Local checkout

- Source: `/Users/igorganapolsky/workspace/git/igor/ThumbGate/repo`
- Git ref: leave blank for the local checkout
- Sparse paths: leave blank

### GitHub repo

- Source: `https://github.com/IgorGanapolsky/ThumbGate`
- Git ref: `main` for the latest public release, or the active PR branch when testing unreleased changes
- Sparse paths:

```text
.agents/plugins/marketplace.json
plugins/codex-profile
```

After adding the marketplace, clear restrictive filters such as **Built by OpenAI**. ThumbGate is a local or third-party marketplace plugin, so it will not appear while the plugin directory is filtered to OpenAI-built plugins only.

## Portable release bundle

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

## Repo-local plugin files

## Shipped plugin files

- Codex plugin manifest: `plugins/codex-profile/.codex-plugin/plugin.json`
- Codex MCP config: `plugins/codex-profile/.mcp.json`
- Codex marketplace entry: `.agents/plugins/marketplace.json`
- Manual MCP install profile: `adapters/codex/config.toml`

## Manual MCP install

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
args = ["-lc", "[ -x \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" ] && exec \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" \"serve\" || mkdir -p \"$HOME/.thumbgate/runtime\" && exec npm \"exec\" \"--prefix\" \"$HOME/.thumbgate/runtime\" \"--yes\" \"--package\" \"thumbgate@latest\" \"--\" \"thumbgate\" \"serve\""]
```

The launcher resolves `thumbgate@latest` each time Codex starts the MCP server instead of reusing a stale installed binary. If you are developing from an unpublished local checkout, `npx thumbgate init --agent codex` falls back to the local `adapters/mcp/server-stdio.js` path so work-in-progress code still runs.

The repo-local Codex app plugin ships the same auto-updating runtime path through `plugins/codex-profile/.mcp.json`, so the manual config and plugin metadata stay aligned.

The Codex status line and hook bundle live in `~/.codex/config.json`. `npx thumbgate init --agent codex` writes:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "[ -x ~/.thumbgate/runtime/node_modules/.bin/thumbgate ] && exec ~/.thumbgate/runtime/node_modules/.bin/thumbgate gate-check || mkdir -p ~/.thumbgate/runtime && exec npm exec --prefix ~/.thumbgate/runtime --yes --package thumbgate@latest -- thumbgate gate-check" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "[ -x ~/.thumbgate/runtime/node_modules/.bin/thumbgate ] && exec ~/.thumbgate/runtime/node_modules/.bin/thumbgate hook-auto-capture || mkdir -p ~/.thumbgate/runtime && exec npm exec --prefix ~/.thumbgate/runtime --yes --package thumbgate@latest -- thumbgate hook-auto-capture" }] }],
    "PostToolUse": [{ "matcher": "mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard", "hooks": [{ "type": "command", "command": "[ -x ~/.thumbgate/runtime/node_modules/.bin/thumbgate ] && exec ~/.thumbgate/runtime/node_modules/.bin/thumbgate cache-update || mkdir -p ~/.thumbgate/runtime && exec npm exec --prefix ~/.thumbgate/runtime --yes --package thumbgate@latest -- thumbgate cache-update" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "[ -x ~/.thumbgate/runtime/node_modules/.bin/thumbgate ] && exec ~/.thumbgate/runtime/node_modules/.bin/thumbgate session-start || mkdir -p ~/.thumbgate/runtime && exec npm exec --prefix ~/.thumbgate/runtime --yes --package thumbgate@latest -- thumbgate session-start" }] }]
  },
  "statusLine": {
    "type": "command",
    "command": "[ -x ~/.thumbgate/runtime/node_modules/.bin/thumbgate ] && exec ~/.thumbgate/runtime/node_modules/.bin/thumbgate statusline-render || mkdir -p ~/.thumbgate/runtime && exec npm exec --prefix ~/.thumbgate/runtime --yes --package thumbgate@latest -- thumbgate statusline-render"
  }
}
```

The real generated command fast-starts from the installed runtime binary and only resolves `thumbgate@latest` via `npm exec` (npx) when that binary is absent, so Codex never blocks MCP/hook startup on a per-launch reinstall.

## Verify

First prove capture works:

```bash
npx thumbgate feedback-self-test
```

Then start the MCP server manually if you are debugging transport:

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
