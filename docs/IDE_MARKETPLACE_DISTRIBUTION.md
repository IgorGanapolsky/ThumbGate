# IDE Marketplace Distribution

Status: implementation-ready. Open VSX has a published ThumbGate listing at the current package version. VS Code Marketplace publish logs confirm `1.27.16`, but the public gallery API must show the current version before buyer-facing copy claims the refresh has propagated. Public Cursor Marketplace availability must not be claimed without live listing proof.

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

Verified state on 2026-06-25:

- Open VSX `igorganapolsky/thumbgate`: public API reports version `1.27.16` at `2026-06-25T14:20:19.655304Z`.
- VS Code Marketplace `igorganapolsky.thumbgate`: workflow `28176778805` logs `Published igorganapolsky.thumbgate v1.27.16`; the public gallery API still returned version `1.27.15` at `2026-06-25T14:22:06Z`.

Publish or refresh command path:

```bash
cd plugins/vscode-extension
npx --yes @vscode/vsce package
npx --yes @vscode/vsce publish
npx --yes ovsx publish *.vsix
```

## Antigravity

- Install doc: `plugins/antigravity-extension/INSTALL.md`
- Current path: Open VSX or direct VSIX.
- Current evidence: Antigravity's extension search can surface the Open VSX listing, which is current at `1.27.16`.
- Claim discipline: do not call it an Antigravity Marketplace listing until a first-party listing is live.

## Cursor

- Plugin source: `plugins/cursor-marketplace/`
- Manifest: `plugins/cursor-marketplace/.cursor-plugin/plugin.json`
- Runtime: `npx --yes --package thumbgate@latest thumbgate serve`
- Public submission path: `https://cursor.com/dashboard/plugins`
- Team fallback: import this repository through `Dashboard -> Settings -> Plugins -> Team Marketplaces`
- Current evidence: `npm run cursor:marketplace:doctor:json` on 2026-06-25 reports `publicStatus: not_live` with public listing reason `cursor_marketplace_plugin_not_found`; the user-provided Cursor dashboard screenshot from 2026-06-03 shows no installed ThumbGate plugin in that account.
- Claim discipline: say "Cursor plugin bundle" or "Cursor Team Marketplace import path" until a public Cursor Marketplace listing is visibly live.

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
