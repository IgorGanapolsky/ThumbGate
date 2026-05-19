---
"thumbgate": patch
---

Stop `/success` page views from inflating the conversion metric. The page was emitting `checkout_success_page_view` (the canonical conversion-funnel event the audit aggregates) on every GET — direct nav, bot crawls, monitoring probes, copy-pasted shared links. 2026-05-19 audit showed 6 successViews / 0 paid confirmations over 30 days, exactly because /success is publicly hittable and the metric was indistinguishable from noise.

Fix: only emit the canonical event when the URL carries `?session_id=cs_...` (the prefix Stripe uses on its post-payment redirect, covers both live and test mode) AND the requester is not classified as a bot. Unverified hits still emit telemetry under `checkout_success_page_view_unverified` so we keep observability for raw traffic — they just no longer inflate the conversion metric. Five tests pin the behavior across the four unverified cases (missing session_id, non-`cs_` prefix, bot UA, etc.) and the one verified case (human UA + `cs_live_` or `cs_test_`).
