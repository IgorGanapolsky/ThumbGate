# Next Actions — Skool Operator Lab (2026-05-30)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Skool group: https://www.skool.com/thumbgate-operator-lab-6000
- Operator Lab assets (local files):
  - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Course/classroom listing copy (prep only): `reports/gtm/2026-05-04-community-course-promo/course-listing-copy-operator-lab-2026-05-27.md`
- Skool pinned “Start Here” post (prep only): `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-05-27.md`
- Skool post pack (prep only; includes Diagnostic + Pro lanes): `reports/gtm/2026-05-04-community-course-promo/skool-post-pack-2026-05-26.md`
- Week 1 content sequence (prep only): `reports/gtm/2026-05-04-community-course-promo/operator-lab-week-1-sequence-2026-05-26.md`
- Attendee outreach drafts (prep only): `reports/gtm/2026-05-04-community-course-promo/operator-lab-attendee-queue-2026-05-27.md`
- Comment + DM pack (prep only): `reports/gtm/2026-05-04-community-course-promo/operator-lab-comment-pack-2026-05-27.md`

## State check (verified locally)

- Local media-backed preview succeeds (no outbound actions) and finds assets (`exists: true`):
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

## Next approval-ready money actions (highest ROI first)

### 1) Warm DMs (4) → pain-confirm → book diagnostic → route to Sprint ($1500) or Diagnostic ($499)

- Send the 4 warm Reddit Workflow Hardening Sprint follow-ups in:
  - `reports/gtm/2026-05-04-money-now/warm-follow-up-pack-2026-05-27.md`
- After each DM, advance the lead using that row’s `Log after send` command in:
  - `reports/gtm/2026-05-04-money-now/operator-send-now.md`

### 2) Skool conversion unblock: visuals + pinned “Start Here”

When approved:

1. Upload cover + icon in Skool Settings:
   - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
   - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
2. Publish + pin a “Start Here” post that routes:
   - Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
   - Pro: `https://thumbgate-production.up.railway.app/checkout/pro`
   - Proof: `docs/VERIFICATION_EVIDENCE.md`
   - Use: `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-05-27.md`

### 3) Creator-platform promo: preview now, publish/schedule later (action-time confirm)

Safe preview options:

- Local: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
- GitHub Actions: run `.github/workflows/thumbgate-creator-platform-promo.yml` with:
  - `mode=preview`
  - `offer=operator-lab`
  - (optional) `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Approval-gated (writes to creator platforms):

- Run `.github/workflows/thumbgate-creator-platform-promo.yml` with:
  - `mode=publish` (immediate), or
  - `mode=schedule` plus a future ISO-8601 `schedule` value and `timezone=America/New_York`
