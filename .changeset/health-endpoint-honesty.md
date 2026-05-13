---
"thumbgate": minor
---

`/health` and `/healthz` no longer return `status: 'ok'` unconditionally. Each endpoint now probes the relevant downstream subsystem and returns HTTP 503 + `status: 'degraded'` with a per-check breakdown when any probe fails. `/health` verifies feedback-dir writability, hosted-config app-origin, and build-metadata SHA presence. `/healthz` verifies feedback-log + memory-log directories are writable. Backward-compatible payload shape: existing fields preserved, `checks: {}` added. Uptime monitors now detect real service degradation instead of just process liveness.
