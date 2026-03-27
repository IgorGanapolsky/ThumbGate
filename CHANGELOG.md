# Changelog

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
- **search_rlhf MCP tool:** Searches raw RLHF state across feedback logs, ContextFS memory, and prevention rules.
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
