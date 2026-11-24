# Decision log

One entry per business or operating decision that should change how ThumbGate is run. Each entry follows the same five
steps, so a later reader can tell what was seen, what was believed, what was done, what happened, and which rule changed.

- **Observation:** what was measured, with the source (a console field, a Stripe report, a command's output).
- **Explanation:** what we think causes it. Mark it as a guess until a result supports it.
- **Intervention:** what was changed, with the commit, PR or setting.
- **Result:** what the same measurement showed afterwards, and when. Leave it as `pending` until it is measured.
- **Revised rule:** the rule we keep going forward, or `none` if the result did not support a change.

A score, grade or "looks good" from an agent is not evidence. Every Observation and Result names a check anyone can rerun.

Add new entries at the top. Keep each one short.

---

## 2026-11-24 · Measure what delivering ThumbGate costs before changing prices

- **Observation:** The owner console showed revenue, MRR, churn and installs, but no cost. Railway's metrics for the
  `thumbgate` service over the 7 days to 2026-11-24 averaged 0.0068 vCPU and 1.11 GB of memory (peak 7.9 GB), 0.27 GB
  of volume and about 0.01 GB of egress per hour. At Railway's list rates ($20 per vCPU-month, $10 per GB-month of
  memory, $0.15 per GB-month of volume, $0.05 per GB of egress) that is about $11.7 a month, and memory is about 95% of it.
- **Explanation:** Hosting cost is driven by memory held, not CPU. The 7.9 GB peak is likely the billing-summary child
  process or a large telemetry read; this is a guess until the cost meter shows which days spike.
- **Intervention:** Added the cost meter (`scripts/cost-meter.js`), the rate card (`config/unit-costs.json`), and the
  Unit economics tab and `/v1/admin/economics` (`scripts/unit-economics.js`): delivery cost per active install and per
  paying customer, contribution per plan, a payment-to-access check, and time to first value.
- **Result:** pending. Read `/v1/admin/economics` after 30 days of samples (2026-12-24).
- **Revised rule:** Any pricing change cites `/v1/admin/economics` (contribution per plan and cost per install), not a
  benchmark from another company.

## 2026-11-24 · Keep flat Pro pricing; do not add metered billing yet

- **Observation:** Pro is $19 a month. Gates run locally on the customer's machine, so a heavy user costs ThumbGate
  about the same to serve as a light one: the hosted cost is shared and measured above.
- **Explanation:** Usage-based pricing protects margin when each unit of use costs the seller money (model inference).
  ThumbGate does not pay for its users' inference, so metering would add billing risk and bill anxiety without
  protecting margin.
- **Intervention:** None to live prices. The recommendation and its numbers are in the project's `finops/` folder.
- **Result:** pending. Revisit if the cost per active install rises above $1 a month, or if a hosted feature that costs
  money per call (for example hosted model calls) ships.
- **Revised rule:** Meter only what costs ThumbGate money per use. Price everything else flat.
