---
"thumbgate": patch
---

Fix the broken "90-second demo" link from the README + tiny repo cleanup.

**Problem:** `README.md` line 39 advertises `[▶ Watch the 90-second demo](https://thumbgate-production.up.railway.app/#demo?...)`. The home page had no element with `id="demo"`, so browsers landed at the top of the home page instead of jumping to the demo section. The README link looked broken to anyone reading it on GitHub.

**Fix:**
1. Add `id="demo"` to the "See It In Action" section on the home page (preserves the existing `id="social-proof"` anchor via a sibling `<a>` so nothing else breaks).
2. Add a visible **▶ Watch the 90-second demo** button in the hero `.hero-actions` block pointing at `#demo`, with PostHog + first-party telemetry on click. This gives on-page visitors the same affordance the README has promised.

**Tiny cleanup:**
- `DISTRIBUTION_RUNBOOK.md` → `docs/DISTRIBUTION_RUNBOOK.md` (0 inbound references)
- `RAILWAY_BILLING_SETUP.md` → `docs/ops/RAILWAY_BILLING_SETUP.md` (0 inbound references)

Files with active inbound references (`LAUNCH.md`, `LAUNCH_NOW.md`, `LAUNCH_POSTS.md`, `FIRST_CUSTOMER_BATTLE_PLAN.md`, `MOAT.md`, `SKILL.md`, `primer.md`, `WORKFLOW.md`, `gate-program.md`) intentionally stay at root for this PR — moving them would require touching pinned test paths and is deferred.
