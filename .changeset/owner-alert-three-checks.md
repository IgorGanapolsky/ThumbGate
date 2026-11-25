---
"thumbgate": patch
---

Owner alerts: an unreadable-source alert such as "Stripe could not be read" is emailed only when it is still failing on the third check in a row (checks run every 15 minutes), and the email says how long it has been failing. One slow Stripe answer no longer emails the owner. Red alerts still send on the first check.
