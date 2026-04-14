---
"thumbgate": patch
---

Add automatic $pageview tracking and PostHog reverse proxy for ad-blocker bypass

- Added posthog.capture('$pageview') after init to track all landing page visits
- Added /ingest reverse proxy route in server.js to forward PostHog events through own domain
- Changed PostHog api_host from us.i.posthog.com to /ingest to bypass ad blockers
