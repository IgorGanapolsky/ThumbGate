# Roo Sunset Send-Now Sheet

Updated: 2026-05-04T19:52:57.729Z

This is the flat execution layer for the Roo migration lane. Use it when you want one message, one CTA, and one logging sequence per Roo archetype without re-reading the full demand pack.

Pair this file with `roo-sunset-demand-pack.md` when you need the broader migration rationale, channel drafts, or proof policy.

## Current Snapshot
- Revenue state: post-first-dollar
- Headline: Turn Roo shutdown urgency into memory-portable paid intent.
- Warm targets in backstop: 4
- Self-serve targets in backstop: 3
- Sprint-fit targets in backstop: 13
- Workflow-control targets in backstop: 11
- Business-system targets in backstop: 10

## Batch Rules
- Add the lead to the sales ledger before sending anything.
- Keep the motion honest: memory migrants and self-serve evaluators get the install or guide path first; workflow owners get the sprint path first.
- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.

```bash
npm run sales:pipeline -- add --lead 'roo_memory_migrant_<handle>' --source 'roo_sunset' --channel 'github' --username '<handle>' --pain 'Roo migration memory portability and saved corrections'
```

## Send Now: Memory Migrants

### 1. Roo user who wants their corrections to survive the move to Cline
- Channel: github_or_reddit_reply
- Pipeline stage: targeted
- Why now: The migration deadline is explicit, and the fastest credible first touch is memory portability plus one concrete install lane.
- Evidence: Roo officially documents the May 15, 2026 shutdown and recommends Cline as the successor. ThumbGate already ships the Cline install guide and keeps lessons in a local SQLite file.
- Proof rule: Lead with the install path first. Use Verification Evidence only after the buyer confirms a repeated migration or workflow failure.
- CTA: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_install&utm_content=install_doc&campaign_variant=memory_migrant&offer_code=ROO-OUTREACH_INSTALL&cta_id=roo_outreach_install&cta_placement=outreach_draft&surface=roo_outreach
- Add lead before send: `npm run sales:pipeline -- add --lead 'roo_memory_migrant_<handle>' --source 'roo_sunset' --channel 'github' --username '<handle>' --pain 'Roo migration memory portability and saved corrections' --offer 'pro_self_serve' --campaign 'roo_sunset' --cta 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_install&utm_content=install_doc&campaign_variant=memory_migrant&offer_code=ROO-OUTREACH_INSTALL&cta_id=roo_outreach_install&cta_placement=outreach_draft&surface=roo_outreach'`
- Log after send: `npm run sales:pipeline -- advance --lead 'roo_memory_migrant_<handle>' --channel 'github' --stage 'contacted' --note 'Sent Roo migration install-first first touch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'roo_memory_migrant_<handle>' --channel 'github' --stage 'replied' --note 'Buyer confirmed migration pain and wants saved corrections to survive the move.'`
- Log after checkout or intake start: `npm run sales:pipeline -- advance --lead 'roo_memory_migrant_<handle>' --channel 'github' --stage 'checkout_started' --note 'Buyer started the Pro checkout after reviewing the setup path.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'roo_memory_migrant_<handle>' --channel 'github' --stage 'paid' --note 'Closed Roo migration self-serve Pro after install-first evaluation.'`

First-touch draft:
> Roo can sunset. Your lesson memory should not. If you already know Cline is the successor, the fastest path is to keep the corrections local and move them with one install lane: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_install&utm_content=install_doc&campaign_variant=memory_migrant&offer_code=ROO-OUTREACH_INSTALL&cta_id=roo_outreach_install&cta_placement=outreach_draft&surface=roo_outreach .

Pain-confirmed follow-up:
> If one repeated mistake is the part you do not want to reteach after moving off Roo, send the proof path next: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md and https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md . Then use the setup guide https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach before the Pro path https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach .

Tool-path follow-up:
> If you want the clean self-serve route first, start with the setup guide: https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach . If the install path looks right and you want the dashboard plus proof-ready exports after one saved correction, use Pro here: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach .

Checkout close draft:
> If the migration path is clear and you already want the self-serve close, use Pro here: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach . Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Send Next: Workflow Owners

