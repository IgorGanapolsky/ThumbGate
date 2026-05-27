# Action-Time Approval Card (2026-05-30)

Guardrail: do not publish posts, send messages, invite people, upload files, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Goal: convert warm and high-intent leads into a booked Workflow Hardening Diagnostic (`$499`), Workflow Hardening Sprint (`$1500`), or Pro (`$19/mo` or `$149/yr`), per:
- `docs/COMMERCIAL_TRUTH.md`
- `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

## Approval request: send warm follow-ups (4) + self-serve touches (3)

If approved, send:

1) the 4 warm Reddit follow-ups in:
   - `reports/gtm/2026-05-04-money-now/warm-follow-up-pack-2026-05-27.md`
2) the 3 self-serve Pro guide-first messages (from the corresponding rows) in:
   - `reports/gtm/2026-05-04-money-now/operator-send-now.md`

Then log each send using the lead’s `Log after send` command in:
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

## Approval request: Skool conversion unblock (visuals + pinned Start Here)

If approved, apply the conversion unblock steps in:
- `reports/gtm/2026-05-04-community-course-promo/next-actions-2026-05-30.md`

Assets to upload:
- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`

Pinned post draft:
- `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-05-27.md`

## Safe preview (no outbound actions)

- Local Zernio copy/media preview (no publish): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
- GitHub Actions preview (no publish): run `.github/workflows/thumbgate-creator-platform-promo.yml` with `mode=preview` and `offer=operator-lab`
