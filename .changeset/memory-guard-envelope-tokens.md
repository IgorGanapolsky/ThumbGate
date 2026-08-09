---
'thumbgate': patch
---

Stop a corrupt feedback entry from hard-blocking every action in a repository.

A truncated hook payload leaked into the feedback store and was admitted as a
recurring negative pattern. Its keywords were the payload's own field names —
`workspaceroot`, `workspace`, `thumbgate` — which appear in every payload the
agent sends. `workspaceroot` is long enough that `isSpecificKeyword()` treats it
as decisive on its own, so a single hit produced a hard deny on every `Bash`
call in the repository, including the commands needed to diagnose it. The gate
blocked 20 times and warned zero times.

Two changes:

- `keywords()` now excludes envelope tokens (hook-payload field names and the
  workspace identity). These describe the transport, never the mistake, so they
  can never be evidence of a recurring failure.
- Pattern building now rejects text that is a serialized payload fragment rather
  than a description of a mistake.

`tests/memory-guard-envelope-tokens.test.js` reproduces the exact fragment from
the incident and asserts an unrelated command is no longer denied, while a
genuine recurring pattern still blocks the action it describes.

Known follow-up: patterns built from generic prose can still over-match. A
lesson reading "test feedback on chatbot output manufacturing-copilot
test-suite" (count 10) blocks any command containing two of those common words.
That needs a discriminativeness threshold and is not addressed here.
