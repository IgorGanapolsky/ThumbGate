---
"thumbgate": minor
---

Add a universal claim evaluator that parses supported factual free-text claims (row counts, file lines/bytes/existence, package versions), rechecks operator-bound SQLite/filesystem/JSON verifiers, and fails closed through MCP completion gates, the Claude Stop hook, or the portable `verify-claims` CLI on mismatch, missing verifier, invalid config, or verifier error.
