# Implementation Notes: YC/HN draft scout

Date: 2026-06-05

## Decisions

- Used live web verification for opportunity selection because recency matters for HN, YC launches, LinkedIn posts, and GitHub issues.
- Reused existing repo positioning from `docs/marketing/show-hn.md`, `docs/marketing/hn-replies-2026-05-11.md`, and `docs/marketing/oss-pr-opportunity-scout.*` instead of inventing a new voice.
- Chose a draft-only markdown artifact under `.thumbgate/drafts/` because the task explicitly prohibited posting.

## Assumptions

- VERIFIED: `docs/marketing/yc-hn-engagement-pack.md` and `scripts/yc-hn-engagement-pack.js` are not present in the repo yet.
- VERIFIED: Existing adjacent materials exist for HN and OSS contribution scouting.
- VERIFIED: Local automation memory file did not exist at start of run.
- UNVERIFIED: LinkedIn engagement copy may need shortening depending on the author/comment UI constraints.

## Tradeoffs

- Prioritized fewer, higher-signal opportunities over broad coverage.
- Included two GitHub issue contribution lanes because the prompt preferred useful upstream contributions over promotional replies.
- Kept repo/product links out of most drafts unless directly relevant, to reduce shill risk on HN and LinkedIn.

## Notes For Next Run

- If `docs/marketing/yc-hn-engagement-pack.md` or `scripts/yc-hn-engagement-pack.js` land, prefer them as the primary template/input.
- Good next scout targets are fresh founder posts from Respan, Silmaril, and OpenProse, plus any new MCP spec/SDK issue around annotations, identity, or policy metadata.
