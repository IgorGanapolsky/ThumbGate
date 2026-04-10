# Gate Configuration

## Default Gates

ThumbGate ships with sensible defaults that block common dangerous patterns:

| Gate | Blocks | Severity |
|------|--------|----------|
| `no-force-push` | `git push --force` to protected branches | critical |
| `no-drop-table` | `DROP TABLE` in production contexts | critical |
| `no-skip-tests` | Claiming "done" without test evidence | high |
| `no-delete-main` | Deleting main/master branch | critical |

## Auto-Promoted Gates

When you give repeated thumbs-down on similar failures, ThumbGate auto-promotes
them into prevention gates via Thompson Sampling:

1. First thumbs-down: stored as a lesson
2. 2+ similar failures: pattern detected, rule generated
3. 3+ similar failures: rule promoted to hard gate (PreToolUse block)

## Thompson Sampling Calibration

Each gate category has a reliability score from Beta(alpha, beta):

| Calibration | Samples | Meaning |
|-------------|---------|---------|
| `none` | 0 | Pure prior (0.5 reliability) |
| `low` | 1-4 | Speculative |
| `medium` | 5-19 | Usable |
| `high` | 20+ | Trustworthy |

Decay: 7-day half-life with exponential weighting. Recent feedback matters more.

## Custom Gates (Pro)

Pro users can create custom gates beyond the defaults:

```bash
# Example: block any npm publish without version bump
node scripts/gates-engine.js add \
  --name="require-version-bump" \
  --pattern="npm publish" \
  --unless="package.json version changed" \
  --severity=high
```

## Gate Categories

Default categories for Thompson Sampling:

- `code_edit` — source code modifications
- `git` — version control operations
- `testing` — test execution and verification
- `pr_review` — pull request workflows
- `search` — code search and discovery
- `architecture` — structural decisions
- `security` — security-sensitive operations
- `debugging` — diagnostic workflows

## Checking Gate Status

```bash
# View all active gates and their reliability
npm run feedback:rules

# See which gates fired recently
npm run gate:stats 2>/dev/null || node -e "
  const {getGateStats} = require('./scripts/gates-engine');
  console.log(JSON.stringify(getGateStats(), null, 2));
"
```
