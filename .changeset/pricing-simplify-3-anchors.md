---
"thumbgate": patch
---

Collapses the public pricing surface on `thumbgate.ai` from 13 visible price points to 3 (Free / $19 Pro / Talk-to-us). The other anchors ($49 Team, $147/mo, $297/mo, $499 audit, $1,500 Workflow Hardening Sprint, $7/mo Solo, etc.) are moved behind a "More options" link or the `/pricing/full` page so they remain discoverable but don't compete for the first-touch click.

Why: an audit on 2026-05-19 found the landing page surfaced 13 distinct prices simultaneously. Industry best practice for SMB-funnel pages is ≤3 anchor prices on the primary surface (choice paralysis is the conversion killer when more anchors are visible). Stripe history shows $0 ThumbGate Pro charges to date despite the product being live; the funnel friction is upstream of the checkout link.

This is a presentation-layer change in `public/index.html` only — no pricing model changes, no Stripe price ID changes, no breaking changes to the underlying tiers.
