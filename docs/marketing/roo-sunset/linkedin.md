Roo Code announced its sunset yesterday. Final shutdown: May 15, 2026.

The team officially recommended Cline as the model-agnostic open-source successor. Good choice — Cline reads the same MCP wire format, runs as a VS Code extension, no vendor lock-in.

But here is the quieter problem: every lesson your AI coding agent learned inside Roo — every "don't git push --force to main," every "this repo never uses that migration pattern" — lived in Roo's proprietary context. When Roo goes dark, so does that memory.

If you are going to migrate agents, it should be the last time you have to migrate their memory.

ThumbGate stores lesson memory in a local SQLite file (`.thumbgate/memory.sqlite`). When Cline proposes a tool call that matches a known-bad pattern, ThumbGate's MCP server blocks it before the call executes. The DB is yours, on your disk, and it works with Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, and any MCP-compatible agent.

When Cline eventually gets replaced by whatever ships in 2027, you copy one SQLite file and your agent's institutional memory moves with you.

```
npx thumbgate init --agent cline
```

That is the entire migration.

Migration guide: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md

#Cline #RooCode
