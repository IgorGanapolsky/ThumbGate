# Replacement for the 2026-04-14 failed Threads post

**Why it failed:** 500-char Threads API limit. Zernio validates at publish-time, not at schedule-time. Validate every draft first:

```bash
node scripts/validate-social-post.js path/to/draft.md
# or
echo "your post text" | node scripts/validate-social-post.js -
```

---

## Replacement post (235 chars — fits every major platform)

```text
Building in public update: 100+ checkout sessions opened. 0 completed. Dug into why. Found the problem in the checkout flow — email gating before users even see the card form. Removing it. Will share the conversion lift numbers in 48h.
```

## Alternative — slightly longer, still under 500

```text
Building in public update.

100+ Stripe checkout sessions opened in the last window. 0 completed.

Dug into the funnel. The problem is not price, not copy, not the product. It's that we gate the Stripe card form behind an email capture. Users bail.

Removing the gate today. 48h conversion numbers next.
```

Char count: 334. Fits Threads (500), X Premium (4000), LinkedIn, Mastodon. Does NOT fit free X (280). Use the short version for X; long version for Threads + LinkedIn.

## Why this post is strong regardless of platform

- Concrete number ("100+", "0") — specificity beats adjectives every time.
- Admits the problem publicly — builds-in-public audience rewards this.
- Commits to a follow-up in 48h — manufactures a return trigger.
- Doesn't sell anything — zero CTA. Content marketing 101.

## After you post

Measure which variant drove more profile clicks in the next 48h. Keep the winning hook. Delete the loser.
