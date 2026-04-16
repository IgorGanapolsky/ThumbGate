# LinkedIn Manual Reply Check — daily 2-minute runbook

**Status:** current — use this until the LinkedIn Community Management API is approved (see `linkedin-api-application.md`). Scheduled reply monitoring already runs hourly inside Ralph Loop Audience Engagement (`ralph-loop.yml`, cron `17 * * * *`); it calls `social-reply-monitor.js` which is LinkedIn-blind today. Once the API is approved and `LINKEDIN_ACCESS_TOKEN`/`LINKEDIN_PERSON_URN` secrets are set, Ralph Loop picks up LinkedIn replies automatically and this runbook is deprecated.

## Why this runbook exists

LinkedIn's standard Developer API does **not** expose comments on your own posts. The only supported paths are:

1. **Community Management API** — requires LinkedIn approval (weeks-long business review)
2. **Manual dashboard check** — this runbook
3. **Scraping** — violates LinkedIn ToS, risks account ban, do not do this

Until (1) lands, (2) is the honest path. The goal is 2 minutes a day, not a heroic engagement program.

## Daily check (2 minutes, every weekday morning)

1. Open **https://www.linkedin.com/notifications/** — the Notifications tab
2. Filter to **Comments** (top bar)
3. Scan the last 24 hours for:
   - Questions on your posts → reply within 15 minutes of reading (feed algorithm rewards response velocity)
   - Questions on your *comments* on other people's posts → reply same day or let die
   - "Thanks for sharing" / congrats → optional react with 👍, no reply needed
4. Open **https://www.linkedin.com/in/iganapolsky/recent-activity/comments/** — your recent comments tab
   - Look for replies nested under your comments (LinkedIn doesn't notify you reliably for these)

## Response triage

| Comment type | Action | Why |
|---|---|---|
| Technical question from a real developer | Reply with honest, specific answer + repo link if relevant | Highest-value interactions; these convert |
| "Link to study?" / "source?" | Reply with citation within 1 hour or don't reply at all | Half-answer is worse than no answer; it makes you look sloppy |
| Congrats / "interesting post" | React 👍, no reply | Replying "thanks!" burns a notification slot on the commenter and returns zero |
| Pitch from a vendor / agency | Ignore or decline politely | Do not get pulled into DMs that aren't buyers |
| Negative / challenging comment | Reply calmly within 2 hours with evidence | Feed algorithm rewards engagement; a well-handled pushback is worth 5 friendly comments |
| Spam / off-topic | Delete the comment, block the commenter | LinkedIn's spam detection is weak; self-serve moderation |

## Weekly check (10 minutes, Mondays)

1. Export the weekly engagement numbers from **https://www.linkedin.com/analytics/post-analytics/**
2. Look for posts that overperformed your baseline — comment under your own top post to extend its algorithmic life
3. Look for posts that underperformed — note the topic, don't repeat that framing next week
4. Check **https://www.linkedin.com/mynetwork/invitation-manager/** for pending connection requests from anyone who actually engaged with ThumbGate content (accept them; decline randoms)

## What not to do

- **Do not** comment on 3-week-old posts for 5 impressions. That's a rounding error on your time. Stick to:
  - Your own original posts (high leverage)
  - Fresh replies within 60 minutes on posts by accounts with 10K+ followers (rides algorithmic heat)
- **Do not** post the same content across LinkedIn and X without a platform-specific rewrite. LinkedIn audience reads differently.
- **Do not** ask for reactions or reshares in the post body ("please share this!"). LinkedIn's algorithm explicitly down-ranks it.
- **Do not** DM everyone who likes a post to pitch them. That's the #1 way to get reported as spam and tank account reach.

## When this runbook is deprecated

Once the LinkedIn Community Management API approval lands and `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PERSON_URN` are in GitHub secrets, the hourly Ralph Loop Audience Engagement workflow (`ralph-loop.yml`) will auto-fetch comments via `social-reply-monitor.js`, draft responses into `.thumbgate/reply-drafts.jsonl`, and cache state between runs. At that point:

1. Delete this runbook
2. Update the weekly check to instead review the `reply-drafts.jsonl` artifacts that Ralph Loop publishes
3. Keep the "what not to do" list — that's evergreen

## Owner

Igor. This runbook is durable; reply quality is not delegable below founder for pre-revenue stage.
