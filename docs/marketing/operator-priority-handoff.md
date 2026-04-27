# Revenue Operator Priority Handoff

Updated: 2026-04-27T14:49:34.513Z

This is the ranked send order for the current zero-to-one revenue loop. Work warm discovery targets first, then expand into cold GitHub targets with the same proof discipline.

This handoff sits on top of `gtm-revenue-loop.md`, `gtm-target-queue.csv`, and `team-outreach-messages.md` so an operator can decide who to contact next without re-ranking the queue manually.

## Current Snapshot
- Revenue state: cold-start
- Headline: No verified revenue and no active pipeline. Stop treating posts as sales; directly sell one Workflow Hardening Sprint.
- Paid orders: 0
- Checkout starts: 0
- Active follow-ups: 0
- Warm targets ready now: 4
- Cold GitHub targets ready next: 6

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
- CTA: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=deep_ad1959&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_deep_ad1959_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_deep_ad1959_r_cursor&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Your question about rollback rates when context changes is exactly the right one. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have one workflow where context drift or rollback risk keeps showing up, I can harden that workflow for you. Worth a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=deep_ad1959&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_deep_ad1959_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_deep_ad1959_r_cursor&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

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
- CTA: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=game_of_kton&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_game_of_kton_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_game_of_kton_r_cursor&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Your ACT-R engram work is fascinating, especially the conflict resolution for opposing facts and the decay model. I am looking for one serious AI-agent workflow to harden end-to-end this week. If your memory system has one recurring failure mode such as stale context, opposing facts, bad handoffs, or unsafe tool calls, I can turn that into a prevention rule and proof run. Open to a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=game_of_kton&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_game_of_kton_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_game_of_kton_r_cursor&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

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
- CTA: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=leogodin217&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_leogodin217_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_leogodin217_r_claudecode&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Your arch-create to sprint workflow is one of the most mature agent processes I have seen anyone describe. I am looking for one AI-agent workflow to harden end-to-end this week. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeating failure and I will help turn it into an enforceable Pre-Action Check plus proof run. Worth 15 minutes?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=leogodin217&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_leogodin217_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_leogodin217_r_claudecode&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

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
- CTA: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=enthu_cutlet_1337&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_enthu_cutlet_1337_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_enthu_cutlet_1337_r_claudecode&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Appreciate the kind words on the Thompson Sampling approach. You nailed the core insight: most guardrails are brittle prompt hacks that break when context shifts. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have a workflow where brittle guardrails keep failing, I can harden that workflow with you. Open to a 15-minute diagnostic?

Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=reddit_dm&utm_campaign=reddit_warm_workflow_sprint&utm_content=enthu_cutlet_1337&campaign_variant=revenue_loop&offer_code=REDDIT-SPRINT&cta_id=reddit_enthu_cutlet_1337_workflow_sprint&cta_placement=warm_outreach&surface=gtm_revenue_loop&lead_id=reddit_enthu_cutlet_1337_r_claudecode&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Seed Next: Cold GitHub
## 5. @manki-review — manki
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
- CTA: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=manki&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_manki_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_manki_review_manki&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Hey @manki-review, saw you're shipping `manki`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=manki&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_manki_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_manki_review_manki&landing_path=%2F#workflow-sprint-intake

Pain-confirmed follow-up:
> If `manki` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=manki&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_manki_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_manki_review_manki&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 6. @mj9733246-cloud — code-review-expert
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_mj9733246_cloud_code_review_expert
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_mj9733246_cloud_code_review_expert' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on rollout proof for one production workflow that cannot afford repeated agent mistakes.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_mj9733246_cloud_code_review_expert' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around rollout proof for one production workflow that cannot afford repeated agent mistakes.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_mj9733246_cloud_code_review_expert' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for rollout proof for one production workflow that cannot afford repeated agent mistakes.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_mj9733246_cloud_code_review_expert' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for rollout proof for one production workflow that cannot afford repeated agent mistakes.'`
- Contact surface: https://github.com/mj9733246-cloud
- Contact surfaces: GitHub profile: https://github.com/mj9733246-cloud; Repository: https://github.com/mj9733246-cloud/code-review-expert
- Company: n/a
- Evidence score: 10
- Evidence: workflow control surface, production or platform workflow, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=code_review_expert&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_code_review_expert_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_mj9733246_cloud_code_review_expert&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Hey @mj9733246-cloud, saw you're shipping `code-review-expert`. If one deploy, release, or incident workflow keeps needing extra guardrails, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=code_review_expert&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_code_review_expert_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_mj9733246_cloud_code_review_expert&landing_path=%2F#workflow-sprint-intake

Pain-confirmed follow-up:
> If `code-review-expert` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=code_review_expert&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_code_review_expert_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_mj9733246_cloud_code_review_expert&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 7. @alimeramiovens — claude-software-factory
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_alimeramiovens_claude_software_factory
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_alimeramiovens_claude_software_factory' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_alimeramiovens_claude_software_factory' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_alimeramiovens_claude_software_factory' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_alimeramiovens_claude_software_factory' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/alimeramiovens
- Contact surfaces: GitHub profile: https://github.com/alimeramiovens; Repository: https://github.com/alimeramiovens/claude-software-factory
- Company: n/a
- Evidence score: 9
- Evidence: workflow control surface, business-system integration, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_software_factory&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_software_factory_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_alimeramiovens_claude_software_factory&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Hey @alimeramiovens, saw you're shipping `claude-software-factory`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_software_factory&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_software_factory_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_alimeramiovens_claude_software_factory&landing_path=%2F#workflow-sprint-intake

