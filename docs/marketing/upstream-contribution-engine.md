# Upstream Contribution Engine

Use this to earn developer trust by fixing repos ThumbGate actually depends on. This is not a spam lane.

Status: actionable
Repos scanned: 8
Issues ranked: 40
Autofix-ready: 4

## Guardrails

- Only target repos ThumbGate actually depends on or uses in shipped workflows.
- Do not create promotional PRs; fix real upstream issues with tests.
- Prefer small bugs, tests, docs, types, CI flakes, and security hardening over large feature work.
- Open external PRs only after reproduction evidence, a minimal patch, and upstream tests pass.
- Never paste secrets, customer data, or private ThumbGate context into upstream issues or PRs.

## Autonomous Workflow

- Run live discovery on schedule and rank only dependency-backed upstream repos.
- Clone/fork the highest autonomous-patch-ready issue into the suggested branch.
- Capture reproduction, apply the smallest patch, and run upstream tests.
- Open a public PR only when the evidence gate is autonomous-patch-ready and proof artifacts exist.
- Stop at a local worktree and operator report when the issue is high-risk, security-sensitive, or unreproduced.

## Top Opportunities

- apache/arrow#49760 (71, claimed-or-existing-pr) [Doc] Document bugs vs security vulnerabilities
  https://github.com/apache/arrow/issues/49760
  Branch: codex/upstream-apache-arrow-49760
  Blockers: issue appears to have an existing PR or proposal
- apache/arrow#49241 (71, claimed-or-existing-pr) [Docs] Improve Security Considerations Documentation - include pointer to validation functions for validating IPC streams.
  https://github.com/apache/arrow/issues/49241
  Branch: codex/upstream-apache-arrow-49241
  Blockers: issue appears claimed in comments; issue appears to have an existing PR or proposal
- lancedb/lancedb#1672 (63, autonomous-patch-ready) bug(python): can not handle bad embedding function output
  https://github.com/lancedb/lancedb/issues/1672
  Branch: codex/upstream-lancedb-lancedb-1672
- lancedb/lancedb#1653 (63, claimed-or-existing-pr) bug(python): failed to infer column name from the schema
  https://github.com/lancedb/lancedb/issues/1653
  Branch: codex/upstream-lancedb-lancedb-1653
  Blockers: issue appears to have an existing PR or proposal
- WiseLibs/better-sqlite3#988 (63, triage-before-pr) Getting an Electron crash, not sure how to further debug - help needed!
  https://github.com/WiseLibs/better-sqlite3/issues/988
  Branch: codex/upstream-better-sqlite3-988
- apache/arrow#40816 (61, triage-before-pr) [C++] Security checks and relaxing hashjoin batch rows size
  https://github.com/apache/arrow/issues/40816
  Branch: codex/upstream-apache-arrow-40816
- apache/arrow#35846 (61, triage-before-pr) Minimum required numpy version (1.16.6) has security vulnerability
  https://github.com/apache/arrow/issues/35846
  Branch: codex/upstream-apache-arrow-35846
- googleapis/js-genai#1278 (55, autonomous-patch-ready) error: Leaks detected:   - A fetch response body was created during the test, but not consumed during the test. Consume or close the response body `ReadableStream`, e.g `await resp.text()` or `await resp.body.cancel()`.
  https://github.com/googleapis/js-genai/issues/1278
  Branch: codex/upstream-google-genai-1278
- apache/arrow#49465 (55, autonomous-patch-ready) [C++][FlightRPC] Arrow Flight timeout test failure on MSVC Windows
  https://github.com/apache/arrow/issues/49465
  Branch: codex/upstream-apache-arrow-49465
- huggingface/transformers.js#171 (48, claimed-or-existing-pr) [Doc request] Add an example guide of how to use it in Svelte (and deploy to HF Spaces)
  https://github.com/huggingface/transformers.js/issues/171
  Branch: codex/upstream-huggingface-transformers-171
  Blockers: issue appears to have an existing PR or proposal
- lancedb/lancedb#3262 (48, claimed-or-existing-pr) test(python): add integration tests for datetime timezone handling in `lit()`
  https://github.com/lancedb/lancedb/issues/3262
  Branch: codex/upstream-lancedb-lancedb-3262
  Blockers: issue appears claimed in comments
- lancedb/lancedb#3212 (48, claimed-or-existing-pr) feat(python): support more types in `lit()`
  https://github.com/lancedb/lancedb/issues/3212
  Branch: codex/upstream-lancedb-lancedb-3212
  Blockers: issue appears claimed in comments
