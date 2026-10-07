---
name: thumbgate-always-on-promotion
description: >
  Durable ThumbGate promotion cadence: one meaningful post per day from cron, and technical community replies on a separate loop. Use when Igor asks if engagement is 24/7, asks for a cron or a skill for posts, or a Gmail notice looks like an unanswered CoderLegion comment.
---

# ThumbGate always-on promotion

Two loops. Keep them separate.

## Meaningful post

Once per local calendar day. Cron and the LaunchAgent `com.thumbgate.always-on-promotion` both run `scripts/thumbgate-always-on.sh`:

- `5 9 * * *` is the morning post
- `0 */4 * * *` is the same script again while the Mac is awake
- The LaunchAgent uses the same hours at minute 5. A calendar job that was due while the Mac slept runs on wake. Cron does not.

`node scripts/thumbgate-daily-discoveries-publish.js` skips the day when `.thumbgate/daily-discoveries-ledger.jsonl` already has `status: published` for that date. The script does not send email. Do not load `com.thumbgate.daily-publish`. That plist stays renamed with the `.disabled-chief-cold-send-20261005` suffix.

Each post names the install line `npx thumbgate init` and Pro at $19 a month or $149 a year per operator. Links are `https://thumbgate.ai/go/pro` with UTM and `https://thumbgate.ai/pricing`. Do not invent revenue, customers, traction, or a latency number.

Log: `~/Library/Logs/thumbgate-always-on.log`.

## Technical comments

Every 30 minutes, only while this Grok session is alive. One peer comment on ZyVOP. No product name, no link, and no claim that ThumbGate runs Jev. A shell cron cannot post those comments. The session scheduler is `01a10ceb-e1cd-7b71-b71b-c4ed6454e55d`. Do not start a second pass in the same half hour.

## Replies

Reply once to a new comment on Igor's own CoderLegion post. If `.thumbgate/coderlegion-engagement-ledger.jsonl` already has that comment id, stop. A Gmail row that says someone commented is the notification. Open the article before writing another reply.

Accept CoderLegion Received Requests only when that count is above 0. Do not click suggested Connect.

## Mail

Business mail goes out only as Igor Ganapolsky <igor@igorganapolsky.com>. Do not send a copy from iganapolsky@gmail.com.

## Verify

```bash
crontab -l | grep thumbgate-always-on
launchctl print gui/$(id -u)/com.thumbgate.always-on-promotion | head -n 20
tail -n 30 ~/Library/Logs/thumbgate-always-on.log
```
