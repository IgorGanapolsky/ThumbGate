# OpenCode Revenue Pack

Updated: 2026-04-30T04:14:20.304Z

This is a sales operator artifact. It is not proof of installs, revenue, or marketplace approval by itself.

## Objective
Turn OpenCode setup intent into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations without inventing install traction.

## Positioning
- State: post-first-dollar
- Headline: Turn OpenCode install intent into tracked proof and paid follow-through.
- Short description: ThumbGate gives OpenCode a worktree-safe local MCP profile, a proof-backed setup path, and enforceable Pre-Action Checks before the next risky tool call runs.
- Summary: Current GTM evidence includes 1 explicit OpenCode-tagged target lane(s), so the OpenCode path should stay self-serve-first until one repeated workflow failure or paid-intent event is explicit. Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.

## Canonical Identity
- Display name: ThumbGate for OpenCode
- Repository: https://github.com/IgorGanapolsky/ThumbGate
- Homepage: https://thumbgate-production.up.railway.app
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Demand Surfaces
### Proof-backed setup guide
- Buyer signal: Self-serve OpenCode users who want one setup path before deciding whether the tool-only lane is enough.
- Operator use: Primary hosted conversion surface once an OpenCode buyer accepts the local-first install path and wants proof plus clear next offers.
- Surface URL: https://thumbgate-production.up.railway.app/guide?utm_source=opencode&utm_medium=integration_guide&utm_campaign=opencode_setup_guide&utm_content=guide&campaign_variant=self_serve_proof&offer_code=OPENCODE-SETUP_GUIDE&cta_id=opencode_setup_guide&cta_placement=guide_surface&surface=opencode_profile
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### OpenCode integration guide
- Buyer signal: Repo owners who want to evaluate OpenCode with real guardrails instead of ad hoc local config edits.
- Operator use: Repo-backed proof surface that explains the shipped OpenCode profile, worktree-only execution, and read-only review lane.
- Surface URL: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### Portable OpenCode install guide
- Buyer signal: Warm operators ready to copy a pinned MCP profile into an existing OpenCode setup.
- Operator use: Portable install surface for buyers who want the global OpenCode config path outside this repository.
- Surface URL: https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### Portable adapter profile
- Buyer signal: Technical evaluators who want the raw config artifact before trusting the setup story.
- Operator use: Machine-readable proof of the exact OpenCode MCP entry ThumbGate ships and version-pins.
- Surface URL: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/opencode/opencode.json
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### Repo-local OpenCode profile
- Buyer signal: Teams evaluating whether OpenCode can run inside a shared repo without loosening safety boundaries.
- Operator use: Shows the worktree-safe permission model, denied destructive git commands, and review-agent boundaries inside a real repo profile.
- Surface URL: https://github.com/IgorGanapolsky/ThumbGate/blob/main/opencode.json
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/.opencode/instructions/thumbgate-workflow.md
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Follow-On Offers
- ThumbGate Pro: $19/mo or $149/yr
  Buyer: Solo OpenCode operators who proved one blocked repeat and want the dashboard plus proof-ready exports.
  CTA: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=opencode&utm_medium=setup_guide&utm_campaign=opencode_pro_follow_on&utm_content=pro&campaign_variant=self_serve_paid_intent&offer_code=OPENCODE-PRO_FOLLOW_ON&cta_id=opencode_pro_follow_on&cta_placement=follow_on_offer&plan_id=pro&surface=opencode_follow_on
- Workflow Hardening Sprint: Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification
  Buyer: Teams that already named one repeated workflow failure, one owner, and one approval boundary in an OpenCode-adjacent workflow.
  CTA: https://thumbgate-production.up.railway.app/?utm_source=opencode&utm_medium=setup_guide&utm_campaign=opencode_sprint_follow_on&utm_content=workflow_sprint&campaign_variant=team_motion&offer_code=OPENCODE-SPRINT_FOLLOW_ON&cta_id=opencode_sprint_follow_on&cta_placement=follow_on_offer&surface=opencode_follow_on#workflow-sprint-intake

## Operator Queue
### OpenCode builder who wants the clean self-serve path first
- Evidence: Current GTM evidence includes 1 explicit OpenCode-tagged target(s). Strongest current signal: zaxbysauce/opencode-swarm (workflow control surface; self-serve agent tooling; 248 GitHub stars; updated in the last 7 days; updated 2026-04-30T03:27:57Z)
- Proof trigger: They already want the install path and can name one repeated mistake they would pay to block before the next OpenCode tool call.
- Proof asset: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Next ask: https://thumbgate-production.up.railway.app/guide?utm_source=opencode&utm_medium=integration_guide&utm_campaign=opencode_queue_setup&utm_content=guide&campaign_variant=self_serve_open_code&offer_code=OPENCODE-QUEUE_SETUP&cta_id=opencode_queue_setup&cta_placement=operator_queue&surface=opencode_profile
- Recommended motion: Guide -> prove one blocked repeat -> Pro.

