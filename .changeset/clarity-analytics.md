---
"thumbgate": patch
---

Microsoft Clarity heatmaps and masked session replay on public thumbgate.ai pages (never on admin, dashboard, sign-in, checkout, billing or success pages, never for GPC/DNT visitors, advertising storage always denied, cookieless for European time zones). The owner console gains a Visitor behavior tab that reads Clarity's Data Export API once `THUMBGATE_CLARITY_API_TOKEN` is set, cached on disk to stay inside the 10-calls-a-day limit.
