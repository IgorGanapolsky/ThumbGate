---
"thumbgate": patch
---

Repo credibility cleanup wave 1, after Reddit r/devops thread (2026-06-06) called the project out as a "vibe-coded" bot operation. Removes 22 social/marketing/orchestration GitHub workflows (linkedin/reddit/zernio/instagram/video dispatchers, daily-revenue-loop, gtm-autonomous-loop, weekly-social-post, reply-monitor, social-analytics-poll, etc.) and 6 root-level launch-theater markdown files (LAUNCH.md, LAUNCH_NOW.md, LAUNCH_POSTS.md, FIRST_CUSTOMER_BATTLE_PLAN.md, ALL_ENHANCEMENTS_COMPLETE.md, TEST_EVIDENCE_E2E_HYBRID_CLAW.md). Extends the pre-commit guard and CI test to permanently block re-introduction of either path family. Workflow count: 52 → 30. Tracked-line delta: -3164.
