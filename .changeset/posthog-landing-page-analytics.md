---
'thumbgate': patch
---

Wire PostHog analytics into the landing page for funnel visibility. Tracks four CTA events: workflow_sprint, install_codex, install_claude, and pro_upgrade. API key is now server-injected via the __POSTHOG_API_KEY__ placeholder in hostedConfig, not hardcoded in the HTML.