---
'thumbgate': minor
---

Surface per-slug `/go/:slug` hits, checkout starts, and conversion rate on the
dashboard telemetry feed. `getTelemetryAnalytics` now exposes a `trackedLinks`
panel (`totalHits`, `totalCheckoutStarts`, `overallConversionRate`,
`bySlug.<slug>.{hits,checkoutStarts,conversionRate}`, `topSlug`) so the
`/v1/dashboard` API and `/dashboard` UI can show which tracked links actually
drive checkouts. CLI telemetry is excluded from the rollup (web-only).
