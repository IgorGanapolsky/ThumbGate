---
"thumbgate": patch
---

Wire Bluesky reply monitoring into Ralph Loop (hourly CI) as a draft-only step.

Zernio exposes no inbound/comments API as of 2026-04-21 (probed — `/inbox`, `/comments`, `/conversations`, `/messages`, `/dms`, `/threads`, `/engagements`, `/replies` all return 404 with HTML shell while `/accounts` returns 200 JSON). The Zernio Inbox add-on visible on the billing dashboard is a human-only surface. Reply monitoring for Bluesky therefore uses direct AT Protocol: `scripts/social-reply-monitor-bluesky.js` polls `app.bsky.notification.listNotifications` on the user's PDS and queues drafts to `.thumbgate/reply-drafts.jsonl`. The monitor never auto-posts — a draft-only posture was made mandatory after a CEO thumbs-down on AI-pitch reply voice.

New `reply-monitor-bluesky` step in `scripts/ralph-loop.js` gated on `requiredEnvAll: ['BLUESKY_HANDLE','BLUESKY_APP_PASSWORD']`. Workflow env block in `.github/workflows/ralph-loop.yml` passes the new repo secrets. Tests in `tests/ralph-loop.test.js` pin the step list and skip-reason contract.

Also ships two one-shot operator tools: `scripts/bluesky-list-actionable.js` dumps un-replied notifications for human triage, `scripts/bluesky-delete-replies.js` rolls back via `com.atproto.repo.deleteRecord`. The `skills/bluesky-engagement/SKILL.md` is the authoritative reference for credential rotation and the voice guardrail lesson.
