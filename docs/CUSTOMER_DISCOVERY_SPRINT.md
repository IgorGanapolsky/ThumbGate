# Customer Discovery Sprint

Status: current
Updated: April 25, 2026

This document turns the current go-to-market recommendation into one week of concrete execution.

## Goal

Replace broad broadcasting with direct customer discovery so ThumbGate sharpens around one buyer: teams that need agent governance for one valuable workflow.

## Operating Rule

Posts are not sales. A lead only counts when it moves through the tracked pipeline:

`targeted -> contacted -> replied -> call_booked -> checkout_started or sprint_intake -> paid`

Use one first-touch offer:

> I will harden one AI-agent workflow for you.

Use the proof pack only after the buyer confirms the pain. Proof reduces buyer risk; it does not create pain.

## Working Thesis

- The local CLI is the adoption wedge.
- The business is enterprise-first.
- The first paid motion is the Workflow Hardening Sprint, not a generic self-serve subscription.
- Pro stays available for solo operators, but it is the side lane, not the primary narrative.

## Seven-Day Sprint

1. Pause broad posting for 7 days. No new generic launch threads, no volume-first social loops.
2. Contact the 3-5 people who engaged meaningfully with the Workflow Hardening Sprint offer.
3. Ask for 15 minutes to understand their current workflow, failure modes, and approval needs.
4. Capture exact language around blockers, proof needs, rollout friction, and who actually signs off.
5. Compare those answers against the current sprint offer, Team story, and CLI wedge.
6. Rewrite the landing page, README, and pitch with the words buyers actually use.
7. End the sprint with a decision memo: double down on team agent governance or keep the local tool as a niche side path.

## Pipeline Tracking

Generate a target queue:

```bash
npm run gtm:revenue-loop -- --report-dir reports/gtm/$(date +%F)-selling-now --max-targets=12
```

The revenue loop now emits fourteen operator artifacts in that folder:

- `gtm-revenue-loop.md` for the human summary
- `gtm-revenue-loop.json` for machine-readable truth
- `gtm-marketplace-copy.md` for listing-ready copy based on the same target evidence
- `gtm-marketplace-copy.json` for machine-readable listing copy and target themes
- `gtm-target-queue.csv` for spreadsheet sorting
- `gtm-target-queue.jsonl` for line-by-line operator handoff with first-touch and pain-confirmed follow-up drafts
- `claude-workflow-hardening-pack.md` for Claude-first positioning, buyer lanes, and evidence-backed outbound copy
- `claude-workflow-hardening-pack.json` for the same Claude-first outbound pack in machine-readable form
- `cursor-marketplace-revenue-pack.md` for Cursor Marketplace, Cursor Directory, and Team Marketplace submission copy
- `cursor-marketplace-revenue-pack.json` for machine-readable Cursor listing metadata and follow-on offers
- `cursor-marketplace-surfaces.csv` for one-sheet operator submission fields
- `gemini-cli-demand-pack.md` for Gemini CLI memory-demand, local-first, and cloud-workflow conversion copy
- `gemini-cli-demand-pack.json` for the same Gemini operator pack in machine-readable form
- `gemini-cli-operator-queue.csv` for Gemini-specific queue rows and next asks

That report now carries both warm discovery leads and cold GitHub prospects in one machine-readable queue so the operator can import a single artifact and still contact the warm engagers first.
Every artifact inherits the same evidence backstop:

- `docs/COMMERCIAL_TRUTH.md` for pricing and traction guardrails
- `docs/VERIFICATION_EVIDENCE.md` for proof-pack links
- explicit claim guardrails so operator-ready copy does not drift into unverified revenue, install, or marketplace claims

Import the queue into the local sales ledger:

```bash
npm run sales:pipeline -- import \
  --source reports/gtm/$(date +%F)-selling-now/gtm-revenue-loop.json \
  --out reports/gtm/$(date +%F)-selling-now/sales-pipeline.md
```

Advance a lead only when the real-world event happened:

```bash
npm run sales:pipeline -- advance \
  --lead github_builder_production_mcp_server \
  --stage contacted \
  --channel github \
  --note "Sent one-workflow hardening offer"
```

Do not mark a lead replied, call-booked, sprint-intake, checkout-started, or paid until there is evidence for that exact stage.

## Target Interviews

Start with the engagers already identified in [team-outreach-messages.md](marketing/team-outreach-messages.md).

- Deep_Ad1959
- game-of-kton
- leogodin217
- Enthu-Cutlet-1337

If those stall, prioritize anyone who:

- described a real workflow instead of just reacting to the launch
- mentioned teams, CI, approvals, or shared repos
- already built memory, hooks, or reliability layers of their own

## Interview Script

Use these in order. Do not pitch until the end, and only if they ask.

1. What agent workflow are you running often enough that failures actually hurt?
2. What mistake or handoff failure keeps repeating?
3. Who feels the pain first: the operator, the reviewer, the team lead, or the buyer?
4. What has to be true before you would trust that workflow to scale to a team?
5. Where do prompt files and local notes stop being enough?
6. If you had one control plane for that workflow, what would it need to prove?
7. If this were valuable, would you expect to buy a local tool, a team pilot, or something else?

## What To Capture

- Workflow name
- Owner of the workflow
- Repeated blocker
- Current agent/runtime
- Approval boundary
- Proof requirement
- Whether the pain is solo or team-wide
- Exact language they used to describe the problem

## Success Criteria

The sprint is useful if it produces at least one of these:

- one named workflow that clearly fits the Workflow Hardening Sprint
- one pricing or packaging objection that changes the public story
- one repeated buyer phrase we can use across the README, landing page, and outreach
- one explicit reason the local-only path is insufficient for team rollout

## Decision Rule

At the end of the sprint, answer this directly:

- If buyers consistently talk about approvals, auditability, shared rules, and rollout proof, stay enterprise-first.
- If buyers only want a local convenience layer and resist any team motion, keep Pro as a smaller side business and stop pretending it is the main company story.

## Related Assets

- [PITCH.md](PITCH.md)
- [COMMERCIAL_TRUTH.md](COMMERCIAL_TRUTH.md)
- [WORKFLOW_HARDENING_SPRINT.md](WORKFLOW_HARDENING_SPRINT.md)
- [marketing/team-outreach-messages.md](marketing/team-outreach-messages.md)
