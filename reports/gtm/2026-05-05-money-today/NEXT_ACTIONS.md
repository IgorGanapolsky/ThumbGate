# Next Actions (Money Today, 2026-05-05)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

## Highest-ROI cash action (approval needed)

Send the 4 warm Reddit Workflow Hardening Sprint DMs from:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

After each send, run that row’s `Log after send` command so the sales ledger stays truthful:

- `reports/gtm/2026-05-04-money-now/sales-pipeline.md`

Note: today’s automated Reddit DM workflow run failed with OAuth `401 Unauthorized` (see `operator-close-packet.md`). Treat all “sent” status from that automation run as unverified until Reddit confirms message delivery.

## Skool unblocker (approval needed)

Goal: finish Skool Discovery eligibility blockers (About save + cover/icon).

- About copy + pinned post copy: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Cover/icon assets: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`, `docs/marketing/assets/thumbgate-skool-icon-128x128.png`

If the in-app file picker is blocked, do the cover/icon upload in a normal browser outside the in-app picker surface.

## Promo workflow readiness (preview is safe; publish/schedule require approval)

GitHub Actions workflow:

- `.github/workflows/thumbgate-creator-platform-promo.yml`

Approval-ready workflow inputs:

- `mode=preview`
- `offer=operator-lab`
- `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Local proof that the campaign is media-backed and assets exist (dry-run output includes `mediaPlan.path`):

```bash
npm run social:publish:launch -- \
  --dry-run \
  --offer=operator-lab \
  --platforms=linkedin,instagram,threads,bluesky,reddit,youtube
```

