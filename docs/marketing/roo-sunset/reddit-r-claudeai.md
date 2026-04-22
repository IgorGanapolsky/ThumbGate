# Roo Code is shutting down May 15. Make sure your agent's memory survives the migration.

Roo Code announced the sunset yesterday. They officially recommended Cline as the successor — same MCP wire format, VS Code extension, model-agnostic. Most people can swap the extension and their workflow keeps working.

Here is the part nobody is talking about:

Every time you thumbs-downed a Roo action ("stop suggesting git push --force," "this codebase uses pnpm not npm," "never auto-generate Prisma migrations on prod"), that correction lived in Roo's context memory. When Roo goes dark, those lessons evaporate. You start teaching your new agent the same mistakes from scratch.

That is dumb. Vendor-scoped memory should not be a thing in 2026.

ThumbGate fixes this with a local lesson DB (SQLite + FTS5) at `.thumbgate/memory.sqlite`. Every thumbs-down becomes a row. On the next tool call, an MCP server checks the proposed call against the DB and blocks known-bad patterns before execution. Works with Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, and any MCP-compatible agent.

Migration is one command:

```
npx thumbgate init --agent cline
```

Any lessons you already captured under Roo carry over unchanged — the DB lives in your project, not in Roo's servers.

Full Cline setup doc: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md

Repo (MIT-ish, no cloud, no account required): https://github.com/IgorGanapolsky/ThumbGate
