# ThumbGate Project Management — Spec-Driven, Eval-Gated, Agent-Orchestrated

Adopted 2026-06-07. This is the operating system for how work gets **defined**, **executed by AI
agents**, and **verified** at ThumbGate. It is the June-2026 consensus methodology for agentic
development: **Spec-Driven Development (SDD)** + **eval-driven verification** + **manager-of-agents
orchestration**.

## Why this exists (the failures it prevents)

ThumbGate is built with heavy use of AI coding agents (Claude Code, Codex, …) that open PRs and
merge through a Trunk queue. Three failure modes this system must prevent:

1. **Parallel-agent races** — multiple agents editing overlapping files or branches with no shared
   source of truth, producing duplicate or conflicting changes.
2. **Overclaim** — agents (and humans) reporting "done / shipped / deployed" before it is verified.
3. **No single view of work** — nothing showing what every agent is doing right now.

## The pipeline: use-case → milestone → phase → task → execute

Each layer produces a **versioned Markdown artifact** that becomes the next layer's input. Agents
read structured context, never ad-hoc prompts.

| Layer | Question | Artifact | Owner | Location |
|---|---|---|---|---|
| **Use-case** | Why | one-line outcome + principles | CEO | `specs/constitution.md` |
| **Milestone** | What ships | **Spec** (6 elements incl. acceptance criteria) | CEO drafts, agent refines | `specs/NNN-name/spec.md` |
| **Phase** | How | **Plan** | Agent, CEO approves | `specs/NNN-name/plan.md` |
| **Task** | Atomic, one-agent-sized | **Tasks** (each with its own check) | Agent | `specs/NNN-name/tasks.md` |
| **Execute** | Build | branch → PR → Trunk | Agent | GitHub |

Every spec MUST contain the **6 elements** (see [`specs/TEMPLATE.md`](../specs/TEMPLATE.md)):
outcomes, scope boundaries, constraints, prior decisions, task breakdown, **verification criteria**.

## The verification gate (anti-overclaim)

"Done" is not a claim — it is a passing check. Acceptance criteria are defined **before** code is
written. A task is done only when **all three** hold:

1. **Deterministic check** passes (a test / CI job / a command that exits 0), and
2. **ThumbGate claim-gate** is satisfied (no "done/shipped/deployed" without paired evidence), and
3. **Human approval** (CEO) for anything outward-facing — public content, external PRs, deploys,
   account or billing changes.

This mirrors the 2026 eval-driven standard: deterministic checks + model grading + human review.

## Race-prevention rules (hard)

- **One issue = one agent = one branch = one PR.** An in-progress issue is assignment-locked.
- **Branch from the latest `main` every time** — never from another in-flight branch.
- **Trunk owns the merge.** Never two writers on one branch.
- **The board is the single source of truth.** Claim the issue before starting work.

## Tooling

- **Methodology:** GitHub Spec-Kit (SDD CLI, integrates Claude Code) — or the in-repo `specs/`
  structure that ships with this doc.
- **Work tracking:** GitHub Issues + Projects now (free, native). Upgrade to **Linear** (agents are
  assignable workspace members; planning + execution stay synced) when agent volume justifies it.
- **Orchestration:** Claude Code subagents; one orchestrator splits objectives into independent
  issues and dispatches agents.
- **Enforcement:** ThumbGate's own gates — claim-verification, `stateful-helper-script-bypass`,
  task-scope — *are* the verification layer. We dogfood our product as the PM safety system.

## Roles

- **CEO = orchestrator + approver.** Writes use-cases and specs, approves plans, gates
  outward-facing actions.
- **Agents = implementers.** Turn spec → plan → tasks → PR, carrying verification with each task.

## Status values

- Spec: `draft | approved | in-progress | shipped`
- Task: `todo | in-progress | blocked | done` — where **done = the acceptance check passed.**
