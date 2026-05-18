---
"thumbgate": patch
---

Fix four install-flow bugs surfaced during a real customer walkthrough on 2026-05-18:

1. **`npx thumbgate pro` (no args) silently falls back to the info banner for creator-dev users** — the dashboard-launch predicate `if (resolvedKey && resolvedKey.key)` rejected the legitimate `{key:'', source:'creator-dev', plan:'enterprise'}` shape that `resolveProKey()` returns when `THUMBGATE_DEV_KEY` is unset. Predicate now also accepts `source === 'creator-dev'`, matching what `startLocalProDashboard` already supports.

2. **`init` silently deletes user-authored hooks whose command contains a shell variable.** `pruneStaleFileHooks` was treating `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh` as a literal filesystem path, so `fs.existsSync` returned false and the hook was removed with a misleading "Removed stale hook referencing missing file" warning even when the script existed. Added a bounded `$VAR` / `${VAR}` expander with quote stripping, and a fail-safe: if any `$` remains after expansion, skip pruning rather than risk destroying a valid hook.

3. **`isProTier()` ignored creator-dev installs**, so commands that DO consult it (upgradeNudge, rate gates) still nagged the maintainer on their own machine. Added an `isCreatorDev()` check.

4. **`proNudge` never consulted `isProTier` at all** — every `stats` / `lessons` / `summary` call printed the Pro upsell even for paid users. Now short-circuits on Pro tier (and transitively on creator-dev).

README Quick Start showed the bare positional `npx thumbgate capture "text"` form which actually errors `Missing or unrecognized --feedback=up|down` — replaced with the working `--feedback= --context=` form. Same correction in the CLI Reference section.

6 new regression tests in `tests/creator-dev-and-prune.test.js`. All 150 existing cli / hook / rate-limiter tests still pass.