- WiseLibs/better-sqlite3#1224 (48, autonomous-patch-ready) CI: Run test in Electron as well
  https://github.com/WiseLibs/better-sqlite3/issues/1224
  Branch: codex/upstream-better-sqlite3-1224
- changesets/changesets#517 (47, claimed-or-existing-pr) CI builds fail with "does master exist?"
  https://github.com/changesets/changesets/issues/517
  Branch: codex/upstream-changesets-changelog-github-517
  Blockers: issue appears claimed in comments; issue appears to have an existing PR or proposal
- changesets/changesets#517 (47, claimed-or-existing-pr) CI builds fail with "does master exist?"
  https://github.com/changesets/changesets/issues/517
  Branch: codex/upstream-changesets-cli-517
  Blockers: issue appears claimed in comments; issue appears to have an existing PR or proposal
- anthropics/anthropic-sdk-typescript#964 (45, claimed-or-existing-pr) Bug: `toolRunner` does not propagate `container.id` across iterations, and `setMessagesParams` causes duplicate tool call loops
  https://github.com/anthropics/anthropic-sdk-typescript/issues/964
  Branch: codex/upstream-anthropic-ai-sdk-964
  Blockers: issue appears to have an existing PR or proposal
- anthropics/anthropic-sdk-typescript#381 (45, triage-before-pr) [Tools SDK BUG in Response] Using tools sdk, and Sonnet model, the model rather than returning a text block with "thinking" followed by a "tool_use" block, it returns all as text inside the first "text" block
  https://github.com/anthropics/anthropic-sdk-typescript/issues/381
  Branch: codex/upstream-anthropic-ai-sdk-381
- anthropics/anthropic-sdk-typescript#883 (45, triage-before-pr) TextDecoder.decode() fails on Node.js 22
  https://github.com/anthropics/anthropic-sdk-typescript/issues/883
  Branch: codex/upstream-anthropic-ai-sdk-883
- anthropics/anthropic-sdk-typescript#956 (45, triage-before-pr) Claude Opus 4.6 and Sonnet 4.6 fail to make parallel tool calls in Batch API
  https://github.com/anthropics/anthropic-sdk-typescript/issues/956
  Branch: codex/upstream-anthropic-ai-sdk-956
- anthropics/anthropic-sdk-typescript#846 (45, triage-before-pr) web_fetch fails for some links
  https://github.com/anthropics/anthropic-sdk-typescript/issues/846
  Branch: codex/upstream-anthropic-ai-sdk-846

## Repo Search Queries

### @anthropic-ai/sdk -> anthropics/anthropic-sdk-typescript
- repo:anthropics/anthropic-sdk-typescript is:issue is:open label:bug
- repo:anthropics/anthropic-sdk-typescript is:issue is:open label:"good first issue"
- repo:anthropics/anthropic-sdk-typescript is:issue is:open label:"help wanted"
- repo:anthropics/anthropic-sdk-typescript is:issue is:open bounty
- repo:anthropics/anthropic-sdk-typescript is:issue is:open "bug bounty"
- repo:anthropics/anthropic-sdk-typescript is:issue is:open security
- repo:anthropics/anthropic-sdk-typescript is:issue is:open regression
- repo:anthropics/anthropic-sdk-typescript is:issue is:open docs OR documentation
- repo:anthropics/anthropic-sdk-typescript is:issue is:open typescript OR types
- repo:anthropics/anthropic-sdk-typescript is:issue is:open test OR ci OR flake
- Next: Monitor issue search queries; wait for a small bug, docs, CI, type, or test issue before patching.

### @changesets/changelog-github -> changesets/changesets
- repo:changesets/changesets is:issue is:open label:bug
- repo:changesets/changesets is:issue is:open label:"good first issue"
- repo:changesets/changesets is:issue is:open label:"help wanted"
- repo:changesets/changesets is:issue is:open bounty
- repo:changesets/changesets is:issue is:open "bug bounty"
- repo:changesets/changesets is:issue is:open security
- repo:changesets/changesets is:issue is:open regression
- repo:changesets/changesets is:issue is:open docs OR documentation
- repo:changesets/changesets is:issue is:open typescript OR types
- repo:changesets/changesets is:issue is:open test OR ci OR flake
- Next: Monitor issue search queries; wait for a small bug, docs, CI, type, or test issue before patching.

