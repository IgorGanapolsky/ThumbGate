---
"thumbgate": minor
---

Fix the revenue funnel narrative — three changes that stop the page from arguing against its own paid tier.

**Pro checkout interstitial (`/checkout/pro`)** — drop "MIT-licensed CLI included" and "MIT open source · no vendor lock-in" from the trust bar; they advertise the reason not to pay. Lead instead with what the subscription actually buys: hosted lesson sync across machines, adapter matrix for 7 agent runtimes, hosted dashboard, 24×7 ops.

**Pro card on `/` home page** — same fix at the top of the price column. The free npm package is local-only and never expires; Pro is the operated hosted state. Make that the first thing the visitor reads.

**npm postinstall banner** — add the hosted dashboard URL so installers know it exists, and replace "personal local dashboard, DPO export" with the hosted-state Pro value-prop. At ~5,000 installs/30d this is the highest-leverage surface we have for converting installs into site visits.

**Removed bare "$4,800/mo + $7,500 sprint" enterprise pricing** from the Regulated tier on the home page — keep it for the intake call instead of scaring retail buyers.

Motivation: external customer audit shows lifetime external revenue = $0 and 2,252 checkout sessions with 1 external completion (0.04%). MOAT.md openly states 212 of 216 Core scripts ship publicly. Until the page answers "why pay when npm install gives me everything," the funnel will keep producing this result.
