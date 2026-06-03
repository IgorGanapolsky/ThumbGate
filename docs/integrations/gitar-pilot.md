# Gitar Pilot for ThumbGate

Date: 2026-06-03

## Why Use It

Gitar is useful to ThumbGate as an additional AI review and CI-fix signal, not as a replacement for ThumbGate. The high-ROI overlap is:

- Gitar reviews PRs and produces actionable findings.
- ThumbGate remembers recurring findings and turns repeat failures into pre-action checks.
- The combined loop catches a mistake in review once, then blocks the same mistake before a future tool call.

## Pilot Mode

Run Gitar as non-blocking for at least the first few PRs.

1. Install the Gitar GitHub integration with repository-scoped permissions only.
2. Keep branch protection unchanged during the pilot.
3. Use `.gitar/review/` for project-specific review rules.
4. Use `.gitar/config/approve.md` to prevent Gitar-only auto-approval on high-risk ThumbGate surfaces.
5. Track every accepted Gitar finding as either:
   - a one-off code review issue, or
   - a ThumbGate lesson candidate when it is repeatable and preventable before execution.

## Metrics to Collect

| Metric | Why It Matters |
| --- | --- |
| Actionable findings per PR | Measures signal instead of comment volume |
| False positives per PR | Determines whether Gitar can become blocking |
| Repeat finding count | Identifies candidates for ThumbGate gates |
| Time from finding to fix | Tests whether auto-fix / dashboard comments reduce review drag |
| Findings converted to ThumbGate lessons | Proves the review-to-prevention loop |

## ThumbGate Lesson Flow

When Gitar finds a real issue:

```bash
npx thumbgate capture --feedback=down \
  --context="Gitar found a repeatable PR issue: <issue>" \
  --what-to-change="<pre-action rule that would prevent it>" \
  --tags=gitar,code-review,repeat-prevention
```

When the fix is verified:

```bash
npx thumbgate capture --feedback=up \
  --context="Gitar finding fixed and verified: <issue>" \
  --what-worked="<test, CI check, or command that proves the fix>" \
  --tags=gitar,code-review,action-receipt
```

## Install Boundaries

Gitar needs repository access to review PRs and can write comments. Treat that as an external automation with write permissions:

- Do not give it organization-wide access until the pilot has measured false positives.
- Do not let it auto-merge.
- Do not let it become the only reviewer for release, billing, secret, gate, hook, or cloud mutations.
- Keep GitGuardian, Socket, CodeQL, SonarCloud, CI, and ThumbGate gates active.

## Decision Rule

Promote Gitar from advisory to required only if the pilot shows:

- recurring high-signal findings,
- low false positives,
- no noisy duplicate comment patterns,
- no unsupported public-claim approvals,
- and at least one finding converted into a ThumbGate prevention rule.

