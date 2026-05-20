---
"thumbgate": patch
---

Improve Railway deploy reliability: fix deploy-scope false positive when BEFORE_SHA is unreachable in shallow clone, reduce health check window from 20 minutes to 6 minutes (matching Railway's 300s healthcheck timeout), simplify concurrency group, add explicit timeout to health verification step.
