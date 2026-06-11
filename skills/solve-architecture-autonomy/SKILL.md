---
name: solve-architecture-autonomy
description: Course-correct from over-planning to execution — when the agent has produced a plan, research, or options instead of doing work the user already approved, drop the analysis and execute the smallest end-to-end action now (branch, run, deploy, verify). Use when the user says "stop planning, just do it", "why are you researching, execute", "just ship it", "enough analysis", or pushes back that you keep proposing instead of acting on an already-decided task. Do NOT use when the task is genuinely undecided and needs a plan first, when the user explicitly asked for research/options/a design, or for routine work where no over-planning has occurred — acting on an unscoped or destructive task is its own failure.
diagnosis: Repeated execution failure in this domain.
status: materialized
---

# SOLVE-ARCHITECTURE-AUTONOMY Capability

## Problem
I provided a plan and research instead of immediately deploy

## Automated Diagnosis
Repeated execution failure in this domain.

## Usage
The agent should call the `handle_architecture` tool when tasks involve `architecture, autonomy, crisis, debug, deployment, error, execution, external-assessment, feedback, inefficiency, negative, railway, revenue, roi, simplification, user-frustration`.
