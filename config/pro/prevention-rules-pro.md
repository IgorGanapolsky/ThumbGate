# ThumbGate Pro Prevention Rules

These public Pro rules are installed by `thumbgate pro --upgrade` into `.thumbgate/`.
They are starting points for local operator hardening, not proof that any gate has fired.

## Evidence Claims

- Require a fresh command, API response, workflow status, URL check, or billing record before completion claims.
- Treat configured checks as inventory and recorded blocks or warnings as usage evidence.
- Treat Stripe-reconciled charges as revenue proof; treat traffic and clicks as funnel evidence only.

## Code Changes

- Read the existing file and nearby tests before editing.
- Keep edits scoped to the requested behavior.
- Run narrow tests for the touched behavior before reporting success.

## Risky Actions

- Block destructive git commands unless the operator explicitly asked for the exact action.
- Block production data changes unless the target, backup, and rollback plan are explicit.
- Block checkout, publish, deploy, or customer-write claims until the live path is verified.

## Agent Workflow

- If an agent repeats a known failure, capture the failed action, expected behavior, and enforcement rule in one concise lesson.
- Prefer one workflow owner, one repeated failure, and one proof review before expanding a Team rollout.
