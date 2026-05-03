# Self-Serve Close Pack

Updated: 2026-05-03T01:41:56.308Z

This pack isolates the evidence-backed self-serve close lane from the broader revenue loop so an operator can work the guide-to-Pro motion without digging through warm discovery or sprint-first rows.

Use `operator-priority-handoff.md` for the full ranked queue and `gtm-marketplace-copy.md` for broader listing language. This pack is the focused conversion layer for current self-serve buyers.

## Current Snapshot
- Revenue state: post-first-dollar
- Billing verification: Live hosted billing summary verified for this run.
- Self-serve closes ready now: 3
- Checkout starts: 1

## Self-Serve Rules
- Lead with the proof-backed setup guide first.
- Use Pro after one blocked repeat or explicit self-serve install intent. Use the Workflow Hardening Sprint when one workflow owner needs approval boundaries, rollback safety, and proof before wider rollout.
- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.

```bash
npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json
```

## Close Now: Self-Serve Pro
## 1. @bherald — personal-life-os-core
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_bherald_personal_life_os_core
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_bherald_personal_life_os_core' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Contact surface: https://wphc.us/
- Contact surfaces: Website: https://wphc.us/; GitHub profile: https://github.com/bherald; Repository: https://github.com/bherald/personal-life-os-core
- Company: n/a
- Evidence score: 14
- Evidence: workflow control surface, production or platform workflow, agent infrastructure, self-serve agent tooling, updated in the last 7 days
- Motion: Pro at $19/mo or $149/yr
- Why now: Target looks like a self-serve tooling surface, so Pro is the cleaner CTA unless a concrete workflow pain is confirmed.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide

First-touch draft:
> Hey @bherald, saw you're building around `personal-life-os-core`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

Pain-confirmed follow-up:
> If you want the self-serve path for `personal-life-os-core`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want the self-serve path for `personal-life-os-core`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro

Checkout close draft:
> If you are already comparing close options for `personal-life-os-core`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 2. @zaxbysauce — opencode-swarm
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_zaxbysauce_opencode_swarm
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Contact surface: https://github.com/zaxbysauce
- Contact surfaces: GitHub profile: https://github.com/zaxbysauce; Repository: https://github.com/zaxbysauce/opencode-swarm
- Company: n/a
- Evidence score: 12
- Evidence: workflow control surface, self-serve agent tooling, 290 GitHub stars, updated in the last 7 days
- Motion: Pro at $19/mo or $149/yr
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide

First-touch draft:
> Hey @zaxbysauce, saw you're building around `opencode-swarm`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

Pain-confirmed follow-up:
> If you want the self-serve path for `opencode-swarm`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want the self-serve path for `opencode-swarm`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro

Checkout close draft:
> If you are already comparing close options for `opencode-swarm`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 3. @iliaal — whetstone
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_iliaal_whetstone
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_iliaal_whetstone' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Contact surface: http://ilia.ws/
- Contact surfaces: Website: http://ilia.ws/; GitHub profile: https://github.com/iliaal; Repository: https://github.com/iliaal/whetstone
- Company: n/a
- Evidence score: 12
- Evidence: workflow control surface, agent infrastructure, self-serve agent tooling, 11 GitHub stars, updated in the last 7 days
- Motion: Pro at $19/mo or $149/yr
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide

First-touch draft:
> Hey @iliaal, saw you're building around `whetstone`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

Pain-confirmed follow-up:
> If you want the self-serve path for `whetstone`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want the self-serve path for `whetstone`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro

Checkout close draft:
> If you are already comparing close options for `whetstone`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
