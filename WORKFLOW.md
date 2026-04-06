---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: 'thumbgate'
  active_states:
    - 'Ready for Agent'
    - 'In Progress'
  terminal_states:
    - 'Human Review'
    - 'Done'
    - 'Closed'
    - 'Cancelled'
    - 'Canceled'
    - 'Duplicate'
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    git clone --depth 1 https://github.com/IgorGanapolsky/thumbgate.git .
    npm ci
  before_run: |
    git fetch origin --prune
  after_run: |
    git status --short
  timeout_ms: 600000
agent:
  max_concurrent_agents: 3
  max_turns: 8
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    'ready for agent': 2
    'in progress': 1
codex:
  command: 'codex app-server'
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
---

# ThumbGate Agent Workflow

You are implementing work inside the `thumbgate` repository. Deliver the ticket outcome with no dead code, no vague completion claims, and proof that the result works.

## Scope

- Allowed files: `src/`, `scripts/`, `tests/`, `docs/`, `.github/`, `README.md`, `WORKFLOW.md`, and package metadata required by the task.
- Allowed changes must stay inside the bounded issue scope. If the ticket is only about docs, do not change product code. If the ticket is only about one subsystem, do not refactor unrelated modules.
- Preserve the repo's style rules: two-space indentation, single-quoted strings, and minimal comments.

## Hard Stops

- Never edit secrets, tokens, billing identifiers, or production Stripe configuration unless the issue explicitly requires it.
- Never disable tests, remove proof commands, or weaken verification to make a change pass.
- Never leave TODOs, commented-out experiments, orphaned helpers, or unused files behind.
- Never claim a task is complete without command output and artifact paths that prove it.

## Required Proof of Work

Run targeted tests first while iterating, then run the full release gate before handoff:

```bash
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

If behavior changes, update `docs/VERIFICATION_EVIDENCE.md` with the exact commands you ran and the observed result. If a proof script supports temp output overrides, prefer them during local iteration and only write tracked artifacts for final evidence.

## Implementation Rules

- Start from the issue's business outcome, acceptance criteria, and explicitly listed in-scope files.
- Add or update tests whenever behavior changes. Tests are part of the deliverable, not optional cleanup.
- Prefer deletion over retention for dead code. If a helper or file no longer earns its keep, remove it in the same change.
- Keep changes incremental and reviewable. Avoid sprawling refactors unless the issue explicitly requires them.
- Use the hosted landing page, checkout, and proof surfaces only when they are part of the task. Otherwise leave monetization wiring untouched.

## Done Means

A task is done only when all of the following are true:

1. The requested behavior exists and matches the ticket.
2. No dead code, stale docs, or unused scaffolding were introduced.
3. The relevant tests pass.
4. The full proof gate passes.
5. The PR or handoff includes a concise walkthrough, changed files, exact commands run, and artifact paths.

## Handoff Format

Return a short completion note with:

1. Outcome: what changed and why it matters.
2. Files: the small set of files that carry the change.
3. Verification: exact commands run and whether they passed.
4. Evidence: report paths, CI links, or screenshots when applicable.
