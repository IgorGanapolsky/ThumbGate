# Revenue Operator Priority Handoff

Updated: 2026-04-28T08:13:24.560Z

This is the ranked send order for the current zero-to-one revenue loop. Work warm discovery targets first, then expand into cold GitHub targets with the same proof discipline.

This handoff sits on top of `gtm-revenue-loop.md`, `gtm-target-queue.csv`, and `team-outreach-messages.md` so an operator can decide who to contact next without re-ranking the queue manually.

## Current Snapshot
- Revenue state: post-first-dollar
- Headline: Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.
- Paid orders: 2
- Checkout starts: 1
- Active follow-ups: 0
- Warm targets ready now: 4
- Cold GitHub targets ready next: 12

## Operator Rules
- Import the queue into the sales ledger before sending anything.
- Lead with one concrete workflow-hardening offer, not generic Pro and not the proof pack.
- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.

```bash
npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json
```

## Follow Up Now
- No in-flight follow-ups are currently tracked.

## Send Now: Warm Discovery
## 1. @Deep_Ad1959 — r/cursor
- Temperature: warm
- Source: reddit / reddit_dm
- Pipeline stage: targeted
- Pipeline lead id: reddit_deep_ad1959_r_cursor
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on rollback risk.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around rollback risk.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for rollback risk.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for rollback risk.'`
- Contact surface: https://www.reddit.com/user/Deep_Ad1959/
- Contact surfaces: n/a
- Company: n/a
- Evidence score: 10
- Evidence: warm inbound engagement, workflow pain named: rollback risk, already in DMs
- Motion: Workflow Hardening Sprint
- Why now: Warm Reddit engager already named a repeated workflow risk, so the fastest path is a founder-led diagnostic.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Your question about rollback rates when context changes is exactly the right one. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have one workflow where context drift or rollback risk keeps showing up, I can harden that workflow for you. Worth a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 2. @game-of-kton — r/cursor
- Temperature: warm
- Source: reddit / reddit_dm
- Pipeline stage: targeted
- Pipeline lead id: reddit_game_of_kton_r_cursor
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on stale context and conflicting facts.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around stale context and conflicting facts.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for stale context and conflicting facts.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for stale context and conflicting facts.'`
- Contact surface: https://www.reddit.com/user/game-of-kton/
- Contact surfaces: n/a
- Company: n/a
- Evidence score: 9
- Evidence: warm inbound engagement, built serious memory systems, workflow pain named: stale context and conflicting facts
- Motion: Workflow Hardening Sprint
- Why now: Warm Reddit engager already works on advanced agent memory, so discovery should center on one repeated failure pattern.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Your ACT-R engram work is fascinating, especially the conflict resolution for opposing facts and the decay model. I am looking for one serious AI-agent workflow to harden end-to-end this week. If your memory system has one recurring failure mode such as stale context, opposing facts, bad handoffs, or unsafe tool calls, I can turn that into a prevention rule and proof run. Open to a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 3. @leogodin217 — r/ClaudeCode
- Temperature: warm
- Source: reddit / reddit_dm
- Pipeline stage: targeted
- Pipeline lead id: reddit_leogodin217_r_claudecode
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on review boundaries and context risk.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around review boundaries and context risk.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for review boundaries and context risk.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for review boundaries and context risk.'`
- Contact surface: https://www.reddit.com/user/leogodin217/
- Contact surfaces: n/a
- Company: n/a
- Evidence score: 9
- Evidence: warm inbound engagement, mature multi-step workflow described, workflow pain named: review boundaries and context risk
- Motion: Workflow Hardening Sprint
- Why now: Warm Reddit engager already described a mature workflow, so the next step is a targeted diagnostic on one failure mode.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Your arch-create to sprint workflow is one of the most mature agent processes I have seen anyone describe. I am looking for one AI-agent workflow to harden end-to-end this week. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeating failure and I will help turn it into an enforceable Pre-Action Check plus proof run. Worth 15 minutes?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 4. @Enthu-Cutlet-1337 — r/ClaudeCode
- Temperature: warm
- Source: reddit / reddit_dm
- Pipeline stage: targeted
- Pipeline lead id: reddit_enthu_cutlet_1337_r_claudecode
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on brittle guardrails.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around brittle guardrails.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for brittle guardrails.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for brittle guardrails.'`
- Contact surface: https://www.reddit.com/user/Enthu-Cutlet-1337/
- Contact surfaces: n/a
- Company: n/a
- Evidence score: 8
- Evidence: warm inbound engagement, responded to adaptive-gate positioning, workflow pain named: brittle guardrails
- Motion: Workflow Hardening Sprint
- Why now: Warm Reddit engager already understands the adaptive-gate thesis, so offer one concrete workflow hardening diagnostic.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Appreciate the kind words on the Thompson Sampling approach. You nailed the core insight: most guardrails are brittle prompt hacks that break when context shifts. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have a workflow where brittle guardrails keep failing, I can harden that workflow with you. Open to a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Seed Next: Cold GitHub
## 5. @montenegronyc — backporcher
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_montenegronyc_backporcher
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_montenegronyc_backporcher' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_montenegronyc_backporcher' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_montenegronyc_backporcher' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_montenegronyc_backporcher' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://numberfortyeight.co/
- Contact surfaces: Website: https://numberfortyeight.co/; GitHub profile: https://github.com/montenegronyc; Repository: https://github.com/montenegronyc/backporcher
- Company: Number Fortyeight Inc.
- Evidence score: 16
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, 12 GitHub stars, updated in the last 30 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @montenegronyc, saw you're shipping `backporcher`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `backporcher` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 6. @Adqui9608 — ai-code-review-agent
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_adqui9608_ai_code_review_agent
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/Adqui9608
- Contact surfaces: GitHub profile: https://github.com/Adqui9608; Repository: https://github.com/Adqui9608/ai-code-review-agent
- Company: n/a
- Evidence score: 15
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @Adqui9608, saw you're shipping `ai-code-review-agent`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `ai-code-review-agent` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 7. @DGouron — review-flow
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_dgouron_review_flow
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://dgouron.fr/
- Contact surfaces: Website: https://dgouron.fr/; GitHub profile: https://github.com/DGouron; Repository: https://github.com/DGouron/review-flow
- Company: Mentor Goal
- Evidence score: 14
- Evidence: workflow control surface, business-system integration, agent infrastructure, 36 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @DGouron, saw you're shipping `review-flow`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `review-flow` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 8. @nihannihu — Omni-SRE
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_nihannihu_omni_sre
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/nihannihu
- Contact surfaces: GitHub profile: https://github.com/nihannihu; Repository: https://github.com/nihannihu/Omni-SRE
- Company: @Omni-IDE
- Evidence score: 14
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 30 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @nihannihu, saw you're shipping `Omni-SRE`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `Omni-SRE` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 9. @Somak-2001 — Automatic-Code-Reviewer
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_somak_2001_automatic_code_reviewer
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_somak_2001_automatic_code_reviewer' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_somak_2001_automatic_code_reviewer' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_somak_2001_automatic_code_reviewer' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_somak_2001_automatic_code_reviewer' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/Somak-2001
- Contact surfaces: GitHub profile: https://github.com/Somak-2001; Repository: https://github.com/Somak-2001/Automatic-Code-Reviewer
- Company: n/a
- Evidence score: 14
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 30 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @Somak-2001, saw you're shipping `Automatic-Code-Reviewer`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `Automatic-Code-Reviewer` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 10. @nrikike — ai-council-reviewer
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_nrikike_ai_council_reviewer
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_nrikike_ai_council_reviewer' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_nrikike_ai_council_reviewer' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_nrikike_ai_council_reviewer' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_nrikike_ai_council_reviewer' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/nrikike
- Contact surfaces: GitHub profile: https://github.com/nrikike; Repository: https://github.com/nrikike/ai-council-reviewer
- Company: n/a
- Evidence score: 14
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 30 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @nrikike, saw you're shipping `ai-council-reviewer`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `ai-council-reviewer` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 11. @manki-review — manki
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_manki_review_manki
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_manki_review_manki' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_manki_review_manki' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_manki_review_manki' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_manki_review_manki' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://manki.dustinface.me/
- Contact surfaces: Website: https://manki.dustinface.me/; GitHub profile: https://github.com/manki-review; Repository: https://github.com/manki-review/manki
- Company: n/a
- Evidence score: 13
- Evidence: workflow control surface, business-system integration, agent infrastructure, 5 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @manki-review, saw you're shipping `manki`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `manki` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 12. @agynio — gh-pr-review
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_agynio_gh_pr_review
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_agynio_gh_pr_review' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_agynio_gh_pr_review' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_agynio_gh_pr_review' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_agynio_gh_pr_review' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://agyn.io/
- Contact surfaces: Website: https://agyn.io/; GitHub profile: https://github.com/agynio; Repository: https://github.com/agynio/gh-pr-review
- Company: n/a
- Evidence score: 13
- Evidence: workflow control surface, business-system integration, 139 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @agynio, saw you're shipping `gh-pr-review`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `gh-pr-review` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 13. @freema — mcp-jira-stdio
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_freema_mcp_jira_stdio
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: http://www.tomasgrasl.cz/
- Contact surfaces: Website: http://www.tomasgrasl.cz/; GitHub profile: https://github.com/freema; Repository: https://github.com/freema/mcp-jira-stdio
- Company: n/a
- Evidence score: 13
- Evidence: workflow control surface, business-system integration, agent infrastructure, 11 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @freema, saw you're shipping `mcp-jira-stdio`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `mcp-jira-stdio` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 14. @ronjohnsonjr — agentic-engineering-pipeline
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_ronjohnsonjr_agentic_engineering_pipeline
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_ronjohnsonjr_agentic_engineering_pipeline' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_ronjohnsonjr_agentic_engineering_pipeline' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_ronjohnsonjr_agentic_engineering_pipeline' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_ronjohnsonjr_agentic_engineering_pipeline' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/ronjohnsonjr
- Contact surfaces: GitHub profile: https://github.com/ronjohnsonjr; Repository: https://github.com/ronjohnsonjr/agentic-engineering-pipeline
- Company: n/a
- Evidence score: 13
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @ronjohnsonjr, saw you're shipping `agentic-engineering-pipeline`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `agentic-engineering-pipeline` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 15. @oliver-kriska — claude-elixir-phoenix
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_oliver_kriska_claude_elixir_phoenix
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Contact surface: https://github.com/oliver-kriska
- Contact surfaces: GitHub profile: https://github.com/oliver-kriska; Repository: https://github.com/oliver-kriska/claude-elixir-phoenix
- Company: n/a
- Evidence score: 12
- Evidence: workflow control surface, agent infrastructure, 290 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with context-drift hardening for one workflow before proposing any broader agent platform story.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @oliver-kriska, saw you're shipping `claude-elixir-phoenix`. If one context, memory, or tool-use failure keeps repeating, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `claude-elixir-phoenix` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 16. @salacoste — mcp-n8n-workflow-builder
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_salacoste_mcp_n8n_workflow_builder
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_salacoste_mcp_n8n_workflow_builder' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_salacoste_mcp_n8n_workflow_builder' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_salacoste_mcp_n8n_workflow_builder' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_salacoste_mcp_n8n_workflow_builder' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for context-drift hardening for one workflow before proposing any broader agent platform story.'`
- Contact surface: https://github.com/salacoste
- Contact surfaces: GitHub profile: https://github.com/salacoste; Repository: https://github.com/salacoste/mcp-n8n-workflow-builder
- Company: n/a
- Evidence score: 12
- Evidence: workflow control surface, agent infrastructure, 221 GitHub stars, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with context-drift hardening for one workflow before proposing any broader agent platform story.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

First-touch draft:
> Hey @salacoste, saw you're shipping `mcp-n8n-workflow-builder`. If one context, memory, or tool-use failure keeps repeating, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `mcp-n8n-workflow-builder` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
