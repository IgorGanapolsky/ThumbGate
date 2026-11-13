---
"thumbgate": patch
---

Hydrate missing visitorId, sessionId, and acquisitionId from first-party journey cookies on `/v1/telemetry/ping` and `/v1/feedback/roast`, embed server-resolved identity defaults and dwell bucket telemetry on `/checkout/pro` and `/cancel`, scale 30d/90d bounded telemetry tail reads to 32 MB with explicit truncation metadata in billing `dataQuality`, and restore `COPY openapi/ ./openapi/` in `Dockerfile`.
