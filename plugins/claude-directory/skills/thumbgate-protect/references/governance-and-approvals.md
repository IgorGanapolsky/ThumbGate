# Branch governance & scoped approvals — reference

Detailed reference for the thumbgate-protect skill. Load only when granting an approval or
explaining the audit model.

## `get_branch_governance` MCP tool
Returns the project's protected-action posture:
- **protected branches** — branches where writes/force-push/merge are gated.
- **release rules** — publish/deploy constraints (e.g. no publish off `main`).
- **protected-file globs** — path patterns the agent cannot edit without an approval.

If it returns empty, governance is simply not configured — report that; do not invent rules.

## `approve_protected_action` MCP tool
Records a narrow, expiring exception under audit.

| Field | Required | Notes |
|-------|----------|-------|
| `pathGlobs` | yes | Smallest set of protected globs the action needs. Never `**` / blanket. |
| `reason` | yes | One sentence: why this is approved. |
| `evidence` | recommended | Supporting note — tests passing, owner sign-off, ticket link. |
| `ttlMs` | recommended | Expiry in ms. Default ~1h; use the shortest workable window (e.g. `900000` = 15 min). |

Returns an approval id, the covered globs, and the expiry timestamp.

## Audit model
- Approvals are **temporary and logged**. They do not change governance config; they grant a
  time-boxed pass that auto-expires.
- After expiry, protection resumes automatically — no cleanup step needed.
- One approval = one task. Re-run for the next one rather than widening TTL or globs.

## What this skill must never do
- Disable protection wholesale or edit governance config to "just turn it off".
- Grant standing/indefinite exceptions or `**` globs.
- Approve without an explicit user request to proceed.

Changing the governance posture itself (adding/removing protected branches) is a deliberate config
change via `set_branch_governance` — out of scope for this skill, which only reads posture and
grants narrow temporary passes.
