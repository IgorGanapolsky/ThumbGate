# Packaging and Sales Plan

## North Star

Weekly active proof-backed workflow runs.

This is the metric that matters most. Stars, visits, and installs matter only if they lead to teams running one monitored workflow with shared memory, guardrails, and evidence.

## Best First Offer

- OSS core for one operator proving a workflow locally.
- Cloud Pro for one team running one workflow with shared memory and proof-ready runs.
- Workflow install workshop for buyers who want help wiring lead-to-meeting, onboarding, or internal ops automation into a production process.

## Product Tiers

### Tier 1: Open Source Core (Free)

- Local RLHF feedback capture
- Schema validation
- Prevention rules
- DPO export
- Local MCP server

### Tier 2: Cloud Pro (Founding price: $10/mo)

- Hosted API endpoint
- Provisioned API keys and hosted onboarding
- Shared memory and prevention rules across operators
- Proof-ready runs with auditable workflow evidence
- Intent routing and checkpoint surfaces for policy-aware workflows
- Context pack construction and provenance endpoints for bounded retrieval

Pricing note:

- Keep the current live Stripe price at `$10/mo` while Cloud Pro is still proving conversion.
- Revisit repricing after the hosted workflow layer shows retained usage and stronger buyer pull.

### Tier 3: Enterprise (Pricing: custom quote)

- SSO/RBAC
- Audit logging
- Data residency options
- Dedicated support + onboarding

## Buyer And User Split

- Buyer: head of ops, head of growth, platform lead, or consultancy owner funding the rollout.
- User: the operator running the workflow.
- Champion: the engineer or platform owner wiring the Veto Layer and proof path.

## Distribution Channels By Intent

1. AI coding agent teams: Claude, Codex, Gemini, ChatGPT, Amp, and custom runners.
2. RevOps and growth teams automating lead-to-meeting with human approvals.
3. Platform teams standardizing one policy and memory layer across multiple runtimes.
4. Consultancies installing AI workflows for clients that demand proof and auditability.

## Ideal Customer Profile

1. Teams with one workflow owner and one workflow pain severe enough to justify change.
2. Organizations that need auditable feedback-to-behavior loops before broader rollout.
3. Buyers who care more about deployability and proof than about adding another feature list.

## Buyer Outcome Statement

1. Make one workflow deployable, auditable, and improvable over time.
2. Reduce repeated workflow regressions by enforcing prevention rules from real operator feedback.
3. Prove workflow behavior with reproducible, machine-readable evidence artifacts.

## Discovery Plan

1. Keywords and topics optimized in GitHub About and public docs.
2. README conversion flow: pain -> workflow outcome -> proof -> install path.
3. Technical credibility: CI badge, verification report, and proof artifacts.
4. Structured content for AI search: comparison tables, FAQ blocks, SoftwareApplication and FAQPage schema.
5. Value-led landing-page microcopy that makes the outcome obvious before architecture language appears.

## Sales Motion

1. Land: OSS adoption by one operator proving a workflow locally.
2. Expand: Cloud Pro for shared memory, hosted keys, proof-ready runs, and team rollout.
3. Accelerate: workshop/install offer for buyers who want fast implementation with minimal risk.
4. Close enterprise: security, compliance, support SLA, and governance requirements.

## Outbound And Workshop Motion

1. Use intent-based outreach around job posts, funding events, and companies publicly investing in AI workflow operations.
2. Run hands-on workflow workshops instead of generic webinars.
3. Use a skinny funnel: disqualify teams without one owned workflow, one buyer, and one measurable pain.
4. Keep founder-led outreach and manual installs until the wedge is consistently converting.

## Metrics That Support The North Star

1. Number of teams running one monitored workflow weekly.
2. Number of proof-backed workflow runs reviewed by operators or buyers.
3. OSS user to Cloud Pro conversion for teams running a real workflow.
4. Workshop-to-pilot conversion rate.
5. Reduction in repeated workflow failure patterns after prevention rules are enabled.

## Proof Links

1. Verification log: [VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md)
2. Compatibility proof (human): [../proof/compatibility/report.md](../proof/compatibility/report.md)
3. Compatibility proof (machine): [../proof/compatibility/report.json](../proof/compatibility/report.json)
4. Automation proof (human): [../proof/automation/report.md](../proof/automation/report.md)
5. Automation proof (machine): [../proof/automation/report.json](../proof/automation/report.json)
