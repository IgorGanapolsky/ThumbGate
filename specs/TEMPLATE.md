# Spec: <short title>

> Copy this file to `specs/NNN-<kebab-name>/spec.md`. A spec is the source of truth for a
> milestone — **code serves the spec, not the reverse.** See [`docs/PROJECT_MANAGEMENT.md`](../docs/PROJECT_MANAGEMENT.md).

```yaml
id: NNN
use_case: <the why — one line>
milestone: <the shippable outcome>
status: draft        # draft | approved | in-progress | shipped
owner: CEO
created: YYYY-MM-DD
```

## 1. Outcomes
What is observably true when this is done. State results, not "implement X."

## 2. Scope boundaries
- **In scope:** …
- **Out of scope (explicitly):** … — naming what we will NOT do is half the spec.

## 3. Constraints
Hard limits: budget, security, gated/approval-required actions, do-not-touch areas, prior
commitments the work must respect.

## 4. Prior decisions
Decisions already made + links (memory notes, past PRs) so agents don't relitigate settled ground.

## 5. Task breakdown
Atomic, one-agent-sized tasks. Each becomes one issue → one branch → one PR.
- [ ] T1 …
- [ ] T2 …

## 6. Verification criteria (acceptance)
How we **prove** each outcome — a deterministic check per outcome. "Done" means this passes; no
guesswork, no self-report.
- Outcome A → check: `<command / test / observable that returns pass/fail>`
