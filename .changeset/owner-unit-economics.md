---
"thumbgate": patch
---

Cost meter and unit-economics arithmetic for the owner console: `scripts/cost-meter.js` measures the hosted container's CPU and memory and counts sent emails for free, `config/unit-costs.json` holds the sourced Railway, Resend and Stripe rates, and `scripts/unit-economics.js` turns them into delivery cost per active install and per paying customer and contribution per plan. The console tab follows in the next PR.
