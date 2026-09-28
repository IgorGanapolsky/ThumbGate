---
name: devday-2026-unattended-wake-not-clone
description: >
  OpenAI DevDay 2026 is a product launch, not a ThumbGate install. Steal the
  default-off always-on posture, mention-is-not-a-grant, and automatic-review
  cannot-land rules onto background-agent governance. Never install Codex, a
  ChatGPT plugin, Bedrock, Daybreak, or call a model from the gate.
  Slash: /devday-2026-unattended-wake-not-clone.
---

# DevDay 2026 unattended wake — compare, do not clone

## Goal

Keep unattended mutation off until an admin enables it. An inbound mention
stays data. An automatic review can summarize a diff and cannot approve or
merge. A permission stays with one identity. A raw capture is dropped once a
durable note exists.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install Codex, a ChatGPT plugin, Bedrock, Daybreak, or the MCP Events spec | `evaluateUnattendedWake` in `scripts/background-agent-governance.js` |
| Quote a DevDay price, speed tier, or user count as a ThumbGate measurement | Deny `UNATTENDED_DEFAULT_OFF` until an admin enable is present |
| Treat `@mention`, email, Slack, Teams, or a board event as a tool grant | Require `operatorGrant` before a mutating inbound wake |
| Let an unattended or automatic review run `gh pr merge` or `gh pr review --approve` | Deny `AUTOMATIC_REVIEW_CANNOT_LAND` even after the admin enable |
| Copy wake text or raw audio into the deny payload | Keep the durable note as the record (`RAW_CAPTURE_RETAINED`) |
| Call a model from this gate | Finite answers stay on `typesafe-typed-questions` (`noul`, `choice`, `score`) |

## Procedures

```bash
npm run test:background-governance
node bin/cli.js background-agent-governance --check --json --unattended --tool-name Bash --command 'git commit -m wip'
```

Exit 2 and `UNATTENDED_DEFAULT_OFF` means the admin enable is absent. The same command with `--enabled` is allowed by this gate. Adding `gh pr merge` brings back `AUTOMATIC_REVIEW_CANNOT_LAND`.

## Reference

- https://openai.com/index/devday-2026-recap/
- `scripts/background-agent-governance.js`
- `docs/agents/devday-2026-unattended-wake.md`
