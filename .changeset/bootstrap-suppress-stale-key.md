---
"thumbgate": patch
---

ops: SessionStart bootstrap suppresses 4-line 401 nag in stale-key state

The CEO called out tonight that every session resume shows the same multi-line `Hosted billing summary returned 401` / `operator key on this machine does not match` / `local operational billing summary is unavailable` Gaps block, even after I shipped `bin/revenue-truth.sh` (PR #2359) earlier. **PR #2359 shipped the wrapper at the wrong path** — the SessionStart hook calls `.claude/scripts/session-bootstrap/revenue-truth.sh`, not `bin/revenue-truth.sh`. Even if #2359 had merged, the bootstrap would still nag.

This PR fixes the actual file the hook calls. After running the canonical `scripts/revenue-status.js` pipeline, it detects the stale-key case (output contains `Source: local-fallback` or `Hosted summary working: no`) and:

1. Filters out the four noisy `Gaps:` lines that re-derive the 401 every session:
   - `- spawnSync gh ENOENT` (gh CLI absent — expected in cloud containers)
   - `- Hosted billing summary today returned 401`
   - `- Hosted billing summary rejected credentials (HTTP 401) …`
   - `- local operational billing summary is unavailable`

2. Replaces them with a single short paragraph: *"authenticated against LOCAL fallback (not hosted Railway summary). Numbers above are local lesson DB readings, not Stripe-reconciled hosted revenue. EXPECTED posture for any session that does not hold the rotated Railway operator key — not a blocker."* + the exact local-machine fix command (`node bin/cli.js billing:setup`) + a reminder NOT to paste the key into chat or argv (CLAUDE.md hard-block rule #2).

Happy-path output (key fresh, hosted summary authenticates) is unchanged — same full pipeline output as before.

Smoke test in this container (which is in the stale-key state by design) confirms the 4 noisy lines are gone and the replacement paragraph fires correctly. PR #2359 should be closed as superseded — the wrapper at `bin/revenue-truth.sh` was at the wrong path and the legacy bootstrap is the correct fix surface.
