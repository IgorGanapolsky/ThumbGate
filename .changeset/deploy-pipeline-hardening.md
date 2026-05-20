---
"thumbgate": patch
---

Harden the Railway deploy pipeline against the failure mode that took prod down on 2026-05-20 ("Stopping Container" right after healthcheck passes; cascading retry exhaustion on a single replica). Four targeted changes:

**1. `railway.json` — give cold start room + tolerate transient failures + keep old container alive during swap**
- `healthcheckTimeout`: 30 → 300 (per-deploy grace; better-sqlite3 native load + Node boot routinely exceeds 30s)
- `restartPolicyMaxRetries`: 3 → 10 (3 healthcheck flaps was a hair-trigger for full service stop)
- Added `overlapSeconds: 30` (Railway keeps the old container serving traffic for 30s after the new one is healthy, eliminating the gap window that caused today's HTTP 502)

**2. `Dockerfile` HEALTHCHECK — align with actual startup time**
- `--start-period=10s --retries=3` → `--start-period=60s --retries=5`
- 10 seconds was below the observed cold-start of ~15-30s; healthcheck failed before the app was ready, marked unhealthy, killed.

**3. `.github/workflows/deploy-railway.yml` — queue deploys, don't guillotine them**
- `cancel-in-progress: true` → `cancel-in-progress: false`
- Today's cascade: 4a0a3bb0 push → deploy starts → f52ef0b6 push 17 min later cancels it mid-flight → 51f545cc push 4 sec after that cancels f52ef0b6 mid-flight. Net result: 3 deploys started, 0 completed cleanly, prod stuck between containers.

**4. `src/api/server.js` — graceful SIGTERM handler**
- Without a handler, Node exits immediately on SIGTERM; Railway may flag the container as crashed (vs gracefully stopped), wasting restart-budget on healthy shutdowns and dropping in-flight requests.
- Now drains HTTP connections for up to 25s before force-exit. Logs shutdown phase for debuggability.

Background sources:
- Railway docs: [Deployment Teardown](https://docs.railway.com/deployments/deployment-teardown), [Healthchecks](https://docs.railway.com/reference/healthchecks)
- Railway community: [Container terminates after healthcheck](https://station.railway.com/questions/container-terminates-after-successful-he-67400aaf), [SIGTERM after 60-65s](https://station.railway.com/questions/container-sigterm-after-60-65-seconds-de-1e20ea2f)
- Today's incident report: [Railway GCP suspension May 19 2026](https://blog.railway.com/p/incident-report-may-19-2026-gcp-account-outage)

Not included (separate follow-up PRs):
- Migrate Dockerfile base to `node:20-bookworm-slim` (drops the `python3 make g++` toolchain crutch + gets prebuilt better-sqlite3 binaries; ~50% build time cut). Higher-leverage but bigger blast radius.
- Move to build-once-in-CI + push-to-GHCR + Railway image-auto-update. Eliminates `railway up` rebuild flakiness entirely.
