---
"thumbgate": patch
---

fix(pricing): correct stale $99/seat Team price in .well-known/llms.txt and extend parity guard

AI crawlers reading `.well-known/llms.txt` were being served the retired `$99/seat/mo` Team anchor. The canonical anchor per `docs/COMMERCIAL_TRUTH.md` has been `$49/seat/mo with a 3-seat minimum` since mid-April 2026; every HTML surface, server-side constant (`TEAM_MONTHLY_PRICE_DOLLARS`), and README already uses $49. The llms.txt leak was the last unguarded public surface.

Also extends `tests/public-package-parity.test.js` to scan `.well-known/` text surfaces in addition to HTML, so this class of leak is caught in CI next time.
