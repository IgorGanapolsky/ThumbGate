# Next Actions — Skool Operator Lab (2026-06-01)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Action-time approval card:

- `reports/gtm/2026-05-04-money-now/action-time-approval-2026-06-01.md`

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Skool copy pack: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Next approval-ready money actions (highest ROI first)

### 1) Warm DMs (12 total) → log → route to Diagnostic/Sprint/Pro

- Queue + copy: `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- Logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`

Approval rows:

- A1 (warm Sprint DMs 1–4)
- A2 (Pro guide-first 5–7)
- A3 (Sprint rollout 8–12)

### 2) Skool surface (unblocks conversion once traffic lands)

- Visual assets: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`, `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- About + pinned post copy: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`

Approval rows:

- B1 (visuals)
- B2 (“Start Here” pinned post)

### 3) Creator-platform promo workflow (preview-only unless approved)

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Local preview (safe): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Approval rows:

- C1 (preview)
- C2 (publish)
- C3 (schedule)

