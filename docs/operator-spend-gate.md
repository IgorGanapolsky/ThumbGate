# Operator spend gate (ERP-lite financial disaster prevention)

Hard-blocks **operator-money** tool intents unless the operator message explicitly
authorizes an exact USD amount in the **same message**.

## Incident
2026-08-02: Apollo Basic annual **$588** — thumbs-down alone only **warned**. Soft
lessons ≠ payment interlock.

## CLI
```bash
npx thumbgate spend-gate check --action "upgrade Apollo Basic" --message "continue"
# exit 1 BLOCK

npx thumbgate spend-gate check --action "buy credits $5" \
  --message "I authorize spend $5 on Apollo credits"
# exit 0 ALLOW

npx thumbgate spend-gate log --limit 20
```

## PreToolUse integration
`scripts/gates-engine.js` calls `evaluateOperatorSpendGate` early. Gate id
`operator-spend-gate` is on the **unconditional hard floor** (never warn-downgraded,
never free-tier daily-cap discounted).

Pass operator message via:
- `toolInput.operatorMessage` / `user_message` / `message`, or
- env `THUMBGATE_OPERATOR_MESSAGE` / `HERMES_OPERATOR_MESSAGE`

## Always allowed
refund · cancel plan · chargeback/dispute · remove credit card · read-only billing diagnose

## Ledger
`~/.thumbgate/spend-ledger/commitments.jsonl` (override `THUMBGATE_SPEND_LEDGER`)

## Related tags (first 👎 high-risk promote)
`never-spend`, `money-crisis`, `billing`, `operator-spend`, `payment`, `checkout`
