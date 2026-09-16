# Session-export gate (Bolt Forge FORMAT steal)

Doctor: `npx thumbgate session-export-gate --json`

Steals **per-session opt-in, secret strip + seeded tests, operator vs research split, already-exported is irreversible** from [Bolt Forge](https://support.bolt.new/account-and-subscription/bolt-forge) and [The New Stack](https://thenewstack.io/bolt-forge-training-data/). Compare-not-clone. Not affiliated with Bolt.new, StackBlitz, or Arcee AI.

Bolt's **50× usage** is **theirs**. Do not quote it as a ThumbGate measurement. Do not send traces to Arcee.

## Map

| Bolt analog | ThumbGate |
|-------------|-----------|
| Consent each time you switch into Forge | `--opt-in-export` per invocation |
| Anonymize + seed-test the strip | `secret-redaction.js` + planted `api_key=` seed |
| Standard/Max vs Forge | `--lane=operator` DENY / `--lane=research` gated |
| Teams/Enterprise excluded | operator/production receipts never export |
| Leaving Forge doesn't untrain | export JSONL + `irreversible: true` |

## Fail closed

`operator_lane_deny` · `missing_opt_in` · `missing_irreversible_ack` · `remote_dest_refused` · `seeded_strip_failed` · `secrets_remain` · `bolt_forge_clone_refused`

## CLI

```bash
npx thumbgate session-export-gate --json --lane=operator
npx thumbgate session-export-gate --json --lane=research --opt-in-export --i-understand-irreversible --text=hi --dest=/tmp/tg-export.txt --apply
npm run test:session-export-gate
```

Skill: `.agents/skills/bolt-forge-opt-in-not-clone/SKILL.md`
