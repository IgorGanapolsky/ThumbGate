---
"thumbgate": patch
---

Owner console: Unit economics tab and `/v1/admin/economics`. Measures the hosted container's CPU and memory and counts sent emails for free (`scripts/cost-meter.js`), prices them with a sourced rate card (`config/unit-costs.json`), and shows delivery cost per active install and per paying customer, contribution per plan, a payment-to-access check, and time to first value (first real gate block after install). Adds `docs/ops/decision-log.md`.
