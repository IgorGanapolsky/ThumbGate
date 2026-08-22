---
"thumbgate": patch
---

fix(sentinel): resolve degenerate classifier circuit breaker, probe allowlist, and wire Hermes hosted routes

- Added MIN_HOLDOUT_ACCURACY (0.50) circuit breaker to intervention-policy. When holdout accuracy falls below chance level, predictions are disabled rather than issuing false deny verdicts (fixes #3595).
- Added isVersionOrProbeCommand allowlist in workflow-sentinel to immediately allow harmless discovery probes.
- Enhanced matchSelfProtectHardFloor in gates-engine to inspect redirection targets and check command token approvals.
- Mounted hosted HermesPlatformProtocol and HermesSyncPlane API routes on /v1/hermes/* in src/api/server.js and exported from src/index.js (fixes #3593).
- Added integration tests in tests/hermes-hosted-server.test.js.
