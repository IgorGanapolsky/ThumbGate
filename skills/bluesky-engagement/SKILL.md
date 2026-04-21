---
name: bluesky-engagement
description: >
  Automated Bluesky reply monitoring and draft queueing for ThumbGate's
  acquisition engagement loop. Polls the AT Protocol notifications endpoint
  every 15 minutes, writes human-reviewable draft replies into a queue file,
  and never auto-posts without sign-off. Trigger when the user asks about
  Bluesky replies, engagement, reply monitoring, or wants to see/approve
  queued drafts. Also the authoritative reference for rotating the Bluesky
  app password or diagnosing monitor failures.
---

# Bluesky Engagement

Automation for Bluesky reply tracking. The monitor reads; a human (or a queue consumer with explicit approval) writes.

## Why this exists

Bluesky is a Zernio-connected channel for publishing, but Zernio does not expose an inbound/comments API. Engagement has to run directly against the open AT Protocol. This skill owns that path so future sessions don't re-ask for credentials or re-derive the PDS routing.

## Credentials

Both are set in `.env` at repo root (git-ignored):

| Var | Source | Notes |
|---|---|---|
| `BLUESKY_HANDLE` | bsky profile URL | e.g. `iganapolsky.bsky.social` |
| `BLUESKY_APP_PASSWORD` | <https://bsky.app/settings/app-passwords> | Scoped, revocable. Never use the account login password. |

**Rotation**: revoke the old app password at the settings URL above, generate a new one named `thumbgate-replies`, and replace the value on the `BLUESKY_APP_PASSWORD=` line of `.env`. No other files need updating.

## Architecture

```
launchd (com.thumbgate.bluesky-reply-monitor)
  └─ every 900s ─> node scripts/social-reply-monitor-bluesky.js
                    ├─ com.atproto.server.createSession (bsky.social)
                    │  └─ reads didDoc to find user's real PDS
                    ├─ app.bsky.notification.listNotifications (user's PDS)
                    ├─ filter reason in {reply, mention, quote}
                    ├─ dedupe against .thumbgate/reply-monitor-state.json
                    ├─ generateReply() — shared with Reddit/X monitor
                    └─ append to .thumbgate/reply-drafts.jsonl
```

**Federation note**: authenticated AT Protocol calls must hit the user's own PDS (`session.didDoc.service[].serviceEndpoint`), not `bsky.social`. Hitting `bsky.social` returns `502 UpstreamFailure`. This was the first bug.

**Transient failures**: Bluesky's appview returns 502 during incidents. The monitor detects 5xx / UpstreamFailure / ECONNRESET and exits 0 so launchd doesn't mark the agent failed.

## File layout

| Path | Purpose | Tracked? |
|---|---|---|
| `scripts/social-reply-monitor-bluesky.js` | The monitor itself | yes |
| `~/Library/LaunchAgents/com.thumbgate.bluesky-reply-monitor.plist` | 15-min schedule | no (user-scope) |
| `.thumbgate/reply-monitor-state.json` | Dedupe state (also used by Reddit/X monitor) | no |
| `.thumbgate/reply-drafts.jsonl` | Human-review queue | no |
| `.thumbgate/bluesky-monitor-stdout.log` | launchd stdout | no |
| `.thumbgate/bluesky-monitor-stderr.log` | launchd stderr (transient 502 warnings land here) | no |

## Commands

```bash
# One-off dry run (no state mutation, logs what would be queued)
node scripts/social-reply-monitor-bluesky.js --dry-run

# One-off real run (appends to .thumbgate/reply-drafts.jsonl)
node scripts/social-reply-monitor-bluesky.js

# Reload the launchd agent after editing the plist
launchctl unload ~/Library/LaunchAgents/com.thumbgate.bluesky-reply-monitor.plist
launchctl load   ~/Library/LaunchAgents/com.thumbgate.bluesky-reply-monitor.plist

# Check the agent is alive
launchctl list com.thumbgate.bluesky-reply-monitor

# Tail the logs
tail -f .thumbgate/bluesky-monitor-stderr.log

# Inspect queued drafts
cat .thumbgate/reply-drafts.jsonl | jq -r 'select(.platform=="bluesky") | "\(.createdAt) @\(.notification.authorHandle): \(.incomingText[0:80])"'
```

## Draft-queue consumption

The monitor NEVER auto-posts. Drafts sit in `.thumbgate/reply-drafts.jsonl` with `autoPost: false`. Human workflow:

1. Review the queue.
2. For each draft you want to send, open the notification URI in Bluesky and reply manually (or later, build a `send-reply-queue.js` consumer that hits `com.atproto.repo.createRecord` with `app.bsky.feed.post` — keep the `root`/`parent` CID+URI pair the monitor already stored).

Auto-sending is deliberately deferred until there's a UI approval step. This is how we stay off the bot-slop/banned list.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Bluesky auth failed (status=401)` | app password revoked or rotated elsewhere | regenerate per Rotation steps above |
| `listNotifications failed on bsky.social: 502` | hitting the wrong host | the script auto-routes to PDS; if you see this, the didDoc parsing broke — inspect `session.didDoc.service` |
| `listNotifications failed on <user-pds>: 502 UpstreamFailure` | Bluesky appview incident | nothing to do; soft-fails, next tick retries |
| stderr log grows but no drafts appear | all notifications already in state file or all reasons are `like`/`follow` (we only handle reply/mention/quote) | inspect state file: `jq '.repliedTo.bluesky' .thumbgate/reply-monitor-state.json` |

## CI wiring (Ralph Loop)

As of 2026-04-21 this monitor also runs hourly in GitHub Actions via `.github/workflows/ralph-loop.yml` → `scripts/ralph-loop.js` → step id `reply-monitor-bluesky`. The step is gated on `requiredEnvAll: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD']` (GitHub repo secrets) and writes the same draft file the local launchd agent does. Never auto-posts in either path.

## Voice guardrail (2026-04-21)

First autonomous-posting attempt (`scripts/bluesky-send-replies.js`, removed 2026-04-21) was reverted after the CEO thumbs-downed the AI-pitch tone on a live reply. All 6 live replies were deleted via `scripts/bluesky-delete-replies.js` (calls `com.atproto.repo.deleteRecord`). The lesson, captured as memory `mem_1776790570289_oc2z6g`: do not write replies that open with "Exactly"/"Right —", do not name-drop ThumbGate features inside conversational replies, keep replies to 1–2 sentences in the voice of a human peer. Until this is enforced by a gate rule, the monitor stays draft-only and a human sends the actual reply.

## Related

- `scripts/social-reply-monitor.js` — Reddit, X, LinkedIn monitor. Shares `generateReply()` and the draft file.
- `scripts/bluesky-list-actionable.js` — one-shot dump of un-replied notifications for human triage.
- `scripts/bluesky-delete-replies.js` — one-shot rollback; reads `postedUri` entries out of `.thumbgate/reply-monitor-state.json` and calls `com.atproto.repo.deleteRecord`.
- `scripts/social-analytics/publishers/zernio.js` — publishes Bluesky *posts* via Zernio. Separate concern.
- `CLAUDE.md` → "Social stack: Zernio canonical" — explains why publishing uses Zernio but engagement doesn't (Zernio Inbox is dashboard-only, no public API as of 2026-04-21).
