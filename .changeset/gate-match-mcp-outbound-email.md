---
"thumbgate": patch
---

Make gate-check actually fire on MCP tool calls and block outbound email send.

`matchGate` only inspected `toolInput.command`, so Gmail MCP tools
(`send_message`, `send_draft`) and any other non-Bash surface never matched a
pattern gate — auto-promoted rules sat at `lastFiredAt: null` forever. The same
failure class that filed on 2026-06-06 (agent cold-emailed without review)
recurred 2026-08-04 because a prose force-gate could not match any tool call.

- Multi-surface matching: tool name + command + light endpoint fields
- First-class `outbound-email-send` hard block in default policy (draft tools allowed)
- force-promote derives matchable surfaces for email/force-push; refuses inert prose
- Quarantine inert prose gates on promote; keep gate-stats totals numeric

Verified: Gmail `send_message` denies with `[GATE:outbound-email-send]`;
`create_draft` allows; force-push still denies; focused suites green.

Also blocks Python googleapiclient `messages().send()` — the shape used in the Resume/District Cyber incident.


Hard-floor: outbound-email-send never demotes via applyEnforcementPosture or free-tier daily cap.
