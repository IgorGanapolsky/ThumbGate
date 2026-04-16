---
thumbgate: minor
---

Cursor plugin: fix broken promises and add real wiring. README claimed `npx thumbgate init --agent cursor` worked; it didn't. Added cursor detection + dispatcher + `wireCursorHooks` that writes `.cursor/mcp.json` with the ThumbGate MCP server (preserves other entries, idempotent). Added dedicated "🎯 Cursor plugin" card to the landing page Compatibility section with a real install URL. Added Cursor install link to the First-Dollar step 1 and hero secondary CTAs. 5 new tests guard the wiring. Also hardens landing-page pills into real `<a>` clickable links with hover/focus states.
