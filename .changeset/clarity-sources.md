---
"thumbgate": patch
---

Microsoft Clarity now records a `checkout_click` event when a visitor clicks a Pro checkout link, and the site no longer guesses analytics-cookie consent from the browser's time zone: it sends no consent signal and leaves Clarity's own Consent Mode in charge for visitors in the EEA, UK and Switzerland. The owner console gains a Sources tab (`/v1/admin/sources`) with one tile per source (Plausible, Google Analytics, Clarity) and the funnel (visitor, install, first block, Pro checkout click): the last event time, or "no data yet" where there is none.
