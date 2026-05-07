# ThumbGate for Google Antigravity

Antigravity is treated as a VS Code-compatible distribution lane until Google exposes a stable first-party Antigravity plugin marketplace.

## Recommended Install Path

1. Install the ThumbGate VSIX from the latest GitHub Release or Open VSX once published.
2. Open the Antigravity workspace you want to protect.
3. Run `ThumbGate: Init Workspace`.
4. Confirm the workspace has `.vscode/mcp.json` with:

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

5. Start or trust the ThumbGate MCP server from the editor's MCP server manager.

## Positioning

- Say: "ThumbGate works in Antigravity-compatible VS Code extension/MCP setups."
- Do not say: "Published in the Antigravity Marketplace" until Google provides a marketplace and the listing is live.
- Use Open VSX and direct VSIX as the distribution path for now.

## Revenue Follow-On

The Antigravity lane should route serious users to the same conversion stack:

- Setup guide: `https://thumbgate-production.up.railway.app/guide?utm_source=antigravity&utm_medium=vsix&utm_campaign=setup`
- Pro checkout: `https://thumbgate.ai/checkout/pro?utm_source=antigravity&utm_medium=vsix&utm_campaign=pro_follow_on&plan_id=pro`
- Workflow Hardening Sprint: `https://thumbgate.ai/?utm_source=antigravity&utm_medium=vsix&utm_campaign=workflow_sprint#workflow-sprint-intake`
