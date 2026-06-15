# ThumbGate for VS Code-Compatible IDEs

![ThumbGate blocks risky AI agent actions before they run](https://raw.githubusercontent.com/IgorGanapolsky/ThumbGate/main/plugins/vscode-extension/assets/marketplace-hero.png)

ThumbGate adds a local MCP guardrail layer for AI coding agents. It captures thumbs up/down feedback, turns repeated mistakes into local prevention rules, and checks risky tool calls before they run.

Works through VS Code's MCP provider API plus a `.vscode/mcp.json` fallback for VS Code-compatible IDEs, including Open VSX and Antigravity-style forks.

## Why Install

- **Block repeat mistakes before tool use** — catch known-bad shell, deploy, publish, and file-edit patterns before they execute.
- **Capture feedback where the work happens** — use command palette actions for positive and negative feedback.
- **Keep the runtime fresh** — the extension launches `thumbgate@latest`, so npm runtime fixes can reach installed users without a marketplace metadata refresh.
- **Stay local-first** — the default MCP server runs locally over stdio.

![ThumbGate feedback-to-gate flow](https://raw.githubusercontent.com/IgorGanapolsky/ThumbGate/main/plugins/vscode-extension/assets/marketplace-flow.png)

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

## Distribution Status

- **Open VSX / Antigravity-compatible installs:** publish with `ovsx publish` from this extension package.
- **VS Code Marketplace:** publish separately with `vsce publish`; do not claim VS Code Marketplace availability until the listing exists.
- **Direct VSIX:** attach the generated `.vsix` to GitHub Releases for users in VS Code-compatible IDEs without marketplace access.

Do not claim Marketplace installs, Open VSX freshness, Antigravity first-party listing status, Pro upgrades, or revenue until the corresponding marketplace dashboard or billing data proves it.
