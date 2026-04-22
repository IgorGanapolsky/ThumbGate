---
'thumbgate': patch
---

Align `scripts/social-reply-monitor.js` and `scripts/social-analytics/poll-all.js`
with the CLAUDE.md X/Twitter retirement (2026-04-20). The reply monitor's
`checkXReplies` branch (plus its `collectXSearchCandidates`,
`isRevenueRelevantXTweet`, `buildOwnedConversationQuery`, and `DEFAULT_X_HANDLE`
helpers) has been removed — the default platform list is now `['reddit', 'linkedin']`.
`LEGACY_POLLERS` no longer contains the `x` entry, and `scripts/social-analytics/pollers/x.js`
and `scripts/social-analytics/publishers/x.js` have been deleted. The
`social:poll:x` npm script has been removed. Tests in
`tests/social-reply-monitor.test.js`, `tests/zernio-canonical-pollers.test.js`,
and `tests/social-analytics.test.js` are pinned to the new surface.
