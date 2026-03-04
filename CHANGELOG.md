# Changelog

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
