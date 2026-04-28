# Cold Outreach Sequence: Evidence-Backed Queue

Updated: 2026-04-28T10:16:20.911Z

This asset mirrors the evidence-backed GTM queue for self-serve closes and cold GitHub outbound. It is not proof of sent outreach, installs, replies, or revenue by itself.

Use `operator-priority-handoff.md` for rank order, `gtm-target-queue.csv` for imports, and `team-outreach-messages.md` for warm discovery DMs.

## Sequence Rules
- Import the queue into the sales ledger before sending anything.
- Do not lead with proof links before the buyer confirms pain.
- Keep pricing and traction aligned with COMMERCIAL_TRUTH.md.
- Keep quality and engineering claims aligned with VERIFICATION_EVIDENCE.md.

```bash
npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json
```

## Self-Serve Close Lane
## 1. @oliver-kriska — claude-elixir-phoenix
- Motion: Pro at $19/mo or $149/yr
- Pipeline stage: targeted
- Company: n/a
- Contact surface: https://github.com/oliver-kriska
- Contact surfaces: GitHub profile: https://github.com/oliver-kriska; Repository: https://github.com/oliver-kriska/claude-elixir-phoenix
- Evidence score: 14
- Evidence: workflow control surface, agent infrastructure, self-serve agent tooling, 290 GitHub stars, updated in the last 7 days
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: Proof-backed setup path for claude-elixir-phoenix
- CTA: https://thumbgate-production.up.railway.app/guide
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_oliver_kriska_claude_elixir_phoenix' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`

First-touch draft:
> Hey @oliver-kriska, saw you're building around `claude-elixir-phoenix`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

Pain-confirmed follow-up:
> If you want the self-serve path for `claude-elixir-phoenix`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want the self-serve path for `claude-elixir-phoenix`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro

Checkout close draft:
> If you are already comparing close options for `claude-elixir-phoenix`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 2. @gmickel — flow-next
- Motion: Pro at $19/mo or $149/yr
- Pipeline stage: targeted
- Company: Mickel Tech
- Contact surface: https://mickel.tech/
- Contact surfaces: Website: https://mickel.tech/; GitHub profile: https://github.com/gmickel; Repository: https://github.com/gmickel/flow-next
- Evidence score: 12
- Evidence: workflow control surface, self-serve agent tooling, 576 GitHub stars, updated in the last 7 days
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: Proof-backed setup path for flow-next
- CTA: https://thumbgate-production.up.railway.app/guide
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_gmickel_flow_next' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`

First-touch draft:
> Hey @gmickel, saw you're building around `flow-next`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

Pain-confirmed follow-up:
> If you want the self-serve path for `flow-next`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want the self-serve path for `flow-next`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro

Checkout close draft:
> If you are already comparing close options for `flow-next`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Cold GitHub Sprint Lane
## 3. @Adqui9608 — ai-code-review-agent
- Motion: Workflow Hardening Sprint
- Pipeline stage: targeted
- Company: n/a
- Contact surface: https://github.com/Adqui9608
- Contact surfaces: GitHub profile: https://github.com/Adqui9608; Repository: https://github.com/Adqui9608/ai-code-review-agent
- Evidence score: 15
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 7 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: One ai-code-review-agent workflow that should stop repeating mistakes
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`

First-touch draft:
> Hey @Adqui9608, saw you're shipping `ai-code-review-agent`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `ai-code-review-agent` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want to inspect the self-serve path while you evaluate `ai-code-review-agent`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Checkout close draft:
> If you are already comparing close options for `ai-code-review-agent`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 4. @DGouron — review-flow
- Motion: Workflow Hardening Sprint
- Pipeline stage: targeted
- Company: Mentor Goal
- Contact surface: https://dgouron.fr/
- Contact surfaces: Website: https://dgouron.fr/; GitHub profile: https://github.com/DGouron; Repository: https://github.com/DGouron/review-flow
- Evidence score: 14
- Evidence: workflow control surface, business-system integration, agent infrastructure, 36 GitHub stars, updated in the last 7 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: One review-flow workflow that should stop repeating mistakes
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_dgouron_review_flow' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`

First-touch draft:
> Hey @DGouron, saw you're shipping `review-flow`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `review-flow` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want to inspect the self-serve path while you evaluate `review-flow`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Checkout close draft:
> If you are already comparing close options for `review-flow`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 5. @nihannihu — Omni-SRE
- Motion: Workflow Hardening Sprint
- Pipeline stage: targeted
- Company: @Omni-IDE
- Contact surface: https://github.com/nihannihu
- Contact surfaces: GitHub profile: https://github.com/nihannihu; Repository: https://github.com/nihannihu/Omni-SRE
- Evidence score: 14
- Evidence: workflow control surface, production or platform workflow, business-system integration, agent infrastructure, updated in the last 30 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: One Omni-SRE workflow that should stop repeating mistakes
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_nihannihu_omni_sre' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`

First-touch draft:
> Hey @nihannihu, saw you're shipping `Omni-SRE`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `Omni-SRE` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want to inspect the self-serve path while you evaluate `Omni-SRE`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Checkout close draft:
> If you are already comparing close options for `Omni-SRE`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## 6. @freema — mcp-jira-stdio
- Motion: Workflow Hardening Sprint
- Pipeline stage: targeted
- Company: n/a
- Contact surface: http://www.tomasgrasl.cz/
- Contact surfaces: Website: http://www.tomasgrasl.cz/; GitHub profile: https://github.com/freema; Repository: https://github.com/freema/mcp-jira-stdio
- Evidence score: 13
- Evidence: workflow control surface, business-system integration, agent infrastructure, 11 GitHub stars, updated in the last 7 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- Suggested subject: One mcp-jira-stdio workflow that should stop repeating mistakes
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Sprint brief: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Log after send: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after call booked: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
- Log after paid: `npm run sales:pipeline -- advance --lead 'github_freema_mcp_jira_stdio' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`

First-touch draft:
> Hey @freema, saw you're shipping `mcp-jira-stdio`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Pain-confirmed follow-up:
> If `mcp-jira-stdio` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

Tool-path follow-up:
> If you want to inspect the self-serve path while you evaluate `mcp-jira-stdio`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

Checkout close draft:
> If you are already comparing close options for `mcp-jira-stdio`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
