---
thumbgate: patch
---

Documentation + landing-page truthfulness audit: align all public copy and docs with the product's real behavior.

- Enforcement: reworded ~300 claims across README, landing page, all `learn/`, `guides/`, `compare/` pages, and docs from false "physically blocks / cannot bypass / fails closed / blocks every repeat" to the accurate warn-by-default posture — ThumbGate flags and logs by default, hard-blocks only the catastrophic classes (secret exfiltration, destructive deletes, supply-chain) by default, and hard-blocks every rule under `THUMBGATE_STRICT_ENFORCEMENT=1`. "block" language retained only where true (catastrophic classes / strict mode).
- Removed the unrelated Pretix/Hilltown Media Stripe-Connect consulting content from all public surfaces (meta, JSON-LD, about, learn, llms.txt) and deleted the Pretix case-study page.
- Fixed the false free-tier "5-rule cap" → 3 (the canonical, test-enforced number); removed the fabricated "Most popular" badge; corrected internal docs that claimed "$20 booked revenue / first-dollar crossed" to the true 0 external customers.
- Aligned moat copy with `MOAT.md` (hosted services, not a closed private "core"); marked regulated/enterprise claims (HIPAA/DORA/EU AI Act/SSO) as roadmap/available-on-request; fixed a stale `1.27.17` install version → 1.27.20; softened a "peer-reviewed" arXiv-preprint claim; removed retired X/Twitter links.
- Updated the pinning tests (check-congruence, public-landing, public-static-assets) to assert the new truthful copy so CI enforces honesty going forward.
