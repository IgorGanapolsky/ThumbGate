---
name: ai-agent-operating-model
description: "Repeatable operating model for AI coding work: define use cases, milestones, phases, agent-ready issues, token-burn reviews, CI proof, and memory updates before claiming completion."
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
---

# AI Agent Operating Model

Use this skill when planning, executing, or reviewing AI coding work for
ThumbGate, especially when the request mentions project management, milestones,
phases, multiple agents, token burn, CI, trust, or "are you sure?".

## Start Here

1. Read `docs/AI_CODING_PROJECT_MANAGEMENT_2026.md`.
2. Treat GitHub Issues/Projects/PRs as the source of truth unless the CEO
   explicitly chooses Linear for a higher-volume agent queue.
3. Convert broad asks into:
   `use case -> milestone -> phase -> agent-ready issue -> PR proof packet`.
4. Before coding, write or identify acceptance criteria and verification gates.

## Required Work Shape

Every agent-ready issue or PR must carry:

- Use-case bucket: revenue-truth, agent-reliability, governance,
  distribution, enterprise-pilot, or operator-productivity.
- Milestone: measurable outcome, not an activity label.
- Phase: discover, design, build, verify, release, or observe.
- Risk tier: P0/P1/P2/P3 with rollback path.
- Token-cost budget: expected burn, stop condition, and why the work is worth it.
- Proof: tests, CI links, screenshots, telemetry, or deterministic evidence.

## Token-Burn Review

When a task involves agent fleets, long sessions, or automation:

1. Check the dashboard token burn panel or run the token-burn tests.
2. Compare burn against output quality: merged PRs, fixed failures, revenue
   evidence, or customer conversations.
3. Stop or split work when a loop burns tokens without new evidence.
4. Record the lesson in memory if the pattern should influence future sessions.

## Completion Rule

Never say "done" for agent work until:

- The PR/branch is linked.
- Targeted tests are listed and passed.
- Required CI status is checked.
- Any package-boundary or public-repo-hygiene ratchet bump is measured and
  justified.
- The durable lesson is written to memory or captured through ThumbGate when it
  would prevent a repeat mistake.

## Useful Commands

```bash
npm run test:ai-project-management
npm run test:token-burn
node --test tests/package-boundary.test.js tests/public-bundle-ratchet.test.js tests/public-core-boundary.test.js
```
