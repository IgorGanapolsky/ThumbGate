# ThumbGate for VS Code

ThumbGate gives VS Code and Open VSX-compatible IDEs a local MCP server for AI-agent feedback, pre-action checks, and repeated-mistake prevention.

## What It Adds

- Registers the ThumbGate MCP server with VS Code's MCP provider API.
- Installs a workspace `.vscode/mcp.json` fallback for VS Code, Antigravity-style VS Code forks, and Open VSX users.
- Adds commands for workspace setup, feedback capture, stats, dashboard, and Pro upgrade.
- Resolves `thumbgate@latest` at runtime so npm fixes reach installed extension users without requiring a Marketplace metadata refresh.

## Commands

- `ThumbGate: Init Workspace`
- `ThumbGate: Capture Positive Feedback`
- `ThumbGate: Capture Negative Feedback`
- `ThumbGate: Show Stats`
- `ThumbGate: Open Dashboard`
- `ThumbGate: Upgrade to Pro`

## Manual MCP Fallback

If your editor does not load the extension MCP provider, run `ThumbGate: Init Workspace` and inspect `.vscode/mcp.json`:

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

Then run `MCP: List Servers` and start ThumbGate.

## Publish Targets

- VS Code Marketplace: package with `vsce package`, then publish with `vsce publish`.
- Open VSX / Antigravity-compatible path: package the same extension and publish with `ovsx publish`.
- Direct VSIX: attach the generated `.vsix` to a GitHub Release for users in VS Code-compatible IDEs without Marketplace access.

Do not claim Marketplace installs, Open VSX publication, Antigravity support, Pro upgrades, or revenue until the corresponding Marketplace dashboard or billing data proves it.
