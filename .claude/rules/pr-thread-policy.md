# PR Thread Verification Policy

## Rule: Zero Open Threads Before Completion

After every `git push`, you MUST:

1. Run `gh pr view --json reviewDecision,comments,reviewThreads` and quote the output
2. Confirm **0 unresolved review threads** before any completion statement
3. If new Copilot or reviewer threads appeared after push, address them before declaring done

## Prohibited Phrases Without Evidence

Never say any of the following without first showing `gh pr view` output:

- "Done"
- "Pushed and ready"
- "All comments addressed"
- "Ready for review"
- "Fixed and pushed"
- "Resolved"

## Post-Push Checklist

```
1. git push → wait for CI
2. gh pr view --json reviewDecision,comments → quote result
3. If unresolved > 0 → fix and re-push
4. Only then → "Done. 0 unresolved threads. CI green."
```

## Why

Copilot and human reviewers add threads asynchronously after push. Declaring done without re-checking causes review loops and missed feedback. The RLHF pipeline tracks this as a recurring failure pattern.
