---
"thumbgate": patch
---

Trust hardening of the published npm artifact. `verifyLicense()` now only considers `THUMBGATE_`-prefixed env vars as license candidates — it previously scanned every `*_API_KEY` / `*_PRO_KEY` env var, so an unrelated vendor's secret could be picked up as a license key — and its result object no longer carries the raw key value (callers only ever needed the boolean/source). The owner-email allowlist is no longer hardcoded in the shipped bundle: set `THUMBGATE_OWNER_EMAILS` (comma-separated) to classify owner traffic, matching the existing convention in `external-customer-audit`. The near-duplicate `scripts/bot-detector.js` is consolidated into `scripts/bot-detection.js`, which now also exports `classifyVisitor`, `shouldExcludeFromAnalytics`, and `botFilterMiddleware`, with the legacy crawler patterns merged into the unified `BOT_PATTERNS` list.
