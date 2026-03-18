# MCP Memory Gateway for Cursor

`mcp-memory-gateway` packages the **Agentic Feedback Studio** and **Veto Layer** for Cursor as a marketplace-ready plugin bundle.

The plugin installs the project MCP server so Cursor agents can:

- capture explicit user feedback with evidence
- recall past mistakes before repeating them
- generate prevention rules from repeated failures
- build bounded context packs with provenance
- export DPO-style preference pairs and Databricks analytics bundles

## Plugin contents

- `.cursor-plugin/plugin.json` for Cursor Marketplace metadata
- `.mcp.json` for the `rlhf` MCP server
- `assets/logo-400x400.png` for marketplace branding

This first Cursor package is intentionally minimal. It bundles the MCP server only, which keeps the review surface small and aligns with Cursor Cloud Agents support.

## Install paths

### Cursor Marketplace

After approval, install directly from the public Cursor Marketplace listing.

### Team Marketplace

Cursor Teams and Enterprise can import this repository through `Dashboard -> Settings -> Plugins -> Team Marketplaces`.

### Local setup before approval

Use the existing project bootstrap:

```bash
npx mcp-memory-gateway init
```

Or copy the plugin MCP config into `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rlhf": {
      "command": "npx",
      "args": ["-y", "mcp-memory-gateway@0.7.2", "serve"]
    }
  }
}
```

## What makes this useful in Cursor

MCP Memory Gateway gives Cursor agents a local-first feedback loop:

- **Veto Layer** gates block repeated mistakes before tool use
- **Context engineering** keeps relevant project history in scope
- **Thompson Sampling** and attribution logs improve action ranking
- **DPO exports** let you warehouse and fine-tune downstream

Verification evidence for shipped behavior lives in `docs/VERIFICATION_EVIDENCE.md`.
