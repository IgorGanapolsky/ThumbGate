# Action-Time Approval Card (2026-05-27)

Guardrail: do not publish posts, send messages, invite people, upload files, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Goal: move 4 warm, already-`contacted` Reddit leads to a pain-confirming reply and a booked Workflow Hardening Diagnostic ($499) or Sprint ($1500), per:
- `docs/COMMERCIAL_TRUTH.md`
- `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- `reports/gtm/2026-05-04-money-now/warm-follow-up-pack-2026-05-27.md`

## Approval request: send 4 follow-up DMs (Reddit)

If approved, send exactly the 4 messages in:
- `reports/gtm/2026-05-04-money-now/warm-follow-up-pack-2026-05-27.md`

Then log each send using the corresponding lead’s `Log after send` command in:
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

## Approval request: Skool conversion unblock (visuals + pinned Start Here)

If approved, apply the conversion unblock steps in:
- `reports/gtm/2026-05-04-community-course-promo/next-actions-2026-05-27.md`

Assets to upload:
- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`

Pinned post draft:
- `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-05-27.md`

## Safe preview (no outbound actions)

- Local Zernio copy/media preview (no publish): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
- GitHub Actions preview (no publish): run `.github/workflows/thumbgate-creator-platform-promo.yml` with `mode=preview` and `offer=operator-lab`

