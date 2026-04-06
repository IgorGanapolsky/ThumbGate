# Changelog

## [0.9.4] - 2026-04-02

### Added
- **Conversation Window Capture**: `capture_feedback` now accepts a `conversationWindow` parameter — an array of the last 5-10 conversation turns. Raw messages are stored alongside feedback for full context awareness.
- **Structured IF/THEN Lesson Inference**: New `lesson-inference.js` module extracts structured rules from conversation windows with trigger/action/confidence/scope classification.
- **Per-Action Lesson Retrieval**: New `retrieve_lessons` MCP tool returns top-K relevant lessons for a given tool/action context using keyword matching, file path overlap, recency decay, and signal weighting.
- **Reflector Agent**: Self-healing post-mortem system. On negative feedback with conversation context, automatically analyzes what went wrong, checks for recurrence, and proposes a specific rule back to the user.
- **Statusbar Lesson Link**: Claude Code statusbar now displays the latest lesson with memory ID, signal icon, summary, and conversation turn count after every feedback capture.

### Changed
- `captureFeedback` enriches `whatWentWrong`/`whatWorked` from conversation window when caller doesn't provide them.
- Memory records now include `structuredRule` (IF/THEN format) and `conversationWindow` (capped at 10 messages, 500 chars each).
- Statusline cache includes `last_lesson` metadata for real-time statusbar updates.

### Performance
- All changes are backwards compatible — `conversationWindow` is optional. Omitting it preserves existing behavior.

## [0.9.0] - 2026-04-02

### Fixed
- **Stripe API timeout**: All Stripe API calls in billing pipeline now have a 5-second timeout via `Promise.race`, preventing indefinite hangs when Stripe is slow or rate-limited (`scripts/billing.js`).
- **SQLite WAL lock hangs**: Added `busy_timeout = 3000` pragma to all SQLite database connections, preventing deadlocks when multiple processes contend for the WAL lock (`lesson-db.js`, `store.js`, `github.js`).
- **Duplicate server instances**: Lock file detection now exits fatally when an active server PID exists, and cleans stale locks from dead processes (`server-stdio.js`).

### Performance
- **MCP tool call latency**: `capture_feedback`, `feedback_stats`, `recall`, `feedback_summary`, and `prevention_rules` now skip metric gate evaluation entirely — eliminating the 5-minute stall caused by live Stripe API calls on every tool invocation (`gates-engine.js`).
- **readJSONL tail-read**: Large JSONL files (300KB+) now default to reading only the last 500 lines instead of the entire file, reducing event loop blocking during feedback capture (`feedback-loop.js`).
- **Metric gate timeout**: Non-feedback tools now have a 3-second fail-open timeout on metric gate evaluation, preventing cascading hangs.

### Changed
- `getBillingSummaryLive()` returns a safe default object on any failure (timeout or otherwise) instead of throwing, so metric gates degrade gracefully.
- `readJSONL()` accepts `{ maxLines }` option; callers needing all entries pass `{ maxLines: 0 }`.

## 0.8.2 - 2026-03-26

- Bumped all version surfaces to 0.8.2 (package.json, server.json, mcpize.yaml, landing page).
- Branch coverage improvements: added tests for 10 lowest-coverage files and 15 previously untested scripts.
- Railway deploy fix: switched to `--detach` mode with health-check polling to avoid intermittent "Failed to retrieve build log" CLI streaming errors.

## 0.8.1 - 2026-03-26

- Unified ThumbGate branding across all public surfaces (README, AGENTS.md, CLAUDE.md, GEMINI.md, landing page, package.json).
- Landing page SEO: "human-in-the-loop enforcement", "vibe coding" positioning, FAQPage JSON-LD schema for Google rich results.
- Added congruence CI check (`scripts/check-congruence.js`) — enforces version, branding, tech stack terms, and honest disclaimer across README and landing page on every PR.
- Performance: deferred non-critical side-effects in `captureFeedback` (contextFs, RLAIF self-audit) via `setImmediate`.
- Added `_captureMs` timing field to accepted feedback responses for observability.
- Added `mcpize.yaml` to version sync targets.
- Dead code removal: -1,551 lines (contract-audit.js, prove-rlaif.js, stale landing-page.html, 3 duplicate docs).
- Fixed GitGuardian incident #29200799: scrubbed hardcoded Google API key from git history.
- Social automation pipeline: post-everywhere CLI, reply monitor with AutoMod-safe Reddit posts.
- TDS article draft: "Beyond Prompt Rules: How Pre-Action Gates Stop AI Coding Agents From Repeating Mistakes".

