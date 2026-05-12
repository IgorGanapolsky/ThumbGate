---
"thumbgate": minor
---

Fix the activation loop: a single 👎 now auto-promotes a working gate. Lowered `WARN_THRESHOLD` in `scripts/auto-promote-gates.js` from `2 → 1`. Block escalation (`BLOCK_THRESHOLD = 3`) is unchanged, so noise doesn't auto-hard-block. Also expands `HIGH_RISK_TAGS` in `scripts/feedback-to-rules.js` to match the tag vocabulary `inferSemanticTags()` actually emits (`destructive`, `force-push`, `delete`, `drop`, `production`, `database`, `payment`, `credentials`, `secrets`, `data-loss`, etc.) so the high-risk-tag fast-path also triggers on first capture for matching destructive patterns. Cold-buyer experience was: install → give 1 👎 → "No domain has reached the threshold (2) yet" → bail. After this fix: install → give 1 👎 → gate `auto-*` with `action: warn` is live, visible in `npx thumbgate gate-stats`. Updates `tests/auto-promote-gates.test.js` to pin the new 1/3 contract.
