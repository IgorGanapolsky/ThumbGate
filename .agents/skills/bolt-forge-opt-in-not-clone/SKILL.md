---
name: bolt-forge-opt-in-not-clone
description: >
  Steal Bolt Forge FORMAT: explicit per-session opt-in, secret strip + seeded
  tests, operator vs research usage split, already-exported is irreversible.
  Do NOT clone Bolt Forge, send traces to Arcee, or claim 50x compute.
  Slash: /bolt-forge-opt-in-not-clone.
---

# Bolt Forge FORMAT — opt-in, don't clone

## Goal

Produce fail-closed session-export honesty for whom: ThumbGate agents about to
dump traces/DPO/feedback off-box — so operator/production stays DENY, research
writes only after per-session opt-in + irreversible ack + secret-redaction
seeded strip. Local files only.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Bolt Forge / upload to Arcee | `npx thumbgate session-export-gate` |
| Claim 50× compute as ours | Their preview numbers stay theirs |
| Export operator / PreToolUse / prod receipts | `--lane=research` only |
| Buried account toggle | `--opt-in-export` every session |
| Pretend exports can be untrained | `--i-understand-irreversible` |
| Invent a second SDS | `scripts/secret-redaction.js` + seeded test |

## Reference

- https://support.bolt.new/account-and-subscription/bolt-forge
- https://thenewstack.io/bolt-forge-training-data/
- `scripts/session-export-gate.js`
- `scripts/secret-redaction.js`
- `scripts/export-dpo-pairs.js` (research consumer, still gated)

## Examples (show, don't tell)

Weak: Turn on a global "share traces" flag and POST to a partner.

Gold:

```bash
$ npx thumbgate session-export-gate --json --lane=operator
ok: false  operator_lane_deny
$ npx thumbgate session-export-gate --json --lane=research \
    --opt-in-export --i-understand-irreversible --text='hi' --dest=/tmp/out.txt --apply
ok: true
```

## Procedures

```bash
npx thumbgate session-export-gate --json --lane=operator
npx thumbgate session-export-gate --json --lane=research --opt-in-export --i-understand-irreversible --input=t.txt --dest=out.txt --apply
npm run test:session-export-gate
```

1. Classify lane (operator DENY).
2. Require per-session opt-in + irreversible ack.
3. Run seeded strip (`api_key=` assignment plant) against `secret-redaction.js`.
4. Write local file only; append export log.
5. Refuse `--clone-bolt-forge` and remote dest.

## Rubric

- operator → `ok=false`
- research without flags → `ok=false`
- research + flags + local dest → `ok=true`, secret gone
- doctor: `npm run test:session-export-gate` PASS
- evidence: command output in the same turn
