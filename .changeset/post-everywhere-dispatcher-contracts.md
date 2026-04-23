---
'thumbgate': patch
---

Fix three post-everywhere dispatcher contract mismatches discovered live
2026-04-22 during the ChatGPT CPC ads campaign:

- `postToLinkedIn` called `linkedin.publishPost({text})`; the module exports
  `publishTextPost(token, personUrn, text)`.
- `postToThreads` called `threads.publishPost({text})`; no such export (real
  entry is `postTextThread({text, token, userId})`).
- `postToBluesky` called `zernio.publishPost({text, platform})`; the real
  signature is `publishPost(content, platforms[], options)` with `accountId`
  required on each platform entry.

All three now route through `zernio.publishToAllPlatforms(content,
{platforms:[<name>]})` — single code path, account discovery handled by
Zernio. Contract tests in `tests/post-everywhere-channels.test.js` spy on
`publishToAllPlatforms` and pin the call shape so this bug class cannot land
again.
