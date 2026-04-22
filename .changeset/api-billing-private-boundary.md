---
'thumbgate': patch
---

fix(api): lazy-load billing private boundary

Move billing routes and funnel analytics behind the private API loader so billing summary, checkout, and webhook flows return the standard private-core contract when the hosted billing module is unavailable.
