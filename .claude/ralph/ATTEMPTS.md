# Ralph Mode: MCP Startup Reliability

**Goal:** Make the packaged MCP startup path reliable enough to sell: no cwd-dependent launchers, no pre-handshake crashes, and proof that cold-start initialization works.

## Task Breakdown
- [x] Reproduce the reported startup failures with direct evidence.
- [x] Isolate root causes in config generation and `serve()` bootstrap.
- [x] Patch the launcher, update adapter docs, and add regressions.
- [x] Run proof + full verification, then ship via PR/merge.

## Attempt Log
### Iteration 1
- **Action:** Reproduced both failure classes in a dedicated worktree with parallel agents.
- **Status:** Complete.
- **Learnings:**
  - `init` and bundled adapter configs wrote or documented `node adapters/mcp/server-stdio.js`, which fails outside the repo root.
  - `serve()` eagerly created fallback directories before responding to `initialize`, which could terminate the process on invalid or unwritable `HOME`.
  - `adapters/mcp/server-stdio.js` itself answered `initialize` correctly over framed and ndjson transports when launched correctly.

### Iteration 2
- **Action:** Switched the launcher contract to `npx -y rlhf-feedback-loop serve`, removed fatal pre-init bootstrap work from `serve()`, and started wiring proof coverage.
- **Status:** Complete.

### Iteration 3
- **Action:** Verified the merge candidate in a clean `/tmp` worktree with `npm ci`, `npm test`, `npm run test:coverage`, `npm run prove:adapters`, `npm run prove:automation`, and `npm run self-heal:check`.
- **Status:** Complete.
