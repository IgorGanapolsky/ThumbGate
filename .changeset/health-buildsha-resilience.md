---
"thumbgate": patch
---

fix(api): /health no longer kills the container over a missing buildSha

The /health endpoint previously returned HTTP 503 if any of three checks
failed — including a missing `BUILD_METADATA.buildSha`. Railway treats
503 as a healthcheck failure → sends SIGTERM → container exits →
restart-policy budget exhausts → outage.

This exact failure mode took prod down 2026-05-21 18:21Z → 19:30Z
(~70 min) after the THUMBGATE_BUILD_SHA env var was cleaned up earlier
in the day. A telemetry gap is not a service outage; the container still
serves requests fine when buildSha is empty.

Tiered failure classification:
- **service-failing** (feedback dir unwritable, hosted-config appOrigin
  missing) → HTTP 503 + status: 'failing'. Container should be replaced.
- **telemetry-degraded** (buildSha missing) → HTTP 200 + status: 'degraded'
  + `degraded: true` flag. Container stays alive; monitors see the gap.

Every check now carries a `severity` field so downstream monitors can
distinguish the two classes. Response shape is backwards-compatible
(adds `degraded` and `severity` fields; existing consumers ignore them).

Regression test pins the new behavior: a missing build-metadata file
must return 200 (not 503) and must set status='degraded'.
