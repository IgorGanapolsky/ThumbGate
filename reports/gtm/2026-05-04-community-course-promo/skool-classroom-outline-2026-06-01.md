# Skool Classroom Outline — Operator Lab (2026-06-01)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Purpose: a text-first classroom outline that can be pasted into Skool as lessons/modules without depending on direct video uploads.

## Positioning (1 sentence)

Turn one repeated AI-agent mistake into one enforceable Pre-Action Gate plus proof you can defend.

## Module 0 — Start Here (10 minutes)

**Outcome:** you can post a real failure with enough context to diagnose.

- Post template:
  1. Agent/tool (Claude Code, Codex, Cursor, Gemini CLI, Amp, OpenCode, MCP):
  2. Repo/workflow:
  3. The mistake it keeps repeating:
  4. The correct behavior:
  5. Risk surface (deploy? data? approvals?):
  6. What proof would convince you it’s fixed:
- Link: Pro setup guide (self-serve): `https://thumbgate-production.up.railway.app/guide`

## Module 1 — Reliability Gateway loop (15 minutes)

**Outcome:** you understand the loop we run in Operator Lab.

- Capture feedback → distill lessons → promote into checks → block risky actions → run proof.
- Key terms (use these in posts and notes):
  - Infrastructure Firewall
  - Reliability Gateway
  - Pre-Action Gate (PreToolUse check)
  - Verification Evidence

## Module 2 — Capture feedback that is usable (15 minutes)

**Outcome:** you can capture one event that’s specific enough to become a rule.

- Good feedback contains:
  - the exact wrong behavior
  - the desired behavior
  - the trigger/context (which file, which command, which tool call)
  - the consequence (why it mattered)
- Bad feedback to avoid:
  - “this is wrong” with no details
  - “vibes” without an observable failure mode

## Module 3 — Promote into enforcement (20 minutes)

**Outcome:** you can define a gate that blocks the repeat mistake.

- Inputs:
  - a concrete policy (“never delete without confirmation”, “never run migrations on prod”, etc.)
  - a detection signal (command pattern, path, environment, repo state)
  - an escalation path (block → ask → allow with justification)
- Deliverable in Operator Lab:
  - one narrow rule + a testable check for it

## Module 4 — Proof pack that sells (15 minutes)

**Outcome:** you can produce evidence that the mistake stopped repeating.

- Proof anchors (don’t improvise):
  - `docs/VERIFICATION_EVIDENCE.md`
  - `proof/compatibility/report.json`
  - `proof/automation/report.json`
- Minimum proof for a rule:
  - “before” reproduction steps
  - “after” blocked/redirected behavior
  - a verification command that stays green

## Module 5 — Routing: Pro vs Diagnostic vs Sprint (10 minutes)

**Outcome:** you route yourself (or a teammate) to the right offer quickly.

- Pro (`$19/mo` or `$149/yr`): self-serve tool + exports lane.
- Diagnostic (`$499`): scope unclear; pay to map workflow + define the gate/proof plan.
- Sprint (`$1500`): one workflow owner + repeated failure + rollout risk + buyer wants proof.
- Intake (Diagnostic/Sprint): `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`

## Optional lesson templates (copy/paste)

- “Mistake → Gate” worksheet
  - Mistake:
  - What it breaks:
  - What to block:
  - What to allow (with constraints):
  - Proof I’ll run:

