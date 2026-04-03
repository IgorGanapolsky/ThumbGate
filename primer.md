# Session Primer

## Active Mission
- **North Star:** Earn **$100/day after-tax profit**.
- **Current Wedge:** $19/mo "Mistake-Free" Starter Pack (500 credits).
- **Target Audience:** Developers hitting "Claude amnesia" and context compaction.

## Current State (2026-03-21)
- **Revenue Today:** `node bin/cli.js cfo --today --timezone=America/New_York` still falls back to local operator truth. It shows `6` GitHub Marketplace paid events today, but `$0.00` booked revenue because all `6` orders still have unknown amounts in the local ledger.
- **RLHF Hardening:** ShieldCortex-backed memory-ingress blocking is implemented and verified in the `fix/rlhf-source-labels` worktree.
- **Publish Reality:** The social pipeline remains on `main`, with Instagram draft creation verified and TikTok still blocked by unauthenticated Chrome profiles (`Default instagram=7 tiktok=0`, `Profile 1 instagram=0 tiktok=0`).
- **Positioning:** Landing page still frames ThumbGate as an AI workflow control plane, not a generic memory server.

## Last Completed Task
- Implemented dependency cooldown check

## Exact Next Step
- Wire cooldown into CI pipeline
- After merge, inspect whether the stale tracked `proof/*.json` contract should be fixed in a follow-up PR.

## Open Blockers
- Need Chainguard API key

## Behavioral Traits

_No strong behavioral patterns identified yet._

## Live Git Context

### Branch: feat/affective-immune-system

### Last 5 Commits:
```
dd2ad0f feat: implement Affective Immune System (functional emotion concepts)
bf16634 test: cover lessons tab selector scoping (#534)
0af636e fix: add TL;DR hooks and sticky CTA bar to reduce 92% bounce rate on /learn articles (#532)
f0413a2 fix(lessons): fix card click behavior — proper tab switching, filter sync, card highlighting (#533)
641f633 fix: harden conversation feedback pipeline follow-up (#530)
```

