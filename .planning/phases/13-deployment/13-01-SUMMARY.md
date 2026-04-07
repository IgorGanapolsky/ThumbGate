---
phase: 13
plan: 01
subsystem: deployment
tags: [docker, railway, health-check, containerization, deployment-ready]
dependency_graph:
  requires: [phase-12-proof-gate]
  provides: [containerized-api, health-endpoint, railway-config]
  affects: [phase-14-billing, phase-15-plugin-distribution]
tech_stack:
  added: [Dockerfile (node:20-alpine multi-stage), railway.json, .dockerignore]
  patterns: [multi-stage-docker-build, non-root-container-user, unauthenticated-health-probe]
key_files:
  created:
    - Dockerfile
    - .dockerignore
    - railway.json
    - tests/deployment.test.js
  modified:
    - src/api/server.js
    - package.json
decisions:
  - "Health endpoint unauthenticated: /health bypasses API key check — required for Railway/load-balancer probes"
  - "Multi-stage Dockerfile: builder stage does npm ci --omit=dev, runtime copies only node_modules + source — smaller image"
  - "Non-root user: ThumbGate:ThumbGate user in container — security best practice"
  - "DEPLOY-02 deferred: actual Railway deployment requires account credentials — all assets are ready"
metrics:
  duration: "~15 min"
  completed: "2026-03-04T22:23:20Z"
  tasks_completed: 1
  files_created: 4
  files_modified: 2
  tests_added: 8
  tests_total: 322
requirements: [DEPLOY-01, DEPLOY-03, DEPLOY-04]
---

# Phase 13 Plan 01: Deployment — Container + Health Check Summary

**One-liner:** Multi-stage Dockerfile for Node 20 Alpine, unauthenticated /health endpoint with version+uptime, Railway config wired to /health — all verified locally with docker build + container smoke test.

## What Was Built

### 1. GET /health Endpoint (DEPLOY-03)

Added to `src/api/server.js` **before** the API key auth check so Railway health probes and load balancers can reach it without credentials.

```
GET /health → 200 OK
{
  "status": "ok",
  "version": "0.5.0",
  "uptime": 3.04
}
```

### 2. Dockerfile (DEPLOY-01)

Multi-stage build:
- **builder** stage: `node:20-alpine`, copies `package*.json`, runs `npm ci --omit=dev`
- **runtime** stage: copies node_modules from builder, copies `scripts/`, `src/`, `config/`, `adapters/`
- Non-root `ThumbGate:ThumbGate` user
- `/data` directory for runtime feedback logs
- `HEALTHCHECK` instruction points to `GET /health`
- `CMD ["node", "src/api/server.js"]`

### 3. .dockerignore

Excludes: `.git`, `node_modules`, `.planning`, `.agents`, `.claude/memory`, `.omx`, `.worktrees`, `tests/`, `proof/`, `docs/`, `.env*`, `*.log`

### 4. railway.json (DEPLOY-04)

```json
{
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "./Dockerfile" },
  "deploy": {
    "startCommand": "node src/api/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### 5. Deployment Tests (8 new tests)

`tests/deployment.test.js` covers:
- `/health` returns 200 without auth header
- Response body has `status: "ok"`
- Response body has `version` matching package.json
- Response body has numeric `uptime >= 0`
- Content-Type is `application/json`
- `PORT` env var wires correctly
- `THUMBGATE_ALLOW_INSECURE=true` bypasses API key
- Feedback endpoint responds under insecure mode

## Verification Evidence

### Docker Build

```
docker build -t thumbgate:latest .
#20 writing image sha256:77ef6a2bd4af1a28ac15b1e9d34883b04f0482abcc21c93c3125547d92c29f78 done
#20 naming to docker.io/library/thumbgate:latest done
```

Build result: **SUCCESS** — image built with no errors.

### Container Smoke Test

```bash
docker run -d --name ThumbGate-test -p 18787:8787 \
  -e THUMBGATE_ALLOW_INSECURE=true -e PORT=8787 \
  thumbgate:latest

curl http://localhost:18787/health
{"status":"ok","version":"0.5.0","uptime":3.04892471}
```

Result: **200 OK** — container starts, health endpoint responds.

### npm test (Full Suite)

```
Total tests: 322 (up from 314 baseline)
Pass: 322
Fail: 0
```

### Deployment Tests

```
✔ GET /health returns 200 without authentication
✔ GET /health returns status ok
✔ GET /health returns package version
✔ GET /health returns numeric uptime
✔ GET /health content-type is application/json
✔ PORT env var controls listen port
✔ THUMBGATE_ALLOW_INSECURE=true bypasses API key requirement
✔ feedback endpoint returns valid JSON under insecure mode
tests 8 | pass 8 | fail 0
```

## DEPLOY-02 Status: Deployment-Ready, Pending Railway Account

DEPLOY-02 requires actual Railway account credentials and a live deployment. All required assets are complete:
- Dockerfile builds and produces a working image
- railway.json is configured with correct build/deploy/healthcheck settings
- Environment variables are fully configurable (THUMBGATE_API_KEY, PORT, THUMBGATE_FEEDBACK_DIR, THUMBGATE_ALLOW_INSECURE)

To deploy: create Railway account, `railway login`, `railway init`, `railway up` — no code changes needed.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Description |
|------|-------------|
| e86f931 | feat(13-01): add /health endpoint, Dockerfile, railway.json, .dockerignore, deployment tests |

## Self-Check: PASSED

Files verified:
- Dockerfile: FOUND
- .dockerignore: FOUND
- railway.json: FOUND
- tests/deployment.test.js: FOUND
- src/api/server.js (modified): FOUND

Commit verified:
- e86f931: FOUND in git log