## 0.8.0 - 2026-03-25

- **Lesson DB:** SQLite + FTS5 full-text search replaces linear Jaccard token-overlap. Sub-millisecond ranked search indexed by signal, domain, tags, importance.
- **Corrective actions:** On negative feedback, `capture_feedback` returns `correctiveActions[]` — top 3 remediation steps inferred from similar past failures.
- **search_lessons MCP tool:** Exposes corrective actions, lifecycle state, linked rules, linked gates, and next harness fixes per lesson.
- **search_thumbgate MCP tool:** Searches raw ThumbGate state across feedback logs, ContextFS memory, and prevention rules.
- **Rejection ledger:** Tracks why vague feedback was rejected with revival conditions.
- **Bayesian belief updates:** Each memory carries a posterior that updates on new evidence; high-entropy contradictions auto-prune.

## 0.7.4 - 2026-03-20

- Added `session_handoff` and `session_primer` MCP tools for seamless cross-session context continuity.
- New `session` namespace in ContextFS stores primer.json with auto-captured git state (branch, last 5 commits, modified files, working tree status), last completed task, next step, and blockers.
- `session_handoff` records provenance events for full audit trail of session transitions.
- Closes Layer 2 (primer.md) of the 5-layer memory stack — no manual primer file needed.

## 0.6.11 - 2026-03-10

- Added Inverse Sink Weighting and Anchor-Memory management to prevent runaway negative memory accumulation and stabilize agent behavior over long sessions.
- Hardened MCP startup reliability: retry logic, process health checks, and graceful degradation on server init failures.
- North Star Phase 1: KTO export pipeline, MCP install workflow, and FDD (Feedback-Driven Development) rebrand replacing RLHF-loop branding.
- System hygiene: documented session directives in CLAUDE.md and fixed environment-dependent billing test failures causing flaky CI.
- A2UI model for dynamic agent-to-user interaction: agents can now emit structured UI events that surface inline prompts, confirmation dialogs, and progress updates.
- ADK memory consolidator with Gemini integration: deduplicates and ranks cross-session memories using Gemini embeddings for relevance scoring.
- OpenDev patterns: adaptive context compaction (auto-prune low-signal context items), event-driven reminder injection (surface forgotten constraints mid-session), and model role router (dispatch sub-tasks to appropriately-sized models based on complexity).

## 0.5.0 - 2026-03-03

- Added autonomous GitOps workflows: agent auto-merge, Dependabot auto-merge, self-healing monitor, and merge-branch fallback.
- Enabled CI proof artifact uploads and strengthened CI concurrency/branch scoping.
- Added self-healing command layer (`scripts/self-healing-check.js`, `scripts/self-heal.js`) with unit tests.
- Added semantic cache for ContextFS context-pack construction with TTL + similarity gating and provenance events.
- Added secret-sync helper (`scripts/sync-gh-secrets-from-env.sh`) and docs for required repo settings/secrets.

## 0.4.0 - 2026-03-03

- Added rubric-based RLHF scoring with configurable criteria and weighted evaluation.
- Added anti-reward-hacking safeguards: guardrail checks and multi-judge disagreement detection.
- Added rubric-aware memory promotion gates for positive feedback.
- Added rubric-aware context evaluation, prevention-rule dimensions, and DPO export metadata.
- Extended API/MCP/Gemini contracts for rubric scores and guardrails.
- Added automated proof harness for rubric + intent + API/MCP end-to-end validation (`proof/automation/*`).

## 0.3.0 - 2026-03-03

- Added production API server with secure auth defaults and safe-path checks.
- Added local MCP server for Claude/Codex integrations.
- Added ChatGPT, Gemini, Codex, Claude, and Amp adapter bundles.
- Added budget guard and PaperBanana generation workflow.
- Added platform research, packaging plan, and verification artifacts.
