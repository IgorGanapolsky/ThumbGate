# Next Actions — Skool Operator Lab (2026-06-01)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Action-time approval card: `reports/gtm/2026-05-04-money-now/action-time-approval-2026-06-01.md`
  - Course/listing copy: `reports/gtm/2026-05-04-community-course-promo/skool-course-listing-copy-2026-06-01.md`
  - Skool platform requirements: `reports/gtm/2026-05-04-community-course-promo/platform-requirements-skool-2026-06-01.md`
  - Text-first post pack: `reports/gtm/2026-05-04-community-course-promo/operator-lab-post-pack-2026-06-01.md`
  - Welcome/comment pack: `reports/gtm/2026-05-04-community-course-promo/skool-welcome-comment-pack-2026-06-01.md`
  - 7-day onboarding drip (text-first): `reports/gtm/2026-05-04-community-course-promo/skool-7day-onboarding-drip-2026-06-01.md`
  - Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Next approval-ready money actions (highest ROI first)

### 1) Warm DMs (4) → book diagnostic → route to Sprint ($1500) or Diagnostic ($499)

Send the 4 warm Reddit Workflow Hardening Sprint DMs from:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`

After each DM, advance the lead using the matching `Log after send` command in:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

### 2) Skool conversion surfaces (cover, icon, About, pinned “Start Here”)

When action-time approved, set:

- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- About/course copy: `reports/gtm/2026-05-04-community-course-promo/skool-course-listing-copy-2026-06-01.md`
- Classroom outline (text-first): `reports/gtm/2026-05-04-community-course-promo/skool-classroom-outline-2026-06-01.md`
- “Start Here” router post: `reports/gtm/2026-05-04-community-course-promo/skool-start-here-post-2026-06-01.md`
- Checklist: `reports/gtm/2026-05-04-community-course-promo/skool-surface-update-checklist-2026-06-01.md`

Then publish/pin a “Start Here” post that routes:

- Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
- Pro: `https://thumbgate-production.up.railway.app/checkout/pro`
- Proof: `docs/VERIFICATION_EVIDENCE.md`

### 3) GH Actions promo workflow: preview exact media-backed posts before any publish/schedule

Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`

Approved-safe preview command (local equivalent):

`npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Publish/schedule modes remain blocked unless `ZERNIO_API_KEY` is present in GitHub secrets (and action-time approval is granted).
