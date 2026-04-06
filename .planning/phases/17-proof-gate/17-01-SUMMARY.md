---
phase: 17
plan: 1
subsystem: proof-gate
tags: [proof, testing, billing, cli, health-endpoint, v3-milestone]
dependency_graph:
  requires: [Phase 13 deployment, Phase 14 billing, Phase 15 plugin-distribution, Phase 16 discovery]
  provides: [proof/v3-milestone-report.json, proof/v3-milestone-report.md, scripts/prove-v3-milestone.js]
  affects: []
tech_stack:
  added: []
  patterns: [proof-gate, execSync-test-runner, spawn-server-healthcheck]
key_files:
  created:
    - scripts/prove-v3-milestone.js
    - proof/v3-milestone-report.json
    - proof/v3-milestone-report.md
  modified: []
decisions:
  - THUMBGATE_ALLOW_INSECURE=true must not be set during npm test — it disables auth middleware and breaks the auth test suite
  - provisionApiKey returns { key, customerId, createdAt } not { apiKey, ... } — checked field name against actual billing.js return value
  - Test count parsing sums all ℹ pass N lines across multiple sub-scripts in the npm test pipeline
  - Server startup for PROOF-01 uses a non-standard port (13877) to avoid colliding with default 3000
metrics:
  duration_minutes: 12
  completed: 2026-03-04
  tasks_completed: 4
  files_created: 3
  files_modified: 0
---

# Phase 17 Plan 1: Proof Gate Summary

**One-liner:** v3 milestone proof script verifying Dockerfile+health, billing round-trip, CLI init, and 362-test suite — 7/7 checks PASS.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| PROOF-01 | Dockerfile + /health endpoint | ab90e04 | scripts/prove-v3-milestone.js |
| PROOF-02 | Billing module exports + key round-trip | ab90e04 | scripts/prove-v3-milestone.js |
| PROOF-03 | CLI init in tmpdir | ab90e04 | scripts/prove-v3-milestone.js |
| PROOF-04 | npm test >= 314 passing, 0 failures | ab90e04 | proof/v3-milestone-report.json, proof/v3-milestone-report.md |

## Check Results (from actual run)

| Check | Result | Detail |
|-------|--------|--------|
| PROOF-01a: Dockerfile exists | PASS | Dockerfile found |
| PROOF-01b: src/api/server.js exists | PASS | server.js found |
| PROOF-01c: /health returns 200 with version+uptime | PASS | HTTP 200, version=0.5.0, uptime=0.268s |
| PROOF-02a: billing.js exports 5 required functions | PASS | createCheckoutSession, provisionApiKey, validateApiKey, recordUsage, handleWebhook |
| PROOF-02b: provisionApiKey + validateApiKey round-trip | PASS | Key provisioned (rlhf_273b5d3b0...) and validated successfully |
| PROOF-03: cli init creates .thumbgate/ and config.json | PASS | .thumbgate/ created, config.json has keys: version, apiUrl, logPath, memoryPath, createdAt |
| PROOF-04: npm test >= 314 passing, 0 failures | PASS | 362 tests passed, 0 failures (threshold: 314+) |

**Overall: PASS (7/7)**

## Requirements Fulfilled

- PROOF-01: Dockerfile exists, /health returns 200 — COMPLETE
- PROOF-02: Billing exports verified, key provision+validate round-trip works — COMPLETE
- PROOF-03: CLI init creates .thumbgate/ and config.json in clean tmpdir — COMPLETE
- PROOF-04: 362 tests pass, 0 failures, exit code 0 — COMPLETE

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] THUMBGATE_ALLOW_INSECURE=true breaks auth test**
- Found during: PROOF-04 (first run)
- Issue: Setting THUMBGATE_ALLOW_INSECURE=true in the proof script's npm test env caused the API server under test to bypass auth middleware, making the `unauthorized without bearer token` test return 200 instead of 401
- Fix: Removed THUMBGATE_ALLOW_INSECURE from the npm test env; kept it only for the PROOF-01 health check server
- Files modified: scripts/prove-v3-milestone.js
- Commit: ab90e04 (included in final)

**2. [Rule 1 - Bug] Wrong field name for provisioned API key**
- Found during: PROOF-02b (first run)
- Issue: Code read `provisioned.apiKey` but `billing.provisionApiKey()` returns `{ key, customerId, createdAt }`
- Fix: Changed to `provisioned.apiKey || provisioned.key` (with fallback for robustness)
- Files modified: scripts/prove-v3-milestone.js
- Commit: ab90e04 (included in final)

## Self-Check: PASSED
- scripts/prove-v3-milestone.js: exists
- proof/v3-milestone-report.json: exists, overall=PASS
- proof/v3-milestone-report.md: exists
- Commit ab90e04: confirmed
