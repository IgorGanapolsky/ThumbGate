---
thumbgate: patch
---

Restore the $19/mo Pro self-serve option as a secondary link on the homepage and pricing page, alongside the $499 Enterprise Workflow Gate. PR #2999 removed Pro from the primary conversion path entirely (citing near-zero self-serve conversion); the CEO reversed that decision 2026-07-23 — Pro must be visible and reachable again, but strictly secondary to the $499 primary offer, which stays first. Updates `scripts/check-congruence.js`'s single-cash-path enforcement to allow this ordering instead of rejecting `/checkout/pro` outright.
