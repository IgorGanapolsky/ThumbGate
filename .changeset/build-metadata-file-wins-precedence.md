---
"thumbgate": patch
---

Fix `/health` reporting the wrong `buildSha` when a stale `THUMBGATE_BUILD_SHA` env var lingers on the runtime host. Invert precedence in `scripts/build-metadata.js`: the immutable JSON file baked into the Docker image at build time (which always matches the deployed code) now wins over mutable runtime env vars. Env vars fill in only when the file has no SHA.

Also tightens the env-branch condition: previously a stray `THUMBGATE_BUILD_GENERATED_AT` with no SHA would short-circuit to `{ buildSha: null }`, losing both signals. Now the env branch requires an explicit SHA before being trusted.

Background: 2026-05-20 — prod `/health` reported `version=1.21.2` but `buildSha=92f8e4b1` (a commit from days earlier). Root cause: the `Set Railway environment variables` step is gated by `RAILWAY_SYNC_VARIABLES=false` by default, so a once-set `THUMBGATE_BUILD_SHA` on Railway was never refreshed by subsequent deploys. The freshly-stamped `config/build-metadata.json` baked into the image had the correct SHA, but the env-wins precedence caused `resolveBuildMetadata` to return the stale env value instead.

Side benefit: the `Verify deployment health` step in `.github/workflows/deploy-railway.yml` compares `LIVE_SHA` to `$GITHUB_SHA`; with this fix, that comparison now succeeds against the freshly-baked file SHA, unblocking the gate.

Operator note: the persistent `THUMBGATE_BUILD_SHA` and `THUMBGATE_BUILD_GENERATED_AT` env vars on the Railway service can now be safely deleted from the dashboard — file precedence makes them moot.
