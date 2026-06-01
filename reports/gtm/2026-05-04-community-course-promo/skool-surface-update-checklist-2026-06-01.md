# Skool Surface Update Checklist — 2026-06-01

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Skool group: https://www.skool.com/thumbgate-operator-lab-6000

This is an approval-ready, step-by-step checklist for Decision E in `reports/gtm/2026-05-04-money-now/action-time-approval-2026-06-01.md`.

## Assets (local)

- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- About/hero image: `docs/marketing/assets/thumbgate-operator-lab-about-hero.png`
- Optional post image (square): `docs/marketing/assets/thumbgate-operator-lab-social-square.png`

## Copy sources (local)

- Listing/About copy: `reports/gtm/2026-05-04-community-course-promo/skool-course-listing-copy-2026-06-01.md`
- “Start Here” pinned post: `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-06-01.md`

## Steps (action-time only)

1) Update Skool group cover to `thumbgate-skool-cover-1084x576.png`.
2) Update Skool group icon to `thumbgate-skool-icon-128x128.png`.
3) Update **Group description** (150-char field) using the `Group description` block in `skool-course-listing-copy-2026-06-01.md`.
4) Update **About page description** (1000-char field) using the `About page description` block in `skool-course-listing-copy-2026-06-01.md`.
5) Upload About/hero image `thumbgate-operator-lab-about-hero.png` if Skool allows a hero/media slot.
6) Create the “Start Here” router post using `skool-start-here-post-2026-06-01.md`.
7) Pin the router post to the top of the feed.
8) Verify the 3 routing links render and are clickable:
   - Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
   - Diagnostic: route from the Sprint intake page (no separate public URL in this repo)
   - Pro: `https://thumbgate-production.up.railway.app/checkout/pro`
9) Traffic attribution sanity check:
   - Prefer sharing the About page link directly (avoid redirect/link-in-bio shorteners) so Skool traffic sources remain clean.
10) Discovery eligibility check:
   - Confirm the group is not showing as `UNLISTED` after: cover image + group description + About page + at least one post + at least one invited member.

## Success criteria (observable)

- New visitor landing on the group sees the offer ladder immediately (Pro vs Diagnostic vs Sprint).
- Pinned router post exists and is visibly pinned.
- Cover/icon/hero render correctly (no stretched crops).
- Group description + About page copy fit within field limits (no truncation).
