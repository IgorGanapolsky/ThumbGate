---
name: revenue-push
description: >
  Daily revenue loop for the operator's products (ThumbGate, Dayglass, Mac YOLO
  Safeguards): check live revenue, publish the next scheduled launch post,
  follow up on open leads and AI intro-agent threads, and log receipts. Use
  when asked to "make money", "promote", "post", "do outreach", or on the daily
  schedule. Ships the work instead of handing the operator a to-do list.
---

# Revenue Push — Ship One Revenue Action Per Channel, With Receipts

## 0. Ground truth first

- Run `node scripts/revenue-status.js` (see `revenue-truth`). Quote the output
  or say UNKNOWN. Never quote planning docs as actuals.
- Load the project's memory (Claude project memory / `primer.md` /
  `.claude/memory`) for: where launch drafts live, which channels are
  connected, open lead threads and their last state, and known site
  inconsistencies. Don't redraft what already exists.

## 1. Fix-before-post

Before promoting a product, check its "known inconsistencies" list (pricing
that differs between pages, offer names, missing proof). A post that sends
traffic to a contradictory page wastes the post. Open a fix PR if the site
lives in a repo you can reach; otherwise note it in the report.

## 2. Publish (one product per cycle, rotate)

- Use the canonical pipeline: `scripts/post-everywhere.js <post.md>`
  (Zernio-backed where `ZERNIO_API_KEY` is set). Run `--dry-run` first, then
  `scripts/validate-social-post.js` / `social-quality-gate`.
- Active channels: Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube
  (X retired; see CLAUDE.md). Launch sites (Product Hunt, Gumroad listing
  updates) are scheduled launches, not daily posts.
- Platform rules are hard limits: follow each subreddit's self-promo rules,
  disclose you're the maker, one post per community per launch, no vote or
  engagement manipulation, no cross-posting the same text to many subs.
- Replies to comments are DRAFT-ONLY (`.thumbgate/reply-drafts.jsonl`) — never
  auto-post replies (CEO decision 2026-04-21).
- No invented numbers: no user counts, stars, testimonials or revenue that
  aren't verified. Leave `[placeholder]` and report it.

## 3. Follow up on leads and intro agents

- **Run `outreach-do-not-contact` before every send.** A match means no send,
  on any channel; log it as SKIPPED.
- For each open lead / partnership / AI intro-agent thread (e.g. networking
  agents the operator works with by email) that passes the gate: read the
  latest message, then send the next concrete ask — a specific intro profile,
  a call slot, or a yes/no.
- Respect stop signals. If the latest message in a thread is an explicit
  "stop contacting", only re-engage when the operator himself has asked to in
  his own words, and say so in the reply.
- Follow-up cadence: no reply after 5 days → one short nudge; after a second
  silence, mark the lead cold. Never more than 2 unanswered nudges.
- If the mail connector isn't available, follow `blocked-action-fallback`
  (other routes, then save the final send-ready reply for the next session).
  Sends that need the operator's signed-in Mac go through `mac-dispatch`, with
  the do-not-contact check written into the task.

## 4. Receipts (mandatory)

Every external effect gets a receipt line in the project's outreach log:

```
<ISO time> | <channel> | <product> | <action: posted/sent/followed-up> | <URL or message id> | <result if known>
```

No URL / message id = it didn't happen. Mark it ATTEMPTED, not DONE. Format
and states: `receipts-or-blocked`.

## 5. Report

Lead with outcome: revenue (live number or UNKNOWN), what was published (links),
who was contacted, what's blocked and on what. Then update project memory with
anything the next run would otherwise have to rediscover.
