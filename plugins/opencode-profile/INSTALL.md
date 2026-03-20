# OpenCode: RLHF MCP Profile Install

This repo already ships a project-scoped `opencode.json` for local work inside the source tree.

If you want the same MCP server in another OpenCode project or in your global OpenCode config, use the portable adapter profile below.

## One-Command Install

Create a global OpenCode config if you do not have one yet:

```bash
mkdir -p ~/.config/opencode
cp adapters/opencode/opencode.json ~/.config/opencode/opencode.json
```

If you already have `~/.config/opencode/opencode.json`, merge in the `mcp.rlhf` block from `adapters/opencode/opencode.json` instead of overwriting your config.

## What Gets Added

The portable profile adds this MCP server entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rlhf": {
      "type": "local",
      "command": ["npx", "-y", "mcp-memory-gateway@0.7.4", "serve"],
      "enabled": true
    }
  }
}
```

## Verify

Run OpenCode in any project and confirm the `rlhf` MCP server is available:

```bash
opencode
```

For this repository specifically, the committed `opencode.json` also enables:

- repo-local worktree-safe permissions
- a read-only `rlhf-review` subagent in `.opencode/agents/rlhf-review.md`
- concise workflow instructions in `.opencode/instructions/rlhf-workflow.md`

## Requirements

- OpenCode with MCP support
- Node.js 18+ in PATH
- `npx` available in PATH

## Uninstall

Remove the `mcp.rlhf` entry from your OpenCode config.
