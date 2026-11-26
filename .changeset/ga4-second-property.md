---
"thumbgate": patch
---

The Google tag the server adds to the marketing pages now also configures a second Google Analytics 4 property (G-QKENZBW1V8), so page views and the existing begin_checkout event reach both properties through one loader. It stays behind the Global Privacy Control and Do Not Track suppression. `THUMBGATE_GA_EXTRA_MEASUREMENT_ID` replaces the id; the value `off` removes it.
