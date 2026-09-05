# Vercel on ThumbGate (hobby) — not production

**Production is Railway** (`https://thumbgate-production.up.railway.app` / `thumbgate.ai`).

The Vercel project `thumbgate` under the hobby team `igorganapolskys-projects` used to auto-build every GitHub PR/push. On the free plan that hit **build rate limits** (`upgradeToPro=build-rate-limit`) and painted optional `Vercel` checks red/pending on PRs even when required CI was green.

## Durable posture (2026-09-05)

1. Repo `vercel.json` sets `"git": { "deploymentEnabled": false }` so Git pushes never start Vercel builds.
2. Project Ignored Build Step is also set to `exit 0` (skip all builds) as a belt-and-suspenders control.
3. `config/merge-quality-checks.json` already lists `Vercel` / `Vercel Preview Comments` as **optional** — Trunk must not wait on them.

Do **not** re-enable Git deployments without upgrading the Vercel plan **and** an explicit product decision that Vercel previews are worth the quota.