### 2. Team owner migrating one risky workflow off Roo
- Channel: linkedin_or_founder_dm
- Pipeline stage: targeted
- Why now: The shutdown creates urgency, but the strongest monetizable angle is one risky workflow with approval boundaries, rollback risk, or handoff failures.
- Evidence: 11 workflow-control target(s), 10 business-system target(s), and 13 sprint-fit target(s) currently favor a workflow-hardening motion over a generic plugin pitch.
- Proof rule: Lead with one workflow-hardening offer. Send proof only after the buyer names the workflow risk.
- CTA: https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake
- Add lead before send: `npm run sales:pipeline -- add --lead 'roo_workflow_owner_<account>' --source 'roo_sunset' --channel 'linkedin' --account '<account>' --pain 'Roo migration workflow with approval boundaries or rollback risk' --offer 'workflow_hardening_sprint' --campaign 'roo_sunset' --cta 'https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake'`
- Log after send: `npm run sales:pipeline -- advance --lead 'roo_workflow_owner_<account>' --channel 'linkedin' --stage 'contacted' --note 'Sent Roo workflow-hardening first touch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'roo_workflow_owner_<account>' --channel 'linkedin' --stage 'replied' --note 'Buyer confirmed one risky workflow during Roo migration.'`
- Log after checkout or intake start: `npm run sales:pipeline -- advance --lead 'roo_workflow_owner_<account>' --channel 'linkedin' --stage 'sprint_intake' --note 'Buyer started the Workflow Hardening Sprint intake.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'roo_workflow_owner_<account>' --channel 'linkedin' --stage 'paid' --note 'Closed Roo migration workflow-hardening engagement.'`

First-touch draft:
> A Roo-to-Cline move is not the hard part. Keeping one risky workflow from relearning the same repo, approval, or rollback mistake is the hard part. If that workflow already exists on your side, use the Workflow Hardening Sprint intake here: https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake .

Pain-confirmed follow-up:
> Once the workflow risk is explicit, send Verification Evidence plus Commercial Truth before a wider rollout: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md and https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md . If they still want the sprint path, keep the intake here: https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake .

Tool-path follow-up:
> If the buyer wants the product path before founder-led help, move them to the setup guide https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach and keep Pro https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach as the self-serve follow-on. If the workflow is still risky, keep the sprint path primary: https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake .

Checkout close draft:
> If the team is already comparing close options, keep the Workflow Hardening Sprint primary: https://thumbgate-production.up.railway.app/?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_sprint&utm_content=workflow_sprint&campaign_variant=migration_workflow&offer_code=ROO-OUTREACH_SPRINT&cta_id=roo_outreach_sprint&cta_placement=outreach_draft&surface=roo_outreach#workflow-sprint-intake . Self-serve Pro is secondary: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach . Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Close Now: Self-Serve Evaluators

### 3. Local-first Roo evaluator who wants the tool path before founder-led help
- Channel: github_comment_or_threads_reply
- Pipeline stage: targeted
- Why now: This lane is the cleanest close for buyers who ask for install, pricing, or the dashboard path instead of workflow consulting.
- Evidence: 3 self-serve target(s) in the live queue already support a guide-first motion once the buyer accepts the memory-portability story.
- Proof rule: Guide first, then Commercial Truth and Verification Evidence, then Pro once the buyer explicitly asks for the tool path.
- CTA: https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach
- Add lead before send: `npm run sales:pipeline -- add --lead 'roo_self_serve_evaluator_<handle>' --source 'roo_sunset' --channel 'github' --username '<handle>' --pain 'Needs clean Roo-to-Cline setup path before founder help' --offer 'pro_self_serve' --campaign 'roo_sunset' --cta 'https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach'`
- Log after send: `npm run sales:pipeline -- advance --lead 'roo_self_serve_evaluator_<handle>' --channel 'github' --stage 'contacted' --note 'Sent Roo guide-first self-serve first touch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'roo_self_serve_evaluator_<handle>' --channel 'github' --stage 'replied' --note 'Buyer asked for install, pricing, or dashboard path.'`
- Log after checkout or intake start: `npm run sales:pipeline -- advance --lead 'roo_self_serve_evaluator_<handle>' --channel 'github' --stage 'checkout_started' --note 'Buyer started the Pro checkout after the guide-first path.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'roo_self_serve_evaluator_<handle>' --channel 'github' --stage 'paid' --note 'Closed Roo migration self-serve Pro.'`

First-touch draft:
> Roo can go away without taking your agent memory with it. If you want the clean self-serve move first, start with the setup guide here: https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach .

Pain-confirmed follow-up:
> If they ask for proof, send Commercial Truth plus Verification Evidence after the guide: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md and https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md . If they want the direct paid path next, use Pro here: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach .

Tool-path follow-up:
> If the buyer already wants the product path, keep it simple: setup guide https://thumbgate-production.up.railway.app/guide?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_guide&utm_content=guide&campaign_variant=proof_backed_setup&offer_code=ROO-OUTREACH_GUIDE&cta_id=roo_outreach_guide&cta_placement=outreach_draft&surface=roo_outreach then Pro https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach . Do not expand into a workflow sprint unless they name one risky workflow.

Checkout close draft:
> If the buyer is ready for the self-serve close, use Pro here: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=roo_sunset&utm_medium=operator_outreach&utm_campaign=roo_outreach_pro&utm_content=pro&campaign_variant=self_serve_follow_on&offer_code=ROO-OUTREACH_PRO&cta_id=roo_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=roo_outreach . Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
