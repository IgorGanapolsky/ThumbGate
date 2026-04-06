# PR Thread Verification Policy

## Rule: Zero Open Threads Before Saying "Done"

After every `git push`, run this exact command and show the output:

```bash
gh pr view --json reviewDecision,comments,reviewThreads --jq '{decision: .reviewDecision, comments: (.comments | length), threads: ([.reviewThreads[] | select(.isResolved == false)] | length)}'
```

Expected output for a clean PR:
```json
{"decision":"APPROVED","comments":0,"threads":0}
```

If `threads` > 0: fix the issues, push again, re-run the command.

## Blocked Phrases

Never say these words without first showing the `gh pr view` output above:

- "Done"
- "Pushed and ready"
- "All comments addressed"
- "Ready for review"
- "Fixed and pushed"
- "Resolved"

## Full Post-Push Sequence

```bash
# 1. Push
git push

# 2. Wait for CI to start (5-10 seconds)
gh pr checks --watch

# 3. Check threads
gh pr view --json reviewDecision,comments,reviewThreads \
  --jq '{decision: .reviewDecision, comments: (.comments | length), threads: ([.reviewThreads[] | select(.isResolved == false)] | length)}'

# 4. Only if threads=0 AND CI green → say "Done. 0 unresolved threads. CI green."
```

## Why This Exists

Copilot and human reviewers add threads asynchronously after push. Declaring done without re-checking causes review loops. This was identified as a recurring failure pattern in the ThumbGate pipeline.
