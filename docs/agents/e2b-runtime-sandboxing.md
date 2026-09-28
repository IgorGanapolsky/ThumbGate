# E2B Runtime planes — compare, do not clone

Source: [e2b-dev/runtime](https://github.com/e2b-dev/runtime) (Apache-2.0). ThumbGate does not install that repo, the E2B SDK, Firecracker, or the embed compose stack.

## What moved onto the checkout lease

The control plane records who holds a checkout. The host still executes the command.

| E2B idea | ThumbGate rail |
| --- | --- |
| Routing record is owned by the executor. A stale lifecycle cannot delete a newer execution. | `scripts/session-lease.js` writes `executionId` on claim. Same-session refresh keeps it. Reclaiming a dead holder mints a new one. `release({ executionId })` returns `STALE_EXECUTION` and leaves the newer file in place, including when `force` is set. |
| Secrets are metadata on the control plane. The value does not cross the record. | A secret-shaped session identity is refused before the lease file is written (`SECRET_IN_CONTROL_PLANE`). `planes` reports the field name and does not print the value. |
| The coordinator does not carry the workload. | `planes` fails when `command` contains a shell payload (`DATA_PLANE_PAYLOAD`). |
| One writer. A newer epoch fences an older token. | `lease_epoch` increments when a dead holder is reclaimed. `verifyFencingToken` rejects any other token. |

```bash
node scripts/session-lease.js claim
node scripts/session-lease.js planes
node scripts/session-lease.js check
npm run test:session-lease
```

`planes` on an empty checkout prints a JSON object with `ok: true` and an empty `findings` list.

## Out of scope

- Firecracker, snapshot resume, and in-guest process supervision
- Docker Compose for E2B's embed stack
- Treating an E2B boot or fork figure as a ThumbGate measurement
- Copying `.git/thumbgate-session-lease.json` into a new worktree (the lease path already resolves that worktree's own git dir)
