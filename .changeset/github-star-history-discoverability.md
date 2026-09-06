---
"thumbgate": patch
---

Measure ThumbGate GitHub star growth with GitHub's privacy-safe `stargazers/history` REST endpoint (weekly counts, no stargazer identities) and surface live star + npm-download badges on the README.

`npm run stars:history` parses weekly buckets, refuses listing payloads that include logins, and never treats stars as npm installs or revenue. Complements the existing GitHub traffic poller snapshot; does not clone star-history.com.

README now leads with usage over star count (npm, Marketplace `uses:`, clones) so the repo can be judged without a pitch deck. Adds Contributor Covenant + Issue contact links so GitHub Community health is complete.

`npm run github:achievements` inventories public profile badges honestly and refuses YOLO/Quickdraw/fake-coauthor farm recipes from achievement guides. Does not clone 4xmen/get-github-achievements.
