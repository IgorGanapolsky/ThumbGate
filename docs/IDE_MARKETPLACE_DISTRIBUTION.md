# IDE Marketplace Distribution

Status: implementation-ready, not yet proof of marketplace publication.

## Priority

1. VS Code Marketplace
2. Open VSX / direct VSIX for Antigravity-compatible installs
3. JetBrains Marketplace

## VS Code / Open VSX

- Extension root: `plugins/vscode-extension/`
- Runtime: `npx --yes --package thumbgate@latest thumbgate serve`
- MCP provider: `contributes.mcpServerDefinitionProviders`
- Workspace fallback: `.vscode/mcp.json`
- Commands:
  - `ThumbGate: Init Workspace`
  - `ThumbGate: Capture Positive Feedback`
  - `ThumbGate: Capture Negative Feedback`
  - `ThumbGate: Show Stats`
  - `ThumbGate: Open Dashboard`
  - `ThumbGate: Upgrade to Pro`

Publish once the Marketplace assets are reviewed:

```bash
cd plugins/vscode-extension
npx --yes @vscode/vsce package
npx --yes @vscode/vsce publish
npx --yes ovsx publish *.vsix
```

## Antigravity

- Install doc: `plugins/antigravity-extension/INSTALL.md`
- Current path: Open VSX or direct VSIX.
- Claim discipline: do not call it an Antigravity Marketplace listing until a first-party listing is live.

## JetBrains

- Scaffold root: `plugins/jetbrains-plugin/`
- Build command: `./gradlew buildPlugin`
- First Marketplace upload is manual; subsequent releases can use Gradle publishing after the listing exists.

## Revenue Routing

Every IDE listing should use the same conversion ladder:

1. Free install for one visible blocked repeat.
2. Pro checkout for ongoing local enforcement and proof export.
3. Workflow Hardening Sprint when a team names one risky workflow.

Use UTM sources: `vscode`, `open_vsx`, `antigravity`, `jetbrains`.
