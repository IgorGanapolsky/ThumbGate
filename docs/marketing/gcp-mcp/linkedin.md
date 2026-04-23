Google just turned every BigQuery, Spanner, AlloyDB, and Cloud SQL schema into an MCP tool call that Claude Code, Codex, and Gemini CLI can fire directly.

The blast radius of a single bad tool call just grew by the width of your warehouse.

IAM says "this service account may drop tables."
It does not say "Igor thumbs-down'd DROP TABLE on prod_events last Tuesday."
Role-based access controls the tenant. Feedback-based enforcement protects the session.

ThumbGate runs a local SQLite lesson DB next to your agent and gates the MCP tool call before it executes. One thumbs-down on a destructive BigQuery pattern and every future agent — Claude Code today, Codex tomorrow, an autopilot cron next week — refuses the same call.

npx thumbgate init --agent claude-code

Full guide: https://thumbgate.ai/guides/gcp-mcp-guardrails

#ThumbGate #GoogleCloudNext
