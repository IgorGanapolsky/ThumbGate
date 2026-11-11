# [Feature / Change Title]

> **Spec Status**: Draft / In Progress / Approved  
> **Author**: [Author Name / Agent Role]  
> **Date**: YYYY-MM-DD  
> **Dispatch / Issue Ref**: [Issue / Task ID]

---

## Problem

[Describe the observable problem, business gap, or missing capability. What customer or operational failure happens today? Include empirical symptoms, error outputs, or business metrics that justify why this change is necessary.]

---

## Technical Plan

[Detailed technical design and execution steps:
- Architecture & component interactions
- State machines, schemas, or API contracts
- Failure modes, retries, and rollback strategy
- Edge cases and security/isolation considerations]

---

## Alternatives Rejected

| Alternative Considered | Trade-offs / Failure Modes | Reason for Rejection |
|---|---|---|
| [Option 1] | [Trade-offs] | [Why this was rejected] |
| [Option 2] | [Trade-offs] | [Why this was rejected] |

---

## Enumerated Files

[List every file that will be created, modified, or deleted by this change. Ensure zero scope creep beyond these enumerated paths.]

### Created Files
- `path/to/new-file.js`

### Modified Files
- `path/to/existing-file.js`

### Test Files
- `tests/new-feature.test.js`

---

## Acceptance Checks

[Verifiable, automated criteria that must be satisfied before this specification is marked done.]

- [ ] `npm test` passes cleanly with zero regressions.
- [ ] New unit tests cover all edge cases with deterministic assertions.
- [ ] Changeset added under `.changeset/` for release-relevant changes.
- [ ] Diff is strictly bounded (≤ 1,000 lines per atomic PR).
- [ ] No secrets, tokens, or unredacted credentials committed.
