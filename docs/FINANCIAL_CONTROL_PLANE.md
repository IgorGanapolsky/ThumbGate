# ThumbGate Financial Control Plane (ERP-like)

Prevents agent-initiated financial disasters (e.g. unauthorized SaaS upgrades).

## Modules

| ERP analog | ThumbGate module | Behavior |
|------------|------------------|----------|
| **GL / Journal** | `~/.thumbgate/financial/journal.jsonl` | Append-only record of financial-intent allows/denies |
| **AP / Purchase control** | `classifyFinancialIntent` + PreToolUse spend-guard | Hard-deny checkout, upgrades, payment methods, credit buys |
| **Budget envelopes** | `config/financial-control.json` | Default **$0** daily/monthly agent spend |
| **Authorization** | `~/.thumbgate/spend-authorizations.jsonl` | Human-issued amount + vendor + TTL only |

## Default policy

- Agent spend envelope: **$0 / day** and **$0 / month**
- Free-tier search/usage (e.g. `apollo people search`) allowed
- Any paid mutation without human auth → **deny**
- Even with auth, amount must fit envelope caps (raise caps only by human editing config)

## CLI

```bash
thumbgate finance status
thumbgate finance journal 50
thumbgate finance evaluate Bash 'open https://app.apollo.io/#/settings/plans/upgrade'
# Human only — do not let the agent invent this without CEO intent:
thumbgate finance authorize --amount=25 --vendor=apollo --note="approved one-time" --ttl=30
```

## PreToolUse wiring

1. `thumbgate-spend-guard.js` (ERP + pattern hard deny)
2. `gate-check` with `THUMBGATE_STRICT_ENFORCEMENT=1`

## Incident

2026-08-02: ~$588 Apollo annual charge under soft warn-only gates. This plane fails closed.
