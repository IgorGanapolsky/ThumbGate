---
"thumbgate": patch
---

The status line's "Latest mistake" time is now in the reader's local time, 12-hour with AM/PM ("Nov 19, 3:37 PM"), instead of UTC 24-hour. Also ships the modules the owner console requires (`owner-telemetry.js`, `ops-log.js`, `ops-report.js`, `checkout-session-count.js`), which were missing from the npm package and blocked the 1.40.4 publish.
