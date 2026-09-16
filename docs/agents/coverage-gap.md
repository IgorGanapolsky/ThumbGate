# Coverage-gap honesty (VS FORMAT steal)

Doctor: `npx thumbgate coverage-gap --json`

Steals **baseline → skip no-behavior → remeasure same scope** from [Today I will… improve test coverage](https://devblogs.microsoft.com/visualstudio/today-i-will-improve-test-coverage/) (Aaron Powell / Visual Studio). Compare-not-clone. Not affiliated with Visual Studio, GitHub Copilot, or Test Agent.

Does **not** clone `@test #solution`. Does **not** enforce `cov-fail-under=100`. Does **not** claim 100% coverage.

## Map

| VS analog | ThumbGate |
|-----------|-----------|
| Analyze Code Coverage (baseline) | `coverage-gap --coverage=` then `npm run test:coverage` |
| Skip `AgentMode.cs` enum | `classifySource` → enum/reexport/constants/empty |
| Remeasure after tests | `--before` / `--after` **same `--scope`** |

## Fail closed

`vs_test_agent_clone_refused` · `claim_100` · `scope_drift` · `gaps_grew` · `pct_dropped`

## CLI

```bash
npx thumbgate coverage-gap --json --coverage=tests/fixtures/coverage-gap-before.json --scope=scripts/risk --floor=50
npx thumbgate coverage-gap --json --before=tests/fixtures/coverage-gap-before.json --after=tests/fixtures/coverage-gap-after.json --scope=scripts/risk
npm run test:coverage-gap
```

Skill: `.agents/skills/vs-coverage-gap-not-clone/SKILL.md`
