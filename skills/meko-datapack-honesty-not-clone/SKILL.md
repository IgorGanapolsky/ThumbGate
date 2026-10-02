---
name: meko-datapack-honesty-not-clone
description: >
  Meko Data (YugabyteDB 2026) is an agent data store, not a ThumbGate clone.
  Steal the five-plane FORMAT (datapack / memory / learning / artifact / trace)
  onto existing ThumbGate rails; never vendor YugabyteDB, meko-skills, or
  depend on cloud.mekodata.ai. Slash: /meko-datapack-honesty-not-clone.
---

# Meko Data — compare, do not clone

## Goal

Enforce fail-closed honesty for multi-agent systems: Datapacks provide 4-field
isolation, raw episodic memory never bypasses PreToolUse firewalls, memory
promotions require rubric gates, and artifacts are strictly content-addressed
by SHA-256 for attestation receipts.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Meko / install YugabyteDB / import `meko-skills` | Map planes onto existing ThumbGate rails |
| Rely on passive databases for agent safety | Enforce `PreToolUse` firewall on all tool executions |
| Promote memories to fleet rules without rubric validation | Require rubric score ≥ 0.70 and explicit operator feedback |
| Store unhashed or mutable artifacts | Content-address via deterministic SHA-256 |
| Send unredacted credentials to `cloud.mekodata.ai` | Local-first storage with client-side secret redaction |
| Omit four-field scope keys (`entity`, `project`, `process`, `session`) | Complete multi-tenant partition on all datapacks |

HARD fail closed. REFUSE third-party database SKUs.

## Reference

- https://cloud.mekodata.ai/signup | https://mekodata.ai | https://docs.mekodata.ai
- `scripts/meko-datapack-honesty.js`
- `docs/agents/meko-datapack-honesty.md`
- `tests/meko-datapack-honesty.test.js`

## Procedures

```bash
npx thumbgate meko-datapack-honesty --map-only
npx thumbgate meko-datapack-honesty --json
node --test tests/meko-datapack-honesty.test.js
```
