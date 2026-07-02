# ThumbGate for Codex

ThumbGate ships a Codex plugin surface, a CLI-first setup path, and a portable release bundle for review/offline installs. The portable zip remains the standalone Codex plugin bundle, but it is not the main path to advertise.

## Release surfaces

- Primary install command: `npx thumbgate init --agent codex`
- Latest portable bundle: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`
- Versioned bundle pattern: `https://github.com/IgorGanapolsky/ThumbGate/releases/download/v<VERSION>/thumbgate-codex-plugin-v<VERSION>.zip`
- Source plugin manifest: `plugins/codex-profile/.codex-plugin/plugin.json`
- Source MCP config: `plugins/codex-profile/.mcp.json`
- Manual install profile: `adapters/codex/config.toml`
- Update policy: Codex resolves `thumbgate@latest` on MCP and hook startup; unpublished local source checkouts still fall back to the local server path

## What it does

- adds ThumbGate's Pre-Action Checks to Codex workflows
- captures thumbs-up/down feedback that survives session boundaries
- auto-refreshes the Codex MCP/hook runtime from the latest npm release on startup
- writes the ThumbGate status line target alongside the Codex hook bundle
- reuses the same local-first MCP runtime as Claude, Cursor, Gemini, Amp, and OpenCode
- gates role-plugin writes, Sites deploys, and Agentic OS operating-file changes before Codex turns them into durable business actions

## What's inside the standalone bundle

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `.agents/plugins/marketplace.json`
- `config.toml`
- `README.md`, `INSTALL.md`, and `AGENTS.md`

The bundled marketplace catalog rewrites the plugin path to `./`, so the extracted folder can act as a self-contained plugin root instead of depending on this repository layout.

## Install paths

### Fastest supported path: CLI setup

```bash
npx thumbgate init --agent codex
```

That writes the MCP server block to `~/.codex/config.toml` and the Codex hook/status-line bundle to `~/.codex/config.json`. It is the path to advertise because it works from a terminal, survives Codex restarts, and does not depend on users guessing how Desktop imports a zip.

Verify feedback capture with one command:

```bash
npx thumbgate feedback-self-test
```

The self-test captures a synthetic thumbs signal, verifies both `feedback-log.jsonl` and `memory-log.jsonl`, and prints the storage path. It uses an isolated test store by default; add `--persist` when you intentionally want to dogfood the active ThumbGate store.

### Codex plugin directory or marketplace

For local development or personal marketplace installs:

```bash
codex plugin marketplace add /path/to/ThumbGate
codex plugin add codex-profile@thumbgate-plugin-catalog
codex plugin list
```

That is the install route that makes "ThumbGate for Codex" appear in Codex Desktop's Plugins screen. After installation, open Codex Desktop, go to Plugins, clear restrictive filters such as "Built by OpenAI", and search for "ThumbGate".

If you use Codex Desktop's **Add marketplace** modal directly, do not keep the default `plugins/codex` sparse path. The repo marketplace needs `.agents/plugins/marketplace.json` plus `plugins/codex-profile`, or a local checkout source with sparse paths left blank.

### Portable release bundle

Download the latest `thumbgate-codex-plugin.zip`, unzip it, and point Codex at the extracted `thumbgate-codex-plugin/` directory when you need a standalone plugin release surface. This zip is not a double-click macOS installer and should not be the primary CTA.

### Manual MCP profile

If you only need the MCP server manually, copy the MCP profile from `adapters/codex/config.toml` into `~/.codex/config.toml`.

That profile launches the latest npm release instead of pinning a stale local runtime:

```toml
[mcp_servers.thumbgate]
command = "sh"
args = ["-lc", "[ -x \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" ] && exec \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" \"serve\" || mkdir -p \"$HOME/.thumbgate/runtime\" && exec npm \"exec\" \"--prefix\" \"$HOME/.thumbgate/runtime\" \"--yes\" \"--package\" \"thumbgate@latest\" \"--\" \"thumbgate\" \"serve\""]
```

### Build from source

Build the same standalone release bundle locally with:

```bash
npm run build:codex-plugin
```

## Why this exists

The Codex support story is no longer just "copy this config block." ThumbGate now has a CLI setup path for normal users, a Codex Desktop plugin listing for discovery, a portable bundle for offline review, and an auto-updating manual MCP profile so release assets, install docs, and the runtime stay aligned with npm.
