# ThumbGate for JetBrains

This is the JetBrains Marketplace scaffold for ThumbGate.

## Current Scope

- Adds `Tools -> ThumbGate: Init Project` to write a project `.mcp.json`.
- Adds `Tools -> ThumbGate: Open Dashboard`.
- Reuses the same `thumbgate@latest` MCP runtime as VS Code, Cursor, Codex, Claude Desktop, and Open VSX-compatible installs.

## Marketplace Path

1. Build locally with Gradle:

```bash
./gradlew buildPlugin
```

2. Upload the first plugin ZIP manually in JetBrains Marketplace.
3. After approval, wire `publishPlugin` with a Marketplace token for future releases.

## Commercial Rule

Treat JetBrains as a discovery and trust surface. Do not claim installs, Marketplace approval, Pro upgrades, or revenue until JetBrains Marketplace and billing evidence prove them.