Pain-confirmed follow-up:
> If `claude-software-factory` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_software_factory&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_software_factory_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_alimeramiovens_claude_software_factory&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 8. @Javith-tech — pr-review-ai
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_javith_tech_pr_review_ai
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_javith_tech_pr_review_ai' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_javith_tech_pr_review_ai' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_javith_tech_pr_review_ai' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_javith_tech_pr_review_ai' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Contact surface: https://github.com/Javith-tech
- Contact surfaces: GitHub profile: https://github.com/Javith-tech; Repository: https://github.com/Javith-tech/pr-review-ai
- Company: n/a
- Evidence score: 9
- Evidence: workflow control surface, business-system integration, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=pr_review_ai&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_pr_review_ai_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_javith_tech_pr_review_ai&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Hey @Javith-tech, saw you're shipping `pr-review-ai`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=pr_review_ai&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_pr_review_ai_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_javith_tech_pr_review_ai&landing_path=%2F#workflow-sprint-intake

Pain-confirmed follow-up:
> If `pr-review-ai` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=pr_review_ai&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_pr_review_ai_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_javith_tech_pr_review_ai&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 9. @Jodre11 — claude-code-plugins
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_jodre11_claude_code_plugins
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_jodre11_claude_code_plugins' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_jodre11_claude_code_plugins' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_jodre11_claude_code_plugins' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_jodre11_claude_code_plugins' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Contact surface: https://www.haddrell.co.uk/
- Contact surfaces: Website: https://www.haddrell.co.uk/; GitHub profile: https://github.com/Jodre11; Repository: https://github.com/Jodre11/claude-code-plugins
- Company: n/a
- Evidence score: 8
- Evidence: workflow control surface, agent infrastructure, updated in the last 7 days
- Motion: Pro at $19/mo or $149/yr
- Why now: Target looks like a self-serve tooling surface, so Pro is the cleaner CTA unless a concrete workflow pain is confirmed.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=github&utm_campaign=github_cold_pro_follow_on&utm_content=claude_code_plugins&campaign_variant=revenue_loop&offer_code=GITHUB-PRO&cta_id=github_claude_code_plugins_pro&cta_placement=cold_outreach&plan_id=pro&surface=gtm_revenue_loop&lead_id=github_jodre11_claude_code_plugins&landing_path=%2Fcheckout%2Fpro

First-touch draft:
> Hey @Jodre11, saw you're building around `claude-code-plugins`. If one repeated agent mistake or brittle handoff is slowing adoption, I can harden that workflow first. If you only want the self-serve tool path after that, I can point you there.

Pain-confirmed follow-up:
> If you want the self-serve path for `claude-code-plugins`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=github&utm_campaign=github_cold_pro_follow_on&utm_content=claude_code_plugins&campaign_variant=revenue_loop&offer_code=GITHUB-PRO&cta_id=github_claude_code_plugins_pro&cta_placement=cold_outreach&plan_id=pro&surface=gtm_revenue_loop&lead_id=github_jodre11_claude_code_plugins&landing_path=%2Fcheckout%2Fpro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 10. @jack-009 — claude-review-loop
- Temperature: cold
- Source: github / github
- Pipeline stage: targeted
- Pipeline lead id: github_jack_009_claude_review_loop
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
- Pipeline last updated: n/a
- Log after send: `npm run sales:pipeline -- advance --lead 'github_jack_009_claude_review_loop' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_jack_009_claude_review_loop' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_jack_009_claude_review_loop' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_jack_009_claude_review_loop' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.'`
- Contact surface: https://github.com/jack-009
- Contact surfaces: GitHub profile: https://github.com/jack-009; Repository: https://github.com/jack-009/claude-review-loop
- Company: n/a
- Evidence score: 6
- Evidence: workflow control surface, updated in the last 7 days
- Motion: Workflow Hardening Sprint
- Why now: Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_review_loop&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_review_loop_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_jack_009_claude_review_loop&landing_path=%2F#workflow-sprint-intake

First-touch draft:
> Hey @jack-009, saw you're shipping `claude-review-loop`. If one workflow keeps repeating the same mistake, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_review_loop&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_review_loop_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_jack_009_claude_review_loop&landing_path=%2F#workflow-sprint-intake

Pain-confirmed follow-up:
> If `claude-review-loop` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=github&utm_campaign=github_cold_workflow_sprint&utm_content=claude_review_loop&campaign_variant=revenue_loop&offer_code=GITHUB-SPRINT&cta_id=github_claude_review_loop_workflow_sprint&cta_placement=cold_outreach&surface=gtm_revenue_loop&lead_id=github_jack_009_claude_review_loop&landing_path=%2F#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
