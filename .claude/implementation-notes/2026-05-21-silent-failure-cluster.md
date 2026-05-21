# Silent-failure clustering — implementation notes

**Decision date**: 2026-05-21
**CEO sign-off**: explicit approval to "build (B) in parallel" after deep-research deliverable
**Scope**: behind-the-flag experiment, off by default
**Owner**: build agent (this file is the running notes per the Thariq pattern in `CLAUDE.md`)

---

## Why this exists (research synthesis)

ThumbGate's current HITL loop only promotes gates after an explicit thumbs-down. Tool calls that **fail without a user vote** (exit_code != 0, regex-matched error, agent recovers silently, user never notices) are invisible to `auto-promote-gates.js`.

This is the only true unsupervised-learning gap the deep research identified — every other UL idea (contrastive reranking, topic modeling, autoencoder anomaly, implicit feedback) duplicates work already shipped (`cross-encoder-reranker.js`, `principle-extractor.js`, `semantic-dedup.js`, etc.) or carries cost not justified by realistic gain.

## Success metric (will measure)

≥ 1 auto-promoted gate per week derived from a silent failure (no historical thumbs-down) at false-positive rate ≤ current baseline. Measured by:

- New counter in `gate-stats.json`: `silentFailureDerivedGates` (count of promoted gates whose origin is silent-failure-cluster vs. user-feedback)
- Existing `meta-agent-loop.js` fp-rate eval applied to silent-failure candidates same as LLM-generated ones — no separate path
- Pre/post comparison: how many gates promoted in last 30 days vs. last 30 days + silent-failure ON

## Scope contract (what this PR does NOT do)

- Does NOT change default behavior. Off by default behind `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`.
- Does NOT add new dependencies. Reuses `vector-store.js` (LanceDB infra already present).
- Does NOT bypass the existing gate-promotion eval harness in `meta-agent-loop.js`. Candidates from silent-failure clustering flow through the SAME hit-rate / fp-rate guardrails as LLM-generated candidates.
- Does NOT touch retrieval, reranking, or block decisions. Only adds a new candidate source.

## Honest known limitations (locked in by research)

- **Only pays off on workspaces generating ≥ 50 tool calls/day.** Solo workspaces will have too thin a dataset to cluster meaningfully. The script must surface "insufficient data, skipped" cleanly, not silently emit garbage.
- **Cluster ≠ bad.** A cluster of identical calls is just identical calls; we need the weak signal (exit_code, regex error) to filter to *failure* clusters specifically. The agent will get this wrong if the filter regex is too narrow.
- **No drift detection.** If user's tool inventory changes (new MCP server, new framework), clusters from old tools will pollute. Out of scope for v1.

## Build plan (build agent will execute)

