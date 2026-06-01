# Skool 7-Day Onboarding Drip — ThumbGate Operator Lab (2026-06-01)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Skool group: https://www.skool.com/thumbgate-operator-lab-6000

Goal: ship a lightweight, text-first onboarding sequence that (1) makes the Reliability Gateway loop concrete, (2) routes high-intent members into Pro vs Diagnostic vs Sprint, and (3) invites workflow sharing so we can convert pain → proof.

## Day 0 (Pinned): Start Here (offer ladder)

Use: `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-06-01.md`

## Day 1: The Reliability Gateway loop (what we do here)

Title: The Reliability Gateway: stop repeating the same mistake

Body:

ThumbGate is an Infrastructure Firewall for AI-agent workflows.

The loop is simple:

1) capture the mistake (feedback)
2) distill it into a lesson (memory)
3) promote it into an enforceable Pre-Action Gate (rule)
4) generate verification evidence (proof)

If you drop your workflow + where it breaks, I’ll help you pick the first “one mistake → one gate → one proof run”.

CTA:
- Sprint intake (if one workflow is already painful): https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Setup guide (if you want to self-serve first): https://thumbgate-production.up.railway.app/guide

## Day 2: The 3 failure modes that keep costing teams time

Title: 3 repeat failures that ruin agent workflows (and how to harden them)

Body:

Most “agent failures” are actually workflow failures:

- wrong file changed (scope drift)
- unsafe tool call (blast radius)
- “looks right” output that doesn’t survive proof (verification gap)

Pick the one you keep seeing and post:
- the exact moment it fails
- what you wish had been blocked
- what “proof” would look like

If scope is unclear, we route through the Diagnostic first.

CTA:
- Intake (Diagnostic vs Sprint routing): https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## Day 3: One real example (template you can copy)

Title: Copy/paste template: turn one mistake into a gate

Body:

Copy/paste and fill this in:

- Workflow: (what you’re trying to ship)
- Agent surface: (Claude / Codex / Gemini / Cursor / etc.)
- Repeated mistake: (what keeps happening)
- Worst-case blast radius: (what could it break)
- “Block it when”: (the pre-action condition)
- Proof: (what would convince you it’s fixed)

If you reply with your filled template, I’ll suggest the first gate and the smallest proof run.

CTA:
- Pro (self-serve gates + exports): https://thumbgate-production.up.railway.app/checkout/pro

## Day 4: Why “guardrails” break (and what replaces them)

Title: Why brittle prompt guardrails fail (and what works instead)

Body:

Prompt-only guardrails are brittle because context shifts.

If you want reliability, you need:
- an explicit pre-action check (block known-bad tool calls)
- a memory of what failed last time (so you don’t re-learn it)
- proof artifacts (so it’s defensible)

Drop a workflow where your guardrails keep breaking and we’ll pick the first enforceable check.

CTA:
- Sprint intake (one workflow, one owner, one proof review): https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## Day 5: Proof packs (what “real” evidence looks like)

Title: Proof packs: what we can actually claim

Body:

In ThumbGate we don’t claim outcomes without evidence.

Engineering proof is anchored in:
- `docs/VERIFICATION_EVIDENCE.md`
- `proof/compatibility/report.json`
- `proof/automation/report.json`

In your workflow, “proof” usually means:
- the repeated failure stops repeating
- you can show the gate that blocked it
- you can rerun the verification steps

If you share your “proof criteria”, I’ll suggest a minimal proof run.

CTA:
- Setup guide: https://thumbgate-production.up.railway.app/guide

## Day 6: Offer ladder routing (Pro vs Diagnostic vs Sprint)

Title: Which lane should you pick? (Pro vs Diagnostic vs Sprint)

Body:

Fast routing:

- **Sprint** when you already have one workflow owner + repeated failure + rollout/approval risk.
- **Diagnostic** when the pain is real but scope is unclear.
- **Pro** when you want the self-serve tool path first.

If you comment with:
- workflow + agent surface
- what keeps breaking
- whether you’re solo or team

…I’ll route you to the right lane with next steps.

CTA:
- Sprint/Diagnostic routing intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro

## Day 7: Ask for workflow posts (conversion trigger)

Title: Post your workflow: I’ll help you harden it

Body:

If you want help, post:

1) what the workflow is
2) where it breaks (the repeat failure)
3) what needs to be blocked before it happens again
4) what proof would convince you it’s fixed

I’ll reply with:
- the first pre-action gate
- the smallest proof run
- whether you should go Pro vs Diagnostic vs Sprint

CTA:
- Sprint intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
