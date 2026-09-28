---
name: e2b-runtime-planes-not-clone
description: >
  E2B Runtime is a Firecracker sandbox, not a ThumbGate product. Steal the
  execution-id fence and metadata-only control plane onto the checkout session
  lease. Never install e2b, Firecracker, or the embed compose stack.
  Slash: /e2b-runtime-planes-not-clone.
---

# E2B runtime planes — compare, do not clone

## Goal

Keep the checkout record on the control plane: who holds the tree, which
execution is current, and no secret value. The host still runs the command.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install `e2b`, Firecracker, or `docker compose` the embed stack | `node scripts/session-lease.js planes` |
| Quote an E2B boot, fork, or latency figure as a ThumbGate measurement | Release only the execution id this claim wrote |
| Store a token or a shell payload in the lease file | Refuse `SECRET_IN_CONTROL_PLANE` before the file is written |
| Copy a parent lease into a worktree | Let each worktree resolve its own `.git` lease path |

## Procedures

```bash
node scripts/session-lease.js claim
node scripts/session-lease.js planes
node scripts/session-lease.js check
npm run test:session-lease
```

A release that names an older `executionId` returns `STALE_EXECUTION` and leaves the newer lease on disk. `planes` on an empty checkout exits 0.

## Reference

- https://github.com/e2b-dev/runtime
- `scripts/session-lease.js`
- `docs/agents/e2b-runtime-sandboxing.md`
