## What Changed

- Summarize the user-facing or operator-facing outcome.
- List the smallest set of important files that carry the change.

## Why

- State the business outcome or reliability gain.
- Note any explicit non-goals or untouched areas.

## Verification

```bash
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

- Paste the exact commands you ran.
- Mark any intentionally skipped command and why.

## Evidence

- Link CI run(s), proof artifacts, screenshots, or report paths.
- Include `docs/VERIFICATION_EVIDENCE.md` updates when behavior changed.

## Risks

- Describe follow-up risks, rollout caveats, or external dependencies.
