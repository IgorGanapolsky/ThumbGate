---
"thumbgate": minor
---

Rebuild `/pricing` as a dark-themed template page with analytics observability, Pro enforcement gates, and infrastructure-first positioning.

- **Analytics**: PostHog init + Plausible tagged-events on all 6 pricing CTAs for full click-through visibility.
- **Pro gates**: `checkLimit()` enforcement on lesson search, general search (GET+POST), and DPO export. Removed `PRO_MODE`/`NO_RATE_LIMIT` bypass env vars. Unexported `generateLicenseKey` to prevent license forging.
- **Positioning**: Pro card copy rewritten to emphasize hosted infrastructure (lesson sync, adapter matrix, dashboard) instead of fake feature gates. FAQ: "You're paying for infrastructure we run, not features we hide."
- **Template**: Replaced 84-line inline HTML block with `servePublicMarketingPage()` pattern matching all other marketing pages.
