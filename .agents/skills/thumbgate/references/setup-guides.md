# ThumbGate Setup Guides

## Claude Code

```bash
npx thumbgate init
```

This auto-configures `.mcp.json` with the ThumbGate MCP server. Claude Code
picks it up automatically on next session start.

## Cursor

ThumbGate ships with a bundled Cursor plugin in the `plugins/` directory.

```bash
# Copy plugin to Cursor extensions
cp -r plugins/cursor ~/.cursor/extensions/thumbgate
```

Or use the MCP config approach — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["-y", "thumbgate"]
    }
  }
}
```

## Codex (OpenAI)

Codex uses a repo-local app plugin profile:

```bash
npx thumbgate init --codex
```

This creates `.codex/plugins/thumbgate/` with the app plugin manifest.

## Gemini CLI / Amp / OpenCode

All MCP-compatible CLIs use the same `.mcp.json` config:

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["-y", "thumbgate"]
    }
  }
}
```

## Claude Desktop

Install the Claude Desktop extension:

```bash
npx thumbgate init --claude-desktop
```

Or grab the packaged `.mcpb` bundle from GitHub Releases.

## Verifying Installation

After setup, run:

```bash
npm run self-heal:check
```

Expected output: `4/4 HEALTHY`
