---
"thumbgate": minor
---

Gate shell commands that skills and slash commands run while they load. Claude Code 2.1.332 added the `PreSkillShellCommand` hook, and PreToolUse never fires for these commands. `npx thumbgate init` now wires `thumbgate skill-shell-gate` there when the installed Claude Code supports it, and the MCP server adds it to older installs on start. It runs the same gate-check engine, warns by default (law 12), and blocks with `THUMBGATE_SKILL_SHELL_GATE=enforce`.
