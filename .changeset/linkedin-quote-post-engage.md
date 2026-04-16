---
"thumbgate": patch
---

Add LinkedIn quote-post engagement pivot: `linkedin-quote-post.js` publisher + `linkedin-quote-post-engage.yml` workflow_dispatch. Publishes a standalone post on the authenticated member's feed with `reshareContext.parent` referencing the target activity URN, so we can engage with thought-leader posts when the Community Management API (`socialActions/{urn}/comments`) is not available on the app. Uses only `w_member_social` — already granted via the existing "Share on LinkedIn" product — no additional LinkedIn Developer Portal approvals required. The original author receives a mention-style notification through the reshare reference.
