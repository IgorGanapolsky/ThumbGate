# Changelog

## 1.4.0

### Minor Changes

- **Cross-encoder BM25F reranker** (`scripts/lesson-reranker.js`): Two-stage retrieval pipeline — bi-encoder retrieves top-50 candidates, cross-encoder reranks by joint (query, lesson) scoring. Field weights give `whatWentWrong` (3.0×) priority over `tags` (0.4×). Includes synonym expansion ("deploy" ↔ "deployment/release/publish"), signal coherence (failure queries boost negative-signal lessons 1.2×), and tool name joint scoring (1.3× bonus for exact tool match). Wired into both the PreToolUse hook path and `search_lessons` MCP tool.

- **`thumbgate explore`** (`scripts/explore.js`): Keyboard-driven TUI explorer — zero external dependencies. Four tabs (1–4 or Tab): Lessons · Gates · Stats · Rules. Navigate with ↑/↓ or j/k, filter with `/`, view detail with Enter, quit with `q`. Color-coded signal indicators, relative timestamps, terminal-resize aware.

- **Schema-first CLI** (`scripts/cli-schema.js`): Single source of truth for all CLI commands. Every command declares its name, description, flags (with types), group, and MCP tool binding. `thumbgate help` is now generated from the schema with group headings and `[mcp:tool]` annotations — no more hardcoded console.log lines.

- **`--json` on `stats` and `gate-stats`**: Both commands now output structured JSON when `--json` is passed. `stats --json` returns `{ total, positives, negatives, approvalRate, recentTrend, revenueAtRisk, topTags, recentActivity }`. `gate-stats --json` returns gate engine summary; add `--verbose` for the full gates array.

- **`--local` / `--remote` flag on `lessons`**: `thumbgate lessons --remote` fetches from the hosted Railway instance at `GET /v1/lessons/search`. `--local` is the explicit default. Respects `THUMBGATE_API_URL` env var for custom deployments.

- **Developer-first README**: Feature showcase (statusline, explore, searchable lessons, dashboard, 👍/👎, DPO export) leads the page. Tech Stack updated to include BM25F cross-encoder, TUI explorer, and schema-first CLI.

## 1.3.0

### Minor Changes

