# RLHF Workflow Rules

- Work from a dedicated linked git worktree. Never edit the repository's primary checkout.
- Keep runtime state local and disposable. Do not modify or commit `.rlhf/**`, `.claude/worktrees/**`, or live feedback JSON/JSONL artifacts.
- Before claiming completion, run the repo verification suite:
  - `npm test`
  - `npm run test:coverage`
  - `npm run prove:adapters`
  - `npm run prove:automation`
  - `npm run self-heal:check`
- Report evidence, not assumptions. If verification fails, surface the exact failing command and output.
- For reviews, prioritize bugs, regressions, missing tests, and proof gaps before summaries.