### Modified Files:
```
 M adapters/mcp/server-stdio.js
 M package.json
 M primer.md
 M scripts/a2ui-engine.js
 M scripts/access-anomaly-detector.js
 M scripts/adk-consolidator.js
 M scripts/affective-distiller.js
 M scripts/agent-readiness.js
 M scripts/agentic-data-pipeline.js
 M scripts/analytics-report.js
 M scripts/analytics-window.js
 M scripts/async-job-runner.js
 M scripts/audit-trail.js
 M scripts/auto-promote-gates.js
 M scripts/auto-wire-hooks.js
 M scripts/autonomous-sales-agent.js
 M scripts/autoresearch-runner.js
 M scripts/behavioral-extraction.js
 M scripts/belief-update.js
 M scripts/billing.js
 M scripts/bot-detector.js
 M scripts/build-claude-mcpb.js
 M scripts/build-metadata.js
 M scripts/check-congruence.js
 M scripts/cli-feedback.js
 M scripts/cli-telemetry.js
 M scripts/code-reasoning.js
 M scripts/codegraph-context.js
 M scripts/commercial-offer.js
 M scripts/computer-use-firewall.js
 M scripts/context-engine.js
 M scripts/conversation-context.js
 M scripts/creator-campaigns.js
 M scripts/daemon-manager.js
 M scripts/daily-digest.js
 M scripts/dashboard.js
 M scripts/data-governance.js
 M scripts/delegation-runtime.js
 M scripts/deploy-policy.js
 M scripts/disagreement-mining.js
 M scripts/dispatch-brief.js
 M scripts/distribution-surfaces.js
 M scripts/dpo-optimizer.js
 M scripts/eval-harness.js
 M scripts/evolution-state.js
 M scripts/experiment-tracker.js
 M scripts/export-databricks-bundle.js
 M scripts/export-kto-pairs.js
 M scripts/export-training.js
 M scripts/failure-diagnostics.js
 M scripts/feedback-attribution.js
 M scripts/feedback-fallback.js
 M scripts/feedback-history-distiller.js
 M scripts/feedback-inbox-read.js
 M scripts/feedback-quality.js
 M scripts/feedback-session.js
 M scripts/feedback-to-memory.js
 M scripts/feedback-to-rules.js
 M scripts/filesystem-search.js
 M scripts/funnel-analytics.js
 M scripts/gate-satisfy.js
 M scripts/gate-stats.js
 M scripts/gate-templates.js
 M scripts/gates-engine.js
 M scripts/github-about.js
 M scripts/gtm-revenue-loop.js
 M scripts/hallucination-detector.js
 M scripts/hf-papers.js
 M scripts/history-distiller.js
 M scripts/hook-rlhf-cache-updater.js
 M scripts/hosted-config.js
 M scripts/hybrid-feedback-context.js
 M scripts/install-mcp.js
 M scripts/internal-agent-bootstrap.js
 M scripts/jsonl-watcher.js
 M scripts/lesson-db.js
 M scripts/lesson-inference.js
 M scripts/lesson-retrieval.js
 M scripts/lesson-search.js
 M scripts/license.js
 M scripts/local-model-profile.js
 M scripts/markdown-escape.js
 M scripts/marketing-experiment.js
 M scripts/mcp-config.js
 M scripts/memalign-recall.js
 M scripts/memory-firewall.js
 M scripts/meta-policy.js
 M scripts/metered-billing.js
 M scripts/model-tier-router.js
 M scripts/multi-hop-recall.js
 M scripts/natural-language-harness.js
 M scripts/obsidian-export.js
 M scripts/operational-dashboard.js
 M scripts/operational-summary.js
 M scripts/org-dashboard.js
 M scripts/partner-orchestration.js
 M scripts/perplexity-marketing.js
 M scripts/pii-scanner.js
 M scripts/plan-gate.js
 M scripts/post-everywhere.js
 M scripts/post-to-x.js
 M scripts/pr-manager.js
 M scripts/predictive-insights.js
 M scripts/principle-extractor.js
 M scripts/pro-features.js
 M scripts/pro-local-dashboard.js
 M scripts/problem-detail.js
 M scripts/profile-router.js
 M scripts/prompt-guard.js
 M scripts/prove-attribution.js
 M scripts/prove-automation.js
 M scripts/prove-autoresearch.js
 M scripts/prove-claim-verification.js
 M scripts/prove-data-pipeline.js
 M scripts/prove-data-quality.js
 M scripts/prove-evolution.js
 M scripts/prove-harnesses.js
 M scripts/prove-intelligence.js
 M scripts/prove-lancedb.js
 M scripts/prove-local-intelligence.js
 M scripts/prove-loop-closure.js
 M scripts/prove-predictive-insights.js
 M scripts/prove-runtime.js
 M scripts/prove-seo-gsd.js
 M scripts/prove-settings.js
 M scripts/prove-subway-upgrades.js
 M scripts/prove-tessl.js
 M scripts/prove-training-export.js
 M scripts/prove-workflow-contract.js
 M scripts/prove-xmemory.js
 M scripts/publish-decision.js
 M scripts/pulse.js
 M scripts/rate-limiter.js
 M scripts/reflector-agent.js
 M scripts/reminder-engine.js
 M scripts/revenue-status.js
 M scripts/risk-scorer.js
 M scripts/rlaif-self-audit.js
 M scripts/rlhf-search.js
 M scripts/schedule-manager.js
 M scripts/secret-scanner.js
 M scripts/semantic-layer.js
 M scripts/seo-gsd.js
 M scripts/settings-hierarchy.js
 M scripts/skill-exporter.js
 M scripts/skill-generator.js
 M scripts/skill-materializer.js
 M scripts/skill-packs.js
 M scripts/skill-proposer.js
 M scripts/skill-quality-tracker.js
 M scripts/slo-alert-engine.js
 M scripts/slow-loop.js
 M scripts/social-analytics/instagram-thumbgate-post.js
 M scripts/social-analytics/publishers/zernio.js
 M scripts/social-pipeline.js
 M scripts/social-reply-monitor.js
 M scripts/status-dashboard.js
 M scripts/statusline-lesson.js
 M scripts/statusline-tower.js
 M scripts/stripe-live-status.js
 M scripts/sync-github-about.js
 M scripts/sync-version.js
 M scripts/synthetic-dpo.js
 M scripts/telemetry-analytics.js
 M scripts/tessl-export.js
 M scripts/test-coverage.js
 M scripts/thompson-sampling.js
 M scripts/tool-kpi-tracker.js
 M scripts/tool-registry.js
 M scripts/user-profile.js
 M scripts/validate-feedback.js
 M scripts/validate-workflow-contract.js
 M scripts/vector-store.js
 M scripts/verification-loop.js
 M scripts/verify-run.js
 M scripts/webhook-delivery.js
 M scripts/workflow-runs.js
 M scripts/workflow-sprint-intake.js
 M scripts/workspace-evolver.js
 M scripts/x-autonomous-marketing.js
 M scripts/xmemory-lite.js
 M tests/instagram-thumbgate-post.test.js
 M tests/publish-instagram-thumbgate.test.js
?? scripts/generate-lora-config.js
?? scripts/model-hardening-advisor.js
?? tests/generate-lora-config.test.js
?? tests/model-hardening-advisor.test.js
```
