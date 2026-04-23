---
"thumbgate": minor
---

feat(adapters): Cline adapter for Roo Code sunset capture

Adds a first-class Cline adapter (`adapters/cline/.mcp.json`, `.clinerules`, `INSTALL.md`) and wires `npx thumbgate init --agent cline` to auto-register the ThumbGate MCP server in Cline's VS Code globalStorage settings and drop `.clinerules` into the project root. Updates README, landing page, and compare page to list Cline alongside Claude Code, Cursor, Codex, Gemini CLI, Amp, and OpenCode. Captures migration audience from Roo Code's announced 2026-05-15 shutdown.
