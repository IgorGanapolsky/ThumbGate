# Next Actions — Skool Operator Lab (2026-05-18)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Operator Lab assets (present in repo): `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`, `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Next approval-ready money actions (highest ROI first)

### 1) Warm DMs (4) → book diagnostic → route to Sprint ($1500) or Diagnostic ($499)

Send the 4 warm Reddit Workflow Hardening Sprint DMs from:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`

After each DM, advance the lead using the matching `Log after send` command in:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

### 2) Skool “Start Here” + visuals (unblocks conversion)

When approved, update Skool group visuals using:

- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`

Then publish/pin a “Start Here” post that routes:

- Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
- Pro: `https://thumbgate-production.up.railway.app/checkout/pro`
- Proof: `docs/VERIFICATION_EVIDENCE.md`

### 3) GH Actions promo workflow: preview exact media-backed posts before any publish/schedule

Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`

Approved-safe preview command (local equivalent):

`npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Publish/schedule modes remain blocked unless `ZERNIO_API_KEY` is present in GitHub secrets.

