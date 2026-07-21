---
"thumbgate": patch
---

Scope the deploy-claim and PR-thread Stop hooks so unrelated claims (a local model's deploy state, a sibling repo's merged PR) no longer false-positive block the turn, while genuine ThumbGate production/PR claims without evidence still hard-block as before, including ones phrased without the words "ThumbGate" or "production". The deploy-claim hook now defaults strict and only skips the check on an explicit signal the claim is about a different, named system (an exclusion list), rather than requiring ThumbGate/production wording to enable the check (an inclusion list that a real claim could fail to match). The PR-thread hook now fails closed when it cannot determine whether a PR exists (gh missing, expired auth, transient API error) instead of silently treating any lookup failure as "no PR".
