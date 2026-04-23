# If you're running Claude Code against Google's new Agentic Data Cloud, add pre-action gates before autopilot fires.

Google announced the Agentic Data Cloud at Cloud Next on April 22. BigQuery, Spanner, AlloyDB, Cloud SQL, and Looker now speak MCP directly. The Data Agent Kit drops those tools into Claude Code, Codex, Gemini CLI, and VS Code on day one.

That means `DROP TABLE prod_events` is now a tool call your agent can attempt at 3am on a scheduled run.

IAM gates the service account. It does not gate the lesson you taught your agent yesterday.

ThumbGate runs as an MCP server next to Claude Code. It keeps a local SQLite lesson DB at `.thumbgate/memory.sqlite`. Every thumbs-down becomes a row. Before Claude Code fires a BigQuery mutation, the PreToolUse hook runs `gate_check` against the DB and blocks known-bad patterns — unscoped DELETEs, destructive DDL on `prod_*` datasets, `gcloud sql instances delete`, IAM escalation from an agent session.

Install is one line:

```
npx thumbgate init --agent claude-code
```

Zero adapter work. Data Agent Kit agents are already first-class-supported.

Knowledge Catalog is semantic metadata. Memory Bank is conversational recall. ThumbGate's lesson DB is tool-call behavior memory. All three coexist — none replaces the others.

Setup guide: https://thumbgate.ai/guides/gcp-mcp-guardrails
Repo: https://github.com/IgorGanapolsky/ThumbGate
