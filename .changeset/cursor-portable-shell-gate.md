---
"thumbgate": patch
---

The Cursor shell gate no longer points at one install's folder. `thumbgate init --agent cursor` used to write `node <install>/scripts/cursor-shell-gate.js` with `failClosed: true` into the user-wide `~/.cursor/hooks.json`; when that npx cache or checkout went away, every shell command in every Cursor project was blocked. It now writes the same portable runtime command as the other hooks (`thumbgate cursor-gate` through the shim or pinned `npm exec`). Existing installs are moved over on the next ThumbGate MCP server start or shell command, in place, keeping other hooks untouched. `thumbgate cursor-gate` now fails closed on an internal error, like the script it replaces, instead of allowing the command.
