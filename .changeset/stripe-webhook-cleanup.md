---
"thumbgate": minor
---

Adds `scripts/stripe-webhook-cleanup.js` — deletes the 4 dirty webhook endpoints surfaced by `stripe-checkout-diagnostic` on 2026-05-19:

- 1 disabled duplicate of the canonical `thumbgate-production.up.railway.app/v1/billing/webhook`
- 3 disabled orphan endpoints on `rlhf-feedback-loop-*` URLs (legacy deployment that's been gone for months; one has 231 unsent events stacked up)

Goal: keep exactly ONE enabled webhook on the canonical URL.

Safety:
- Default mode is dry-run; `--apply` only writes when explicitly asked
- Idempotent — re-running after cleanup is a no-op
- Defense-in-depth: never deletes an enabled webhook unless it's a duplicate; never deletes a disabled endpoint with an unknown URL (leaves for review)
- Workflow auto-dry-runs on every push to the branch (visible plan before merge), writes only on explicit `workflow_dispatch` with `mode=apply`

10 unit tests cover: arg parsing, classification rules (enabled canonical, enabled duplicate, disabled canonical, orphan rlhf, unknown URL, enabled non-canonical), realistic scenario from the 2026-05-19 audit, apply-only-deletes-flagged, dry-run vs applied rendering.
