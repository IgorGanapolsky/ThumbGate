# OpenCode: ThumbGate MCP Profile Install

This repo already ships a project-scoped `opencode.json` for local work inside the source tree.

If you want the same MCP server in another OpenCode project or in your global OpenCode config, use the portable adapter profile below.

## One-Command Install

Create a global OpenCode config if you do not have one yet:

```bash
mkdir -p ~/.config/opencode
cp adapters/opencode/opencode.json ~/.config/opencode/opencode.json
```

If you already have `~/.config/opencode/opencode.json`, merge in the `mcp.thumbgate` block from `adapters/opencode/opencode.json` instead of overwriting your config.

## What Gets Added

The portable profile adds this MCP server entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "thumbgate": {
      "type": "local",
      "command": ["npx", "--yes", "--package", "thumbgate@1.16.20", "thumbgate", "serve"],
      "enabled": true
    }
  }
}
```

## Verify

Run OpenCode in any project and confirm the `thumbgate` MCP server is available:

```bash
opencode
```

For this repository specifically, the committed `opencode.json` also enables:

- repo-local worktree-safe permissions
- a read-only `thumbgate-review` subagent in `.opencode/agents/thumbgate-review.md`
- concise workflow instructions in `.opencode/instructions/thumbgate-workflow.md`

## Requirements

- OpenCode with MCP support
- Node.js 18+ in PATH
- `npx` available in PATH

## Uninstall

Remove the `mcp.thumbgate` entry from your OpenCode config.
