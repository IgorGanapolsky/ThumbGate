---
'thumbgate': patch
---

Remove five MCP tools that were advertised but had no handler.

`schedule`, `user_profile`, `session_search`, `webhook_deliver`, and
`infer_lesson_from_history` appeared in `tools/list` with full input schemas
while the dispatcher had no case for any of them, so calling one returned
`Unsupported tool: <name>`. `webhook_deliver` was the worst of these — it
advertised sending messages to Slack, Teams, and Discord, so a client could
plan an entire notification workflow around a capability that did not exist.

`tests/mcp-tool-dispatch-parity.test.js` now fails if any advertised tool
lacks a dispatcher case, accounting for the `get_reliability_rules` →
`prevention_rules` alias.