### Repo owner evaluating OpenCode inside a shared repository
- Evidence: The shipped repo-local OpenCode profile denies destructive git commands, protects .thumbgate runtime state, and keeps implementation inside worktrees.
- Proof trigger: They already have one approval boundary, rollout rule, or shared-repo failure mode they need to enforce before wider use.
- Proof asset: https://github.com/IgorGanapolsky/ThumbGate/blob/main/opencode.json
- Next ask: https://thumbgate-production.up.railway.app/?utm_source=opencode&utm_medium=operator_outreach&utm_campaign=opencode_queue_sprint&utm_content=workflow_sprint&campaign_variant=repo_owner&offer_code=OPENCODE-QUEUE_SPRINT&cta_id=opencode_queue_sprint&cta_placement=operator_queue&surface=opencode_workflow_queue#workflow-sprint-intake
- Recommended motion: Qualify one risky shared workflow for the Workflow Hardening Sprint.

### Team that wants OpenCode as a bounded review lane instead of another full-autonomy writer
- Evidence: ThumbGate ships a read-only OpenCode review agent plus workflow instructions that keep verification and repo inspection separated from edit-capable work.
- Proof trigger: They care more about controlled review and proof than about raw OpenCode novelty or another agent install.
- Proof asset: https://github.com/IgorGanapolsky/ThumbGate/blob/main/.opencode/agents/thumbgate-review.md
- Next ask: https://thumbgate-production.up.railway.app/?utm_source=opencode&utm_medium=operator_outreach&utm_campaign=opencode_queue_sprint&utm_content=workflow_sprint&campaign_variant=repo_owner&offer_code=OPENCODE-QUEUE_SPRINT&cta_id=opencode_queue_sprint&cta_placement=operator_queue&surface=opencode_workflow_queue#workflow-sprint-intake
- Recommended motion: Start with one review or approval workflow, then expand only after proof exists.

## Outreach Drafts
### GitHub DM or email — OpenCode builder
You already have OpenCode. The missing piece is turning one repeated mistake into a Pre-Action Check before the next tool call runs, not adding another note. If you want the clean self-serve path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide?utm_source=opencode&utm_medium=operator_outreach&utm_campaign=opencode_outreach_setup&utm_content=guide&campaign_variant=self_serve_first_touch&offer_code=OPENCODE-OUTREACH_SETUP&cta_id=opencode_outreach_setup&cta_placement=outreach_draft&surface=opencode_outreach .

### Pain-confirmed follow-up — Solo operator who already confirmed one repeated failure
Now that the failure pattern is concrete, move from setup to proof. Use Verification Evidence first, then route the buyer to the self-serve paid lane only if they want the dashboard and export-ready proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md then https://thumbgate-production.up.railway.app/checkout/pro?utm_source=opencode&utm_medium=operator_outreach&utm_campaign=opencode_outreach_pro&utm_content=pro&campaign_variant=proof_after_pain&offer_code=OPENCODE-OUTREACH_PRO&cta_id=opencode_outreach_pro&cta_placement=outreach_draft&plan_id=pro&surface=opencode_outreach .

### Founder note — Repo owner or consultancy lead
I am not pitching another generic OpenCode add-on. I am pitching one workflow that becomes safe enough to ship because the repeated failure turns into an enforceable gate and the proof stays inspectable. If `opencode-swarm` maps to a real approval, review, or rollout boundary in your stack, the next useful step is the Workflow Hardening Sprint intake: https://thumbgate-production.up.railway.app/?utm_source=opencode&utm_medium=operator_outreach&utm_campaign=opencode_outreach_sprint&utm_content=workflow_sprint&campaign_variant=team_boundary&offer_code=OPENCODE-OUTREACH_SPRINT&cta_id=opencode_outreach_sprint&cta_placement=outreach_draft&surface=opencode_outreach#workflow-sprint-intake .

## 90-Day Measurement Plan
- North star: opencode_setup_to_paid_intent
- Policy: Treat OpenCode guide clicks and config reads as acquisition evidence only after a tracked Pro checkout start or qualified sprint conversation exists.
- Minimum useful signal: One tracked paid-intent event from an OpenCode-tagged surface.
- Strong signal: Two tracked paid-intent events or one qualified conversation sourced from the current 1 OpenCode-tagged target lane.
Tracked metrics:
- opencode_setup_guide_views
- opencode_profile_doc_clicks
- opencode_proof_clicks
- opencode_pro_checkout_starts
- opencode_qualified_team_conversations
Guardrails:
- Do not claim installs, revenue, or marketplace approval without direct command evidence.
- Do not lead with proof links before the buyer confirms pain.
- Keep pricing aligned with COMMERCIAL_TRUTH.md.
- Keep proof claims aligned with VERIFICATION_EVIDENCE.md.
Milestones:
- days_0_30: Keep the OpenCode setup guide, integration guide, and portable profile aligned around one self-serve story. Decision rule: Do not add new OpenCode-specific offers until guide clicks or outreach replies show paid intent.
- days_31_60: Promote whichever OpenCode motion converts best after install intent: Pro or Workflow Hardening Sprint. Decision rule: If setup interest rises without paid intent, move proof and follow-on offers closer to the first-touch path.
- days_61_90: Decide whether OpenCode stays a thin self-serve wedge or becomes a team workflow-hardening lane. Decision rule: Only prioritize the team motion when qualified conversations exist.
Do not count as success:
- guide clicks without proof clicks
- proof clicks without a tracked paid-intent event
- unverified install or revenue claims

## Proof Links
- https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