1. New script: `scripts/silent-failure-cluster.js`
   - Read `~/.claude/projects/*/conversation-log.jsonl` (file-discovery already done by `self-distill-agent.js` — REUSE that logic, don't reimplement)
   - Filter tool calls with `exit_code != 0` OR matching `ERROR_PATTERNS` (also already defined in `self-distill-agent.js`)
   - Drop any call that has a feedback-log entry within ±5 min (those are already in the HITL loop)
   - Normalize args: strip absolute paths, redact secrets per the patterns in `~/.claude/hooks/daily-log-append.sh`
   - Cluster by `(tool, normalized-arg-signature)` — start simple: exact tuple match with min cluster size 3. Upgrade to HDBSCAN over LanceDB embeddings only if exact-tuple clustering misses obvious paraphrase classes.
   - Emit clusters as gate candidates with `origin: 'silent-failure-cluster'`

2. Hook into `meta-agent-loop.js`:
   - Behind `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`, call the new script's candidate generator alongside the existing LLM-generated candidates
   - Tag each candidate with `origin` so we can measure precision later
   - Existing fp-rate eval applies unchanged

3. Tests: `tests/silent-failure-cluster.test.js`
   - Filters tool calls with exit_code != 0
   - Excludes calls with adjacent feedback-log entries
   - Normalizes arg paths (e.g., `/Users/foo/x` → `<HOME>/x`)
   - Redacts secrets in args (ghp_*, sk-ant-*, etc.)
   - Min cluster size enforced (3+)
   - Insufficient-data path returns empty cluster set without throwing
   - `origin` field on emitted candidates

4. Telemetry:
   - Add `silentFailureDerivedGates` counter to `gate-stats.json` schema
   - Surface in `dashboard.js` if reasonable (small line addition; defer if it conflicts with another PR)

5. Documentation:
   - Add a one-paragraph section to README.md or to `docs/UL.md` explaining the flag, what it does, the ≥50 calls/day caveat
   - Wire `test:silent-failure-cluster` into the npm test chain (mandatory per `tests/test-suite-parity.test.js`)

## Things the build agent should explicitly NOT do

- Do not add UL approaches the research already rejected (contrastive embeddings, topic modeling, autoencoders, implicit-feedback). Those are scope creep dressed as completeness.
- Do not change the default-on behavior of any existing script.
- Do not add new npm dependencies. Reuse `vector-store.js`, the existing JSONL parsers, the existing regex error patterns.
- Do not bypass `--no-verify` on git push. If pre-push hooks fail, surface the failure and fix the underlying cause.

## Build agent will append below

(Decisions made during build, assumptions VERIFIED/UNVERIFIED, tradeoffs taken, what the CEO would need to know if reviewing async.)

### Build session — 2026-05-21

**Files touched**:
- `scripts/silent-failure-cluster.js` (new, ~380 LOC)
- `scripts/meta-agent-loop.js` (flag-gated integration, `origin` on promoted gates, manifest fields)
- `tests/silent-failure-cluster.test.js` (new, 31 tests, all passing)
- `package.json` (added `test:silent-failure-cluster` + `silent-failure-cluster:run`; wired into master `test` chain after `test:meta-agent`)
- `.changeset/silent-failure-cluster.md` (patch bump, explicit "experimental" tag)
- `docs/UL.md` (new doc explaining the flag, the ≥50 calls/day caveat, known limitations)
- `README.md` (one-line link under Docs section)

**Decisions made**:
1. **Did NOT add a new constant in `gate-stats.json`.** That file is owned by `gates-engine.js` and is updated on gate *execution*, not promotion. Origin tracking on the engine path widens scope. Instead, `silentFailureDerivedGates` is computed per-run inside the meta-agent manifest (`META_RUNS_PATH` JSONL) and `origin` is stamped on each promoted gate object. Downstream aggregators can derive the same counter from these. The CEO measurement need ("how many promotions per week came from silent-failure clustering") is satisfied without touching gate-engine surface.
2. **Duplicated `ERROR_PATTERNS`** (10 regexes) into the new module rather than refactoring `self-distill-agent.js` to export them. Refactor would have widened the diff and risked unrelated test breakage. A comment in the new file notes this so a future PR can de-duplicate.
3. **`vector-store.js` not used in v1.** Exact-tuple clustering on a normalized signature is sufficient for the v1 success metric. The spec explicitly allows deferring HDBSCAN-over-LanceDB-embeddings to v2 if exact-tuple misses paraphrase classes. Avoids a `@lancedb/lancedb` cold-import (~200ms) on every meta-agent run.
4. **Two transcript shapes supported in `extractToolEvents`** — the real Claude Code shape (`assistant.message.content[].tool_use` + `user.message.content[].tool_result`) and a simplified `{ type: 'tool_call' | 'tool_result' }` shape. The simplified shape is what the test fixtures use; the real shape is what `~/.claude/projects/<encoded>/<uuid>.jsonl` contains.
5. **Path replacement order**: redact secrets FIRST, then normalize paths. Some secret formats (private-key headers) contain path-like characters; redacting first avoids the path normalizer munging a token tail.
6. **Candidate pattern construction** uses a flexible-keyword regex (`word1.*word2.*word3`) rather than the literal signature. A literal-signature regex would only match identical strings, defeating the purpose of letting the existing fp-rate eval count how often the pattern matches *successes* as well as *failures*. Matches the heuristic style already in `meta-agent-loop.generateCandidatesHeuristic`.

**Assumptions — VERIFIED** (read code or executed):
- `discoverConversationLogs` is exported from `self-distill-agent.js` (READ: `module.exports` block at L546-554).
- `meta-agent-loop.js` constructs `feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl')` and feedback-log entries carry an ISO `timestamp` field (READ: L98-107, `getRecentFailures`).
- `tests/test-suite-parity.test.js` recursively walks `npm test` and asserts every `tests/*.test.js` file is reachable (READ: full file; all 5 parity tests pass after wiring).
- Canonical redaction regex set lives at `~/.claude/hooks/daily-log-append.sh` (READ: full file). Ported verbatim into `SECRET_PATTERNS`.
- All 31 new tests pass locally: `node --test tests/silent-failure-cluster.test.js` → `pass 31, fail 0`.
- Existing `tests/meta-agent-loop.test.js` still passes (`pass 38, fail 0`) — integration did not regress the existing pipeline.

**Assumptions — UNVERIFIED**:
- That real-world JSONL transcripts pair `tool_use` (in `assistant` entries) with `tool_result` (in subsequent `user` entries) via `tool_use_id`. Spot-checks of the local `~/.claude/projects/` dir showed queue-operation events, not full transcripts — likely a different agent populates that directory on this host. The dual-shape extractor mitigates: if the real Claude Code shape differs, the test fixtures still verify the simplified shape and the real shape can be patched without rewriting clustering / redaction.
- That ≥50 calls/day is the right threshold. The spec asserted ≥50 but provided no benchmark. Made it configurable (`minDailyCalls` arg) so it can be tuned without a re-release.
- That `meta-agent-loop` running under the flag won't blow its time budget on huge log files. Mitigation: `discoverConversationLogs` is limited to 20 logs by default (bumped to 50 for the CLI). No streaming parser — files are read whole. Fine for typical ≤10MB logs; switch to line-stream if users with >100MB logs report slowness.

**Tradeoffs**:
- Conservative redaction (false positives in the form of `[REDACTED]` showing up inside benign cluster messages) chosen over risk of a leaked secret landing in `auto-promoted-gates.json`.
- Reuse over rewrite: `discoverConversationLogs`, ad-hoc JSONL parsing, `ERROR_PATTERNS` — all sourced from existing modules. No new npm dependencies (verified).
- Off-by-default means precision can only be measured after at least one user opts in. Acceptable for an experimental feature; explicitly tagged in changeset.

**What the CEO would want to know reviewing async**:
- Default behavior is unchanged. The flag is the only way to activate this.
- Promoted gates from this source carry `origin: 'silent-failure-cluster'`, so dashboards and analytics can split metrics by source from day one.
- The fp-rate / hit-rate guardrail in `meta-agent-loop` is untouched; silent-failure candidates compete with LLM/heuristic candidates on the same playing field.
- Zero new dependencies, no Lance/LanceDB at runtime, no LLM calls — clustering is pure CPU on JSONL parses, costs nothing per run.

---
