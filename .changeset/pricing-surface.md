---
"thumbgate": minor
---

Reverse trial, README hero rewrite, and GTM content for first-dollar push.

- **Reverse trial**: 14-day full Pro access for new installs. `isInTrialPeriod()` checks install-ID file age; `isProTier()` grants Pro during trial window. Post-install banner announces trial with dashboard URL and upgrade path.
- **README hero**: Replaced wordy 15-line opening with tight pain-first copy and a concrete blocked-action terminal example. Leads with "AI agents repeat mistakes. You pay for every retry."
- **GTM content**: Show HN post, Reddit r/ClaudeAI post, Twitter build-in-public thread, 30-second demo script, README hero draft — all in `docs/marketing/`.
- **Test coverage**: Updated rate-limiter tests for trial functions and postinstall tests for new banner content. All passing.
