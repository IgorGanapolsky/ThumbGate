---
"thumbgate": patch
---

Fix the Pro checkout interstitial by replacing the multi-offer paid-path page with one focused Pro confirmation path. The bot-safe `/checkout/pro` page now points visitors toward the $19/mo Pro checkout, a workflow-intake fallback, or a team inquiry without rendering the old $1, $19 quick-read, $99 teardown, $499 diagnostic, or $1500 sprint offers in the conversion path.
