---
"thumbgate": patch
---

Measure ThumbGate GitHub star growth with GitHub's privacy-safe `stargazers/history` REST endpoint (weekly counts, no stargazer identities) and surface live star + npm-download badges on the README.

`npm run stars:history` parses weekly buckets, refuses listing payloads that include logins, and never treats stars as npm installs or revenue. Complements the existing GitHub traffic poller snapshot; does not clone star-history.com.
