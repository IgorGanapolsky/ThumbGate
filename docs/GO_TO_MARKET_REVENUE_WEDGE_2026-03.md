# 30-Day GTM Plan | Go-To-Market Revenue Wedge (March 2026)

## Decision

Sell one workflow outcome, not horizontal agent infrastructure.

The product story is strongest when Context Gateway is presented as the hosted reliability layer behind one workflow with business stakes. The first wedge is a lead-to-meeting workflow. Onboarding and internal ops automation use the same operating model, but they should stay secondary until the wedge is converting.

Proof anchors for public claims:

- [Verification Evidence](VERIFICATION_EVIDENCE.md)
- [Compatibility proof](../proof/compatibility/report.json)
- [Automation proof](../proof/automation/report.json)

## North Star

Weekly active proof-backed workflow runs.

This is the metric that matters:

- a real workflow owner
- a real workflow running weekly
- shared memory and hosted guardrails enabled
- proof artifacts reviewed by an operator or buyer

Traffic, stars, and installs are upstream indicators. They are not the business North Star.

## Why This Wedge

Lead-to-meeting is specific enough to sell and broad enough to prove the product story:

- intake, enrichment, drafting, approval, and CRM sync are already familiar steps
- human review is normal, which makes a Veto Layer easy to justify
- failures are visible and painful, which makes prevention rules credible
- proof-ready runs and funnel evidence map to a buyer outcome instead of abstract model quality

## Buyer, User, Champion

| Role | What they care about | What they need from us |
| --- | --- | --- |
| Buyer | safer rollout, accountability, measurable outcome | one workflow they can justify |
| User | less drift, fewer repeated mistakes, clearer next step | shared memory, better microcopy, reliable approvals |
| Champion | policy, proof, integration, runtime consistency | MCP/API install path, context packs, evidence |

## Core Message

Use this sentence family everywhere:

`One workflow. Shared memory. Hosted guardrails. Proof-ready runs.`

Supporting message:

- We make one AI workflow safe enough to ship team-wide.
- We turn operator feedback into prevention rules and proof.
- We do not ask buyers to fund a generic agent platform on day one.

## What Stays Secondary

Do not lead with these unless the audience is explicitly technical:

- KTO/DPO export
- Thompson Sampling
- semantic cache policy tuning
- context engineering internals

These matter, but they are the compounding engine behind the workflow, not the sales headline.

## Offer Stack

### OSS Core

- best for one operator or one builder
- local feedback capture
- local context packs
- prevention rules
- DPO/KTO export

### Context Gateway

- best for one team running one workflow
- hosted API keys
- shared memory and shared prevention rules
- proof-ready workflow runs
- policy and checkpoint controls

### Workflow Install Workshop

- best for buyers who want speed and low risk
- one workflow scoped in advance
- hands-on setup with buyer and operator present
- explicit proof path before broader rollout

## 30-Day Plan

### Week 1: Sharpen The Surfaces

- make the landing page, README, and pitch value-led
- make the workflow wedge explicit
- make the North Star explicit
- keep `SoftwareApplication` and `FAQPage` schema accurate
- link every public-facing surface back to `VERIFICATION_EVIDENCE.md`

### Week 2: Publish High-Density Proof Content

- comparison page: local-only workflow vs shared proof-backed workflow
- FAQ blocks answering buyer questions directly
- one proof-led teardown of the lead-to-meeting wedge
- one install-to-value guide: install -> instrument -> capture feedback -> prove improvement

### Week 3: Run Distribution As A Craft

- founder-led outreach to companies already investing in AI workflow operations
- target intent signals: hiring, funding, workflow tooling changes, public AI automation efforts
- post in developer and AI workflow communities where technical promotion is accepted
- treat AI search as a channel: structured markdown, tables, FAQs, machine-readable evidence

### Week 4: Convert Through Workshops

- run hands-on workflow workshops instead of generic webinars
- require one workflow owner, one buyer, and one measurable pain
- use a skinny funnel and disqualify weak fits early
- convert strong conversations into design-partner pilots or Context Gateway installs

## Distribution Channels

### AI Search And Search Engines

- public docs with high-density semantic chunks
- FAQ blocks and comparison tables
- `SoftwareApplication` and `FAQPage` schema
- direct links to proof artifacts and `VERIFICATION_EVIDENCE.md`

### Founder-Led Outbound

- intent-based lists, not broad cold blasting
- mention the workflow outcome first
- offer a workflow install session, not a generic demo

### Communities

- target technical communities where workflow reliability is already a live pain
- publish mechanism-based copywriting, not vague claims
- show how the Veto Layer changes behavior over time

## Qualification Rules

Do not spend cycles on accounts that lack:

- one named workflow owner
- one workflow with repeated failures or human review pain
- one buyer willing to fund rollout if proof is strong

## Metrics That Support The North Star

- number of teams running one proof-backed workflow weekly
- number of workflows with shared memory and prevention rules enabled
- number of workshop installs that become active pilots
- OSS to Context Gateway conversion for teams with a live workflow
- reduction in repeated workflow failures after V2V capture and prevention rules

## Guardrails

- never claim ROI that has not been observed
- never lead with architecture when the buyer needs an outcome
- never widen from one workflow to platform language before the wedge converts
- never publish public-facing claims without linking proof or evidence

## North Star Narrative

The company wins when a buyer can say:

`We rolled out one AI workflow, it stopped repeating the same mistakes, and we can prove it.`
