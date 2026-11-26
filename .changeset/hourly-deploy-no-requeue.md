---
"thumbgate": patch
---

The hourly production deploy no longer re-uploads a commit that an earlier hourly run already sent to Railway in the last 3 hours, so a deploy that Railway holds in its queue isn't replaced by an identical copy.
