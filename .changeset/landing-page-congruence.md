---
thumbgate: patch
---

Landing page congruence fixes and dashboard deep-linking:

- Remove misleading "1 agent" Free tier bullet (no per-agent enforcement exists in rate-limiter)
- Rephrase Free tier bullets to match actual code behavior (1 auto-promoted prevention rule, built-in safety gates)
- Add hash-based deep-linking to dashboard: `/dashboard#insights`, `/dashboard#gates`, `/dashboard#export` now auto-switch tabs
- "Visual gate debugger" link on Pro tier now deep-links to `#insights` (was pointing to root `/dashboard`)
- "DPO training data export" link on Pro tier now deep-links to `#export`
- Add `public/dashboard.html`, `scripts/prompt-eval.js`, `bench/prompt-eval-suite.json`, `CHANGELOG.md` to npm files whitelist — these were missing, breaking the dashboard for users running `npx thumbgate pro`
- New tests: 19 landing-page-claims (code-backed claim audit), 3 dashboard-deeplink-e2e (real server + HTTP fetch + hash validation)
