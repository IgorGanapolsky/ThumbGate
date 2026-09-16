---
name: wisdom-context-artifact-not-clone
description: >
  Steal Wisdom.ai / Soham Mazumdar episode FORMAT: context as a reusable agent
  artifact (goal, constraints, sources, freshness, verifier), plus an explicit
  wrong-fit gate. Do NOT clone ACE, Foundry, or Snowflake OSI. Slash:
  /wisdom-context-artifact-not-clone.
---

# Wisdom.ai FORMAT — artifact, not SKU

## Goal

Produce fail-closed agent-context packs for whom: ThumbGate agents assembling
lessons/RAG — so context is a reusable artifact (goal, constraints, sources,
freshness, verifier), consumer is `agent`, and wrongFit includes `wisdom_ai`.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Adaptive Context Engine / Foundry / OSI | `npx thumbgate agent-context-artifact --pack=` |
| consumer=human / analyst warehouse packs | `consumer: "agent"` |
| Tribal knowledge as "the context" | Tangible JSON artifact |
| Omit freshness or verifier | Checkable asOf + runnable verifier |
| Skip the wrong-fit question | `wrongFit` includes `wisdom_ai` |
| Dual-edit six-block auditor / ContextFS | Complement, don't replace |

## Reference

- https://www.wisdom.ai/
- https://music.youtube.com/watch?v=lRuI0imju0Y
- `scripts/agent-context-artifact.js`
- `/context-vault-six-blocks` · `/cobble-hot-store-compare-not-clone`

## Examples (show, don't tell)

Weak: "The semantic layer is in the warehouse; agents will figure it out."

Gold:

```bash
$ npx thumbgate agent-context-artifact --json --pack=tests/fixtures/agent-context-artifact-gold.json --now=2026-09-16T13:00:00Z
ok: true  consumer=agent  wrongFit includes wisdom_ai
```

## Procedures

```bash
npx thumbgate agent-context-artifact --json --pack=<pack.json>
npx thumbgate agent-context-artifact --clone-ace --json
npm run test:agent-context-artifact
```

1. Require consumer=agent.
2. Require goal, constraints, sources, freshness, verifier.
3. Fail stale asOf vs maxAgeHours.
4. Require wrongFit includes wisdom_ai.
5. Refuse ACE/Foundry/OSI clones.

## Rubric

- gold pack → `ok=true`
- human fixture → `ok=false`
- `--clone-ace` → `wisdom_clone_refused`
- doctor: `npm run test:agent-context-artifact` PASS
- evidence: command output in the same turn
