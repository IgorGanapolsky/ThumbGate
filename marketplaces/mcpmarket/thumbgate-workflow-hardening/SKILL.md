---
name: thumbgate-workflow-hardening
description: Audit one AI-agent workflow for repeated mistakes, install local ThumbGate gates where appropriate, and produce a proof-backed hardening report before a team rolls the workflow into production. Use when a user wants to make a Codex, Claude Code, Cursor, Gemini CLI, Amp, Cline, or OpenCode workflow safer, cheaper to supervise, and harder to repeat known failures.
---

# ThumbGate Workflow Hardening

Use this skill to harden one AI-agent workflow before the next risky command,
edit, publish, or production rollout.

ThumbGate turns repeated feedback into pre-action gates. This skill gives an
agent a repeatable operator workflow for discovering the risky loop, wiring
ThumbGate locally, proving the gate works, and producing a buyer-readable report.

## When To Use

- A team is rolling out coding agents into releases, incidents, PRs, billing,
  customer data, or compliance-sensitive workflows.
- A solo operator can name one repeated agent mistake that keeps coming back.
- A repository has ad hoc instructions, hooks, or deny lists that are not
  shared across agents.
- A buyer needs proof before trusting Codex, Claude Code, Cursor, Gemini CLI,
  Amp, Cline, or OpenCode with a workflow.

## Workflow

1. Name the workflow.
   - What agent is being used?
   - What tool calls or files can cause damage?
   - What repeated mistake has already happened?
   - Who owns the workflow?

2. Inspect local guardrails.
   ```bash
   npx -y thumbgate doctor
   ```

3. Install or repair ThumbGate if needed.
   ```bash
   npx -y thumbgate init
   npx -y thumbgate doctor
   ```

4. Capture the first concrete lesson.
   ```bash
   npx -y thumbgate capture \
     --feedback down \
     --context "Agent attempted a risky action in the named workflow" \
     --what-went-wrong "Describe the repeated mistake precisely" \
     --what-to-change "Describe the pre-action rule the agent must follow next time"
   ```

5. Prove the gate.
   - Re-run the local doctor.
   - Attempt a safe dry-run or fixture that exercises the risky pattern.
   - Record whether ThumbGate blocked, warned, or allowed the action.
   - Do not claim enforcement without command output.

6. Produce the hardening report.
   Include:
   - Workflow name and owner.
   - Repeated mistake or risk class.
   - Guardrails found before the run.
   - ThumbGate wiring status after the run.
   - Evidence commands and raw output.
   - Remaining gaps and recommended next action.

## Report Template

```markdown
# AI-Agent Workflow Hardening Report

Workflow:
Owner:
Agent/client:
Risk class:

## Repeated Failure

## Guardrails Before

## Changes Made

## Proof

Command:
Output:

## Remaining Gaps

## Recommended Next Action
```

## Buyer Fit

This skill is best for:

- founders and engineering leads adopting AI coding agents;
- platform teams protecting release, incident, and review workflows;
- consultants who need a reusable audit motion for client agent workflows;
- regulated or high-trust teams that need approval boundaries and evidence.

## Links

- Product: https://thumbgate.ai
- Setup guide: https://thumbgate.ai/guide
- Pro checkout: https://thumbgate.ai/checkout/pro
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md

## Claims Discipline

- Do not claim revenue, installs, approvals, or live enforcement without direct
  command evidence.
- Do not transmit private repository data to third parties unless the user
  explicitly approves the exact destination and data.
- Do not publish, post, message, or connect billing without action-time
  confirmation.
