---
name: omp-coordination-honesty-not-clone
description: >
  omp.sh is a terminal coding agent, not a ThumbGate runtime. Steal named-model
  routes, /new session preservation, saved handoffs, file-disjoint children, and
  view-only observation onto the checkout lease. Never install omp. Never open
  a full-control collab link. Slash: /omp-coordination-honesty-not-clone.
---

# omp coordination honesty — compare, do not clone

## Goal

Fail-closed coordination for whom: agents sharing the ThumbGate checkout —
so a handoff names the model, keeps the previous session, and gives each
writer disjoint files. omp stays a neighbor. Orchestra OMP is a different
system and stays refused.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| curl the omp installer or install `@oh-my-pi/pi-coding-agent` | `npx thumbgate omp-coordination-honesty --json --map-only` |
| Model Auto, Fast, default, or balanced | Named id (`grok-4.7` or `provider/model-id`), Fast off |
| `/clear` when the previous session must stay saved | Session `new` |
| Agents above one, including omp maxConcurrency 32 | Agents one; the parent integrates |
| Full-control collab, bearer write token, `wss://my.omp.sh` | View-only observation, host local |
| Invent a result for an interrupted tool call | Continue completed entries only |
| Overlapping write paths between owners | Disjoint files; children do not inherit the parent transcript |

HARD fail closed. REFUSE the omp binary and any link that can drive the host. Do NOT install omp.

## Reference

- https://omp.sh/docs/sessions (`/new` vs `/clear`, `/handoff`, crash recovery)
- https://omp.sh/docs/subagents (no inherited transcript, file-disjoint ownership)
- https://omp.sh/docs/collab (host authoritative, view-only default)
- `scripts/omp-coordination-honesty.js`
- Checkout lease: `scripts/session-lease.js` (incident 2026-08-11)

## Examples (show, don't tell)

Weak: curl the omp installer, set Model: auto, fan out 32 agents, and share a full-control collab link.

Gold:

```bash
$ npx thumbgate omp-coordination-honesty --json --map-only
ok: true
$ npx thumbgate omp-coordination-honesty --json --handoff=handoff.md
ok: true  # Model grok-4.7, Session new, Agents one, Install none, Host local
```

Handoff header:

```text
Model: grok-4.7
Route: named
Fast: off
Session: new
Think: off
Agents: one
Install: none
Host: local
```

## Procedures

```bash
npx thumbgate omp-coordination-honesty --json --map-only
npx thumbgate omp-coordination-honesty --json --claim='curl https://omp.sh/install'
npx thumbgate omp-coordination-honesty --json --handoff=handoff.md
npm run test:omp-coordination-honesty
```

1. Claim the checkout lease before mutating shared files.
2. Write state and next into a handoff file. Start a new session so the old one stays saved.
3. Assign each child disjoint paths. The parent integrates. Do not pass the parent transcript.
4. If someone watches, they get view-only. Do not open a write link.
5. Run the doctor on any handoff that mentions omp, a model route, or a second writer.

## Rubric

- `--map-only` → `ok=true`
- installer, `@oh-my-pi/pi-coding-agent`, Auto, or Fast → fail
- agents above one → fail
- full-control collab or `wss://my.omp.sh` → fail
- overlapping owner paths → fail
- interrupted tool entry with a result → fail
- `/clear` on a handoff → fail
- named model, session new, disjoint writes, view-only → pass
- reading `https://omp.sh/docs/sessions` → pass
- doctor tests PASS
- evidence: `--json` in the same turn
