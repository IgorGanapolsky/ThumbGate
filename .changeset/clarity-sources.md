---
"thumbgate": patch
---

The public marketing pages that carry the Plausible script now also load a Microsoft Clarity loader (`/js/clarity.js`, project zjaflwztgq) that records sessions and heatmaps, masks every form field, and sends a `checkout_click` event when a visitor clicks a Pro checkout link. It stays off when the browser sends Global Privacy Control or Do Not Track, and it is never loaded on the owner console, dashboard, lessons or onboarding. The owner console gains a Sources tab (`/v1/admin/sources`) with one tile per source: the last event time, or "no data yet" where there is none.
