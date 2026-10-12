---
name: vs-coverage-gap-not-clone
description: >
  Steal VS "Today I will improve test coverage" FORMAT: baseline gaps, skip
  no-behavior files, remeasure the same scope. Do NOT clone Test Agent or
  Copilot @test #solution. Do NOT claim 100% coverage. Slash: /vs-coverage-gap-not-clone.
---

# VS coverage FORMAT — gaps, not 100%

## Goal

Produce fail-closed coverage honesty for whom: ThumbGate agents about to write
tests — so they baseline gaps in one scope, skip enums/re-exports, and remeasure
that same scope. Never 100%. Never Copilot Test Agent.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Test Agent / `@test #solution` | `npx thumbgate coverage-gap` |
| `cov-fail-under=100` / claim 100% | Floor (default 50) on **behavioral** files |
| Tests for enums, re-exports, constants-only | Skip `noBehavior` kinds |
| Remeasure a different directory | Same `--scope` before and after |
| Dual-edit `scripts/test-coverage.js` runner | Feature-detect include/exclude stays there |

## Reference

- https://devblogs.microsoft.com/visualstudio/today-i-will-improve-test-coverage/
- `scripts/coverage-gap.js`
- `scripts/test-coverage.js` (Node `--experimental-test-coverage` + feature-detect)
- `/high-roi-steal-and-finish`

## Examples (show, don't tell)

Weak: Run Copilot Test Agent on the whole repo and claim 81% → 100%.

Gold:

```bash
$ npx thumbgate coverage-gap --json --coverage=tests/fixtures/coverage-gap-before.json --scope=scripts/risk --floor=50
gaps: scripts/risk/decide.js 20%
skipped: scripts/risk/enums.js
$ npx thumbgate coverage-gap --json --before=...before.json --after=...after.json --scope=scripts/risk
ok: true
```

## Procedures

```bash
npx thumbgate coverage-gap --json --coverage=<fixture.json> --scope=scripts/<area> --floor=50
npx thumbgate coverage-gap --json --before=<a> --after=<b> --scope=scripts/<area>
npm run test:coverage-gap
npm run test:coverage   # existing runner; feature-detects include/exclude
```

1. Baseline the scoped files.
2. Skip no-behavior.
3. Write tests only for gap files.
4. Remeasure **the same scope**.
5. Refuse `--clone-test-agent` and `--claim-100`.

## Rubric

- gold compare same scope → `ok=true`
- `--claim-100` / `@test #solution` → `ok=false`
- enum-only files are skipped, not gaps
- doctor: `npm run test:coverage-gap` PASS
- evidence: command output in the same turn
