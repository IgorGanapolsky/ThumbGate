# IDE Marketplace Distribution

Status: implementation-ready. Open VSX has a published ThumbGate listing, but the verified listing is stale until it is republished from the current extension package. VS Code Marketplace and public Cursor Marketplace availability must not be claimed without live listing proof.

## Priority

1. Open VSX refresh for Antigravity-compatible installs
2. Cursor public/team marketplace proof
3. VS Code Marketplace
4. JetBrains Marketplace

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

Verified state on 2026-06-03:

- Open VSX `igorganapolsky/thumbgate`: published, version `1.16.22`, stale relative to repo package metadata.
- VS Code Marketplace `igorganapolsky.thumbgate`: no listing found through the public gallery API.

Publish or refresh once the Marketplace assets are reviewed:

```bash
cd plugins/vscode-extension
npx --yes @vscode/vsce package
npx --yes @vscode/vsce publish
npx --yes ovsx publish *.vsix
```

## Antigravity

- Install doc: `plugins/antigravity-extension/INSTALL.md`
- Current path: Open VSX or direct VSIX.
- Current evidence: Antigravity's extension search can surface the Open VSX listing, but that listing must be refreshed from `plugins/vscode-extension/`.
- Claim discipline: do not call it an Antigravity Marketplace listing until a first-party listing is live.

## Cursor

- Plugin source: `plugins/cursor-marketplace/`
- Manifest: `plugins/cursor-marketplace/.cursor-plugin/plugin.json`
- Runtime: `npx --yes --package thumbgate@latest thumbgate serve`
- Public submission path: `https://cursor.com/dashboard/plugins`
- Team fallback: import this repository through `Dashboard -> Settings -> Plugins -> Team Marketplaces`
- Current evidence: the user-provided Cursor dashboard screenshot from 2026-06-03 shows no installed ThumbGate plugin in that account.
- Claim discipline: say "Cursor plugin bundle" or "Cursor Team Marketplace import path" until a public Cursor Marketplace listing is visibly live.

## JetBrains

- Scaffold root: `plugins/jetbrains-plugin/`
- Build command: `./gradlew buildPlugin`
- First Marketplace upload is manual; subsequent releases can use Gradle publishing after the listing exists.

## Revenue Routing

Every IDE listing should use the same conversion ladder:

1. Free install for one visible caught repeat.
2. Pro checkout for ongoing local enforcement and proof export.
3. Workflow Hardening Sprint when a team names one risky workflow.

Use UTM sources: `vscode`, `open_vsx`, `antigravity`, `jetbrains`.