### @changesets/cli -> changesets/changesets
- repo:changesets/changesets is:issue is:open label:bug
- repo:changesets/changesets is:issue is:open label:"good first issue"
- repo:changesets/changesets is:issue is:open label:"help wanted"
- repo:changesets/changesets is:issue is:open bounty
- repo:changesets/changesets is:issue is:open "bug bounty"
- repo:changesets/changesets is:issue is:open security
- repo:changesets/changesets is:issue is:open regression
- repo:changesets/changesets is:issue is:open docs OR documentation
- repo:changesets/changesets is:issue is:open typescript OR types
- repo:changesets/changesets is:issue is:open test OR ci OR flake
- Next: Monitor issue search queries; wait for a small bug, docs, CI, type, or test issue before patching.

### @google/genai -> googleapis/js-genai
- repo:googleapis/js-genai is:issue is:open label:bug
- repo:googleapis/js-genai is:issue is:open label:"good first issue"
- repo:googleapis/js-genai is:issue is:open label:"help wanted"
- repo:googleapis/js-genai is:issue is:open bounty
- repo:googleapis/js-genai is:issue is:open "bug bounty"
- repo:googleapis/js-genai is:issue is:open security
- repo:googleapis/js-genai is:issue is:open regression
- repo:googleapis/js-genai is:issue is:open docs OR documentation
- repo:googleapis/js-genai is:issue is:open typescript OR types
- repo:googleapis/js-genai is:issue is:open test OR ci OR flake
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### @huggingface/transformers -> huggingface/transformers.js
- repo:huggingface/transformers.js is:issue is:open label:bug
- repo:huggingface/transformers.js is:issue is:open label:"good first issue"
- repo:huggingface/transformers.js is:issue is:open label:"help wanted"
- repo:huggingface/transformers.js is:issue is:open bounty
- repo:huggingface/transformers.js is:issue is:open "bug bounty"
- repo:huggingface/transformers.js is:issue is:open security
- repo:huggingface/transformers.js is:issue is:open regression
- repo:huggingface/transformers.js is:issue is:open docs OR documentation
- repo:huggingface/transformers.js is:issue is:open typescript OR types
- repo:huggingface/transformers.js is:issue is:open test OR ci OR flake
- Next: Monitor issue search queries; wait for a small bug, docs, CI, type, or test issue before patching.

### @lancedb/lancedb -> lancedb/lancedb
- repo:lancedb/lancedb is:issue is:open label:bug
- repo:lancedb/lancedb is:issue is:open label:"good first issue"
- repo:lancedb/lancedb is:issue is:open label:"help wanted"
- repo:lancedb/lancedb is:issue is:open bounty
- repo:lancedb/lancedb is:issue is:open "bug bounty"
- repo:lancedb/lancedb is:issue is:open security
- repo:lancedb/lancedb is:issue is:open regression
- repo:lancedb/lancedb is:issue is:open docs OR documentation
- repo:lancedb/lancedb is:issue is:open typescript OR types
- repo:lancedb/lancedb is:issue is:open test OR ci OR flake
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### apache-arrow -> apache/arrow
- repo:apache/arrow is:issue is:open label:bug
- repo:apache/arrow is:issue is:open label:"good first issue"
- repo:apache/arrow is:issue is:open label:"help wanted"
- repo:apache/arrow is:issue is:open bounty
- repo:apache/arrow is:issue is:open "bug bounty"
- repo:apache/arrow is:issue is:open security
- repo:apache/arrow is:issue is:open regression
- repo:apache/arrow is:issue is:open docs OR documentation
- repo:apache/arrow is:issue is:open typescript OR types
- repo:apache/arrow is:issue is:open test OR ci OR flake
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### better-sqlite3 -> WiseLibs/better-sqlite3
- repo:WiseLibs/better-sqlite3 is:issue is:open label:bug
- repo:WiseLibs/better-sqlite3 is:issue is:open label:"good first issue"
- repo:WiseLibs/better-sqlite3 is:issue is:open label:"help wanted"
- repo:WiseLibs/better-sqlite3 is:issue is:open bounty
- repo:WiseLibs/better-sqlite3 is:issue is:open "bug bounty"
- repo:WiseLibs/better-sqlite3 is:issue is:open security
- repo:WiseLibs/better-sqlite3 is:issue is:open regression
- repo:WiseLibs/better-sqlite3 is:issue is:open docs OR documentation
- repo:WiseLibs/better-sqlite3 is:issue is:open typescript OR types
- repo:WiseLibs/better-sqlite3 is:issue is:open test OR ci OR flake
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.
