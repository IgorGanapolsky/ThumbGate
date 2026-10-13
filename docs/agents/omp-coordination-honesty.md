# omp coordination honesty

omp.sh is a terminal coding agent. ThumbGate keeps the checkout lease and checks a handoff before a second writer touches the tree. This page maps omp session, subagent, and collab behavior onto that lease. It does not install omp.

Sources: [sessions](https://omp.sh/docs/sessions), [subagents](https://omp.sh/docs/subagents), [collab](https://omp.sh/docs/collab).

## What moved onto the lease

| omp behavior | ThumbGate check |
| --- | --- |
| `/new` starts a saved session and leaves the previous one in place. `/clear` only resets context. | `session` must be `new`. |
| `/handoff` is current state and the next step. JSONL is the editable artifact. | `state` and `next` are required. |
| A child does not inherit the parent conversation. Default ownership is file-disjoint. Isolation is a worktree, not a security sandbox. | Overlapping write paths between owners fail. The parent integrates. |
| Collab's host stays authoritative. The default link is view-only. A full-control link is a bearer secret that can prompt and interrupt the host. | `share` is `view-only`. `host` is `local`. |
| Crash recovery continues completed entries and does not invent an interrupted tool result. | An interrupted entry with a result fails. |
| The route is a named `provider/model-id`. | `grok-4.7` or `provider/model-id`. Fast stays off. Agents stays one. Install stays none. |

Orchestra OMP is a different local daemon. This doctor does not call it.

## Check

```bash
npx thumbgate omp-coordination-honesty --json --map-only
npx thumbgate omp-coordination-honesty --json --handoff=handoff.md
npm run test:omp-coordination-honesty
```

Gate template: `refuse-omp-install-collab`. It matches the installer, `@oh-my-pi/pi-coding-agent`, `wss://my.omp.sh`, and `full-control collab`. A read of `https://omp.sh/docs/sessions` does not match.

Skill: `.agents/skills/omp-coordination-honesty-not-clone/SKILL.md`.