- [#643](https://github.com/IgorGanapolsky/ThumbGate/pull/643) [`abdae7d`](https://github.com/IgorGanapolsky/ThumbGate/commit/abdae7dcdf040856649a0975902aac74a347b441) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add GLM 5.1 as a zero-cost local frontier tier. Self-hosting GLM 5.1 (open-source, SWE-Bench Pro SOTA) eliminates frontier API spend: `localFrontier` tier has `costMultiplier: 0.0` and no token budget enforcement. Set `THUMBGATE_LOCAL_MODEL_FAMILY=glm-*` to activate automatic frontier → localFrontier routing in `recommendExecutionPlan`.

### Patch Changes

- [#644](https://github.com/IgorGanapolsky/ThumbGate/pull/644) [`fd1aa82`](https://github.com/IgorGanapolsky/ThumbGate/commit/fd1aa82164c5a00c374493abea60a46d4f5446db) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add packaged-runtime smoke proof: installs the npm artifact into a clean prefix and validates the shipped dashboard, lessons, and thumbs quick links before any publish step; prevents packaged runtime regressions from reaching npm or Claude release assets.

- [#645](https://github.com/IgorGanapolsky/ThumbGate/pull/645) [`6fcaeb8`](https://github.com/IgorGanapolsky/ThumbGate/commit/6fcaeb8b35185958f632d5ef6135e5d9a6fc59e9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix 59 pre-existing test failures: add `commit.gpgsign=false` to temp-repo helpers so tests work in signing-enforced environments; make `trackEvent` respect `THUMBGATE_API_URL` to prevent DNS hangs in sandboxed CI; add `process.exit(0)` to unlicensed pro command paths for clean CLI exit.

- Improve feedback proof surfaces by adding a daily gate-audit series to the Lessons timeline, making day-level activity clickable, and backfilling missed Claude thumbs signals before local counts render.

- [#640](https://github.com/IgorGanapolsky/ThumbGate/pull/640) [`347ce33`](https://github.com/IgorGanapolsky/ThumbGate/commit/347ce332ad663b2d78e2bd7e38d084eebddacb50) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add lesson count, latest lesson snippet, and dashboard link to Claude Code statusline. Previously only showed version, tier, and feedback counts.

- [#649](https://github.com/IgorGanapolsky/ThumbGate/pull/649) [`99816f8`](https://github.com/IgorGanapolsky/ThumbGate/commit/99816f8d9b7141e9a1ba482283545aacd3b97007) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Strengthen the enterprise release-confidence story across the README, docs, and landing pages so package publishes clearly show their Changeset coverage, SemVer discipline, verification evidence, and exact-merge proof chain.

- [#650](https://github.com/IgorGanapolsky/ThumbGate/pull/650) [`102026a`](https://github.com/IgorGanapolsky/ThumbGate/commit/102026a116cd29b60af342203138b7d3e8bee66a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Compact the Claude statusline so dashboard and lesson links stay visible under tight width budgets, even when recent lesson text is long.

- [#642](https://github.com/IgorGanapolsky/ThumbGate/pull/642) [`1e098ec`](https://github.com/IgorGanapolsky/ThumbGate/commit/1e098ec8a562213afa77a846609447ece87fadaa) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Retry live GitHub About verification after sync so mainline CI does not fail on GitHub metadata propagation delays.

## 1.2.0

### Minor Changes

- [#637](https://github.com/IgorGanapolsky/ThumbGate/pull/637) [`d1e83c9`](https://github.com/IgorGanapolsky/ThumbGate/commit/d1e83c9dffb0fb84a7e081d7474a697a94327d28) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add @changesets/cli for auditable release management. Every feat/fix PR now requires a changeset file describing the change and semver impact. CHANGELOG.md backfilled from 0.9.5 through 1.1.0. CI workflow enforces changeset presence on feature PRs.

- [#634](https://github.com/IgorGanapolsky/ThumbGate/pull/634) [`3e580af`](https://github.com/IgorGanapolsky/ThumbGate/commit/3e580affc3b46d72c77382773d6e1bdc22cf1bc6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Docker sandbox routing guidance for risky local autonomy and introduce an enforced Changesets-based release record so version bumps and customer-facing release notes stay explicit.

### Patch Changes

- [#639](https://github.com/IgorGanapolsky/ThumbGate/pull/639) [`181da25`](https://github.com/IgorGanapolsky/ThumbGate/commit/181da252c7b77f4e39dbf273a9e34c1545590089) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore clickable Claude statusline affordances for ThumbGate. The packaged statusline once again exposes OSC 8 hyperlinks for `👍`, `👎`, `Dashboard`, and `Lessons`, auto-boots the local Pro dashboard server when needed, and prefers the installed runtime binary over repeated `npm exec` launches.

## [1.1.0] - 2026-04-08

### Added

- **HuggingFace Dataset Export**: New `export_hf_dataset` MCP tool and `npm run export:hf` CLI command. Exports PII-redacted agent traces (traces.jsonl) and DPO preference pairs (preferences.jsonl) as HuggingFace-compatible datasets with dataset_info.json metadata.
- **Unified Context Manager**: `unified_context` MCP tool provides one-call context assembly combining session state, user profile, relevant lessons, prevention guards, context pack, and code-graph impact. Tiered graceful degradation: full, warm, cold.
- **Role-Aware Context Filtering**: Agent profiles (Claude, Cursor, ForgeCode, Codex) shape context budget, lesson count, and feature inclusion per agent type.
- **Changesets**: Added `@changesets/cli` for auditable release management with auto-generated changelogs.

## [1.0.0] - 2026-04-08

### Added

- **ForgeCode Adapter**: `npx thumbgate init --agent=forge` scaffolds ForgeCode agent integration.
- **Workflow Sentinel**: Pre-tool guard that predicts workflow failures before execution.
- **Durable Hosted Jobs**: API server supports long-running job execution with status polling.
- **Buyer-Intent Geo Pages**: SEO landing pages for location-based discovery.
- **Daily Revenue Loop**: GitHub Actions workflow for automated revenue tracking.
- **Plausible Analytics**: Privacy-first analytics across all public pages.

### Changed

- Scoped dashboard and status to active project context.
- Extended Railway rollout verification window for more reliable deploys.
- Closed all duplicate social posting code paths.

## [0.9.9] - 2026-04-05

### Changed

- Social quality gate wired into all publishers — blocks bot slop before posting.
- Dependency bumps: Stripe 22.0, Playwright 1.59, dotenv 17.4, HuggingFace Transformers 4.0.

### Fixed

- Hardened coverage and verification gates for CI stability.
- Inferred tags for promotable feedback signals.

## [0.9.5] - 2026-04-03

### Added

- **Landing Page Repositioning**: Visual diagrams, "bad AI PRs" messaging, self-improving agents positioning.
- **Social Posting Strategy**: Overhauled based on top SaaS research.
- **Governance Hardening**: Integrity governance assertions stabilized.

### Fixed

- Restored dashboard and lesson follow-up state.
- Removed legacy RLHF references.
- Repaired release health for Railway and npm publish.

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
- North Star Phase 1: KTO export pipeline, MCP install workflow, and FDD (Feedback-Driven Development) rebrand replacing prior loop branding.
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

- Added rubric-based feedback scoring with configurable criteria and weighted evaluation.
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
