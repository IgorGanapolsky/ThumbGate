# ThumbGate for Codex

ThumbGate now ships a standalone Codex plugin bundle in GitHub Releases, alongside the repo-local Codex profile in this repository.

## Release surfaces

- Latest standalone bundle: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`
- Versioned bundle pattern: `https://github.com/IgorGanapolsky/ThumbGate/releases/download/v<VERSION>/thumbgate-codex-plugin-v<VERSION>.zip`
- Source plugin manifest: `plugins/codex-profile/.codex-plugin/plugin.json`
- Source MCP config: `plugins/codex-profile/.mcp.json`
- Manual install profile: `adapters/codex/config.toml`
- Update policy: Codex resolves `thumbgate@latest` on MCP and hook startup; unpublished local source checkouts still fall back to the local server path

## What it does

- adds ThumbGate's Pre-Action Gates to Codex workflows
- captures thumbs-up/down feedback that survives session boundaries
- auto-refreshes the Codex MCP/hook runtime from the latest npm release on startup
- writes the ThumbGate status line target alongside the Codex hook bundle
- reuses the same local-first MCP runtime as Claude, Cursor, Gemini, Amp, and OpenCode

## What's inside the standalone bundle

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `.agents/plugins/marketplace.json`
- `config.toml`
- `README.md`, `INSTALL.md`, and `AGENTS.md`

The bundled marketplace catalog rewrites the plugin path to `./`, so the extracted folder can act as a self-contained plugin root instead of depending on this repository layout.

## Install paths

### Standalone Codex plugin bundle

Download the latest `thumbgate-codex-plugin.zip`, unzip it, and point Codex at the extracted `thumbgate-codex-plugin/` directory when you want a standalone plugin release surface.

### Repo-local Codex app plugin

Use the plugin metadata and MCP config in this folder when Codex is loading plugin surfaces directly from the repository.

### Manual install

Preferred path:

```bash
npx thumbgate init --agent codex
```

That writes the MCP server block to `~/.codex/config.toml` and the Codex hook/status-line bundle to `~/.codex/config.json`.

If you only need the MCP server manually, copy the MCP profile from `adapters/codex/config.toml` into `~/.codex/config.toml`.

That profile launches the latest npm release instead of pinning a stale local runtime:

```toml
[mcp_servers.thumbgate]
command = "sh"
args = ["-lc", "mkdir -p \"$HOME/.thumbgate/runtime\" && npm \"install\" \"--prefix\" \"$HOME/.thumbgate/runtime\" \"--no-save\" \"--omit=dev\" \"thumbgate@latest\" >/dev/null 2>&1 && exec \"$HOME/.thumbgate/runtime/node_modules/.bin/thumbgate\" \"serve\""]
```

### Build from source

Build the same standalone release bundle locally with:

```bash
npm run build:codex-plugin
```

## Why this exists

The Codex support story is no longer just "copy this config block." ThumbGate now has a direct-download Codex plugin bundle, a repo-local plugin surface, and an auto-updating manual MCP profile so release assets, install docs, and the runtime stay aligned with npm.
