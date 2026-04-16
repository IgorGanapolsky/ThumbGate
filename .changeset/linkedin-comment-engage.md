---
"thumbgate": patch
---

Add LinkedIn one-shot comment engagement: `publishComment` publisher
(`scripts/social-analytics/publishers/linkedin-comment.js`) that posts a comment
on a specified activity URN via the socialActions endpoint, plus a
`linkedin-comment-engage.yml` workflow_dispatch that runs it with the
`LINKEDIN_ACCESS_TOKEN` / `LINKEDIN_PERSON_URN` secrets. Used for
high-signal targeted engagements on prospect / thought-leader posts
whose audience overlaps ThumbGate's ICP; bulk / scheduled engagement
still flows through Ralph Loop.
