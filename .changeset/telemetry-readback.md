---
"thumbgate": minor
---

Adds `scripts/telemetry-readback.js` — pulls our own `/v1/telemetry/export` endpoint with the operator key and outputs a funnel-stage markdown summary. Replaces our reliance on Plausible for read access.

Background: Plausible API returns **HTTP 402** ("This Plausible site is locked due to missing active subscription") on all 3 endpoints — verified via workflow run on 2026-05-18. Our own `/v1/telemetry/export` returns the same first-party events (page-views, CTA clicks, lead captures, funnel transitions) and is gated by `THUMBGATE_API_KEY`, which is in GH Actions secrets.

What the script produces:

- Top eventTypes (page_view, cta_click, lead_capture, etc.)
- Top CTAs (id @ placement) for the top 15
- Top utm_source for the top 10
- Top funnel stages for the top 15

Flags: `--since 7d` (or ISO timestamp), `--json`, `--output reports/funnel-snapshot.md`, `--app-origin`, `--limit`.

Workflow `.github/workflows/telemetry-readback.yml` runs daily at 13:00 UTC + supports `workflow_dispatch` with custom `since`. Prints markdown + a JSON dump for debugging. Five-minute timeout.

11 unit tests cover: arg parsing, relative-window parsing (`24h`, `7d`), aggregation by eventType / CTA / utm / funnel-stage, top-N ordering, markdown rendering with empty buckets, Authorization header passthrough, non-2xx error propagation. All passing.

Wired into `npm test` chain. This is the analytics-read path that does not require renewing Plausible.
