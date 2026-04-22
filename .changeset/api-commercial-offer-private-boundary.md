---
"thumbgate": patch
---

fix(api): lazy-load commercial offer private boundary

Move the commercial-offer helpers used by the hosted billing checkout
path behind the private API module loader. The hosted runtime keeps the
same behavior when the module exists, while partially extracted or
public-shell deployments now fail with the standard
`PRIVATE_CORE_REQUIRED` contract instead of assuming commercial offer
logic is always bundled.

This pins the current split at the checkout boundary:

1. checkout attribution parsing now resolves plan/cycle/seat helpers
   through the private API module loader.
2. checkout offer summaries now resolve pricing constants through the
   private API module loader.
3. API regression coverage asserts that `/v1/billing/checkout` returns
   503 when the commercial-offer module is absent.
