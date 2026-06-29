# Greptile Code Review Integration

Greptile should complement ThumbGate, not replace it.

## Role Split

- Greptile: repo-aware pull request review, changed-code analysis, and codebase graph context.
- ThumbGate: learned prevention rules, approval gates, feedback capture, and release proof.

## Operator Workflow

1. Run Greptile before publishing or opening a PR:
   ```bash
   greptile review --agent
   ```
2. Save machine-readable findings for evidence:
   ```bash
   greptile review --json > reports/greptile-review.json
   ```
3. Convert repeatable findings into ThumbGate feedback:
   ```bash
   npx thumbgate capture \
     --feedback=down \
     --context="Greptile found a repeatable review issue before release." \
     --what-went-wrong="<finding summary>" \
     --what-to-change="<prevention rule>"
   ```
4. Regenerate gates and rerun release proof:
   ```bash
   npm run test:e2e
   npm run test:coverage
   ```

## CI Gate Proposal

- Start with advisory mode: run `greptile review --agent` in PR checks and attach output as an artifact.
- Promote to blocking mode only after two green weeks and a false-positive review.
- Feed confirmed Greptile findings into ThumbGate so the same mistake becomes a local pre-action gate.

## Local Setup

Greptile CLI is published as `greptile` on npm. Its readme lists:

```bash
npm install -g greptile
greptile login
greptile review
```

The npm CLI readme notes Node 22 or newer for npm/script installs. If the local runtime is older, use their Homebrew install path instead.
