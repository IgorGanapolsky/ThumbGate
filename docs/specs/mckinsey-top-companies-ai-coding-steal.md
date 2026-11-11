# McKinsey "What Top Companies Do Differently With AI Coding": Architecture Steal

> **Spec Status**: Draft
> **Author**: Agent (poolside goal-contract thread), template sections added by the PR sweeper
> **Date**: 2026-11-11
> **Dispatch / Issue Ref**: PR #4903

**Source**: McKinsey & Company, *What the Top Companies Do Differently With AI Coding* (Martin Harrysson, Prakhar Dixit, Shilpa; Nov 2026).
**Video Reference**: `https://www.youtube.com/watch?v=21tuT-e4NVo`

Every number in this spec is either McKinsey's reported figure (attributed as such) or marked **UNKNOWN** because ThumbGate has not measured it. Each capability is marked **EXISTS** (in `main` today, with the file) or **PLANNED** (not built yet).

---

## Problem

McKinsey reports that average enterprises see a 10–20% tactical code-generation gain alongside a 20–30% rise in PR review queues and production incidents, while top organizations reach about 2x end-to-end delivery improvement (McKinsey's figures, not ours). They attribute the gap to five operating shifts, not model scale:

1. **Operating model**: 1–2 day continuous loops with agentic "night shifts" instead of 2-week sprints.
2. **Team structure**: 2–4 person pods with Definers and Builders and trained code review.
3. **Context engineering**: curated "golden examples" instead of the codebase average.
4. **Removing sideways friction**: security, compliance and architecture rules enforced at agent pre-action time instead of multi-week manual gates.
5. **AIOps and value scoring**: token spend tracked against business value.

ThumbGate already covers parts of 3 and 4. The gap is that these pieces are not wired into one pipeline, and we have no measurement showing whether they move lead time or token spend for ThumbGate users. Current ThumbGate baselines for lead time, review load and token spend are **UNKNOWN**.

---

## Technical Plan

| McKinsey shift | ThumbGate mapping | Status |
|---|---|---|
| 1–2 day night-shift loops | `scripts/mac-dispatch-loop.js` polls `ready-for-agent` issues and runs them on the operator's Mac | EXISTS |
| Standardized spec inputs | `docs/specs/TEMPLATE.md` + `tests/spec-template.test.js` | EXISTS |
| Golden examples over averages | `scripts/verified-lessons.js` has verification, staleness and demotion (`isLessonStale`, `isLessonDemoted`) | EXISTS (partial) |
| | A `qualityTier: "golden"` tier and a `preferGoldenExamples` retrieval option | PLANNED |
| Sideways rules as pre-action gates | `gate_check` with `scripts/secret-scanner.js`, `scripts/self-protection.js`, `scripts/pr-size-check.js` (≤1,000 changed lines) | EXISTS |
| Curated skill governance | MCP profiles in `config/mcp-allowlists.json` (`essential`, `readonly`, `dispatch`, `locked`, …) | EXISTS |
| | A smaller "lean" profile limited to the core feedback and gate tools | PLANNED |
| Builder–Reviewer–Verifier pipeline | A `scripts/builder-reviewer-verifier.js` state machine | PLANNED (file does not exist yet) |
| Token ROI and value scoring | `scripts/token-tco.js` computes cost per million tokens and value-vs-cost ROI | EXISTS |
| | Margin per 1,000 tokens = attributable contribution profit ÷ attributable tokens × 1,000, used to route low-value tasks to cheaper models | PLANNED |

### Pipeline (target design)

1. **Definer**: validate the issue or spec against `docs/specs/TEMPLATE.md`; attach verified lessons.
2. **Builder** (night shift): isolated worktree per task; every shell and file edit passes `gate_check`; tests run continuously.
3. **Reviewer / Verifier**: adversarial review plus SonarCloud and `pr-size`; attach a proof pack.
4. **Human harvest** (morning): draft PR with evidence receipts; a human merges. No unapproved merges.

### Failure modes and rollback

- A gate that blocks too much stalls the night shift: every new gate ships in warn-only mode first and is promoted only with a measured false-positive rate.
- Golden-example ranking that hides a correct lesson: retrieval keeps returning non-golden lessons as a fallback.
- Every PLANNED item lands as its own PR under 1,000 changed lines and can be reverted on its own.

---

## Alternatives Rejected

| Alternative Considered | Trade-offs / Failure Modes | Reason for Rejection |
|---|---|---|
| Keep manual cross-team review for security and architecture rules | Slow and inconsistent; McKinsey cites it as the main source of sideways friction | Rules that can be checked deterministically belong in pre-action gates |
| Feed agents the whole codebase as context | Reproduces legacy patterns and costs more tokens | Curated, verified lessons are cheaper and more precise |
| Expose every MCP tool in every profile | More tool-call churn and context overhead | Profiles already exist; a lean profile narrows further |
| Auto-merge agent PRs without human review | Fastest path | Conflicts with ThumbGate's branch-protection rules; the human merge stays |

---

## Enumerated Files

### Created Files
- `docs/specs/mckinsey-top-companies-ai-coding-steal.md` (this spec)

### Modified Files
- None in this PR. Each PLANNED item gets its own spec-backed PR touching:
  - `scripts/verified-lessons.js` (golden tier and retrieval option)
  - `config/mcp-allowlists.json` (lean profile)
  - `scripts/builder-reviewer-verifier.js` (new BRV state machine)
  - `scripts/token-tco.js` (margin per 1,000 tokens)

### Test Files
- `tests/spec-template.test.js` (this spec must pass it)

---

## Acceptance Checks

- [ ] `npm test` passes, including `tests/spec-template.test.js` for this file.
- [ ] Every PLANNED row above has a linked PR before it is marked EXISTS.
- [ ] Baselines are measured before any improvement claim: issue-to-verified-PR lead time, PR review load, and tokens per task. Until then every outcome target stays **UNKNOWN**.
- [ ] Any reduction claim (lead time, token burn, context size) cites a measured before-and-after from production telemetry, not a projection.
- [ ] No unapproved merges: agent PRs still need a human merge under branch protection.
