# ThumbGate for Google Antigravity

Pre-action gates and reliability memory for AI coding agents in Google Antigravity IDE.

## Features

- Block known-bad tool calls before they execute
- Capture thumbs up/down feedback into structured prevention rules
- MCP server integration for real-time gate checking
- Compatible with VS Code extension marketplace (VSIX)

## Install

Antigravity uses VS Code-compatible extensions. Install the ThumbGate VSIX:

```bash
npx thumbgate init --agent antigravity
```

Or install the VSIX manually from the [latest release](https://github.com/IgorGanapolsky/ThumbGate/releases/latest).

## MCP Server

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "thumbgate": {
      "command": "npx",
      "args": ["--yes", "--package", "thumbgate@latest", "thumbgate", "serve"]
    }
  }
}
```

## Links

- [Documentation](https://thumbgate-production.up.railway.app/guide?utm_source=antigravity)
- [Pro Plan](https://thumbgate-production.up.railway.app/pricing?utm_source=antigravity)
- [GitHub](https://github.com/IgorGanapolsky/ThumbGate)
