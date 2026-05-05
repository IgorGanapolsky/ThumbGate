# Next Actions (2026-05-05)

Guardrail: do not publish posts, send messages, invite members, create accounts, change billing, upload files to third-party services, submit forms, or run paid ads without explicit action-time confirmation.

## Highest-ROI Money Action (approval needed)

Send the 4 warm Reddit Workflow Hardening Sprint DMs (copy + tracking commands live in `reports/gtm/2026-05-04-money-now/operator-send-now.md`).

Order:

1. `reddit_deep_ad1959_r_cursor`
2. `reddit_game_of_kton_r_cursor`
3. `reddit_leogodin217_r_claudecode`
4. `reddit_enthu_cutlet_1337_r_claudecode`

Rule: after each send, run that row's `Log after send` command (sales ledger truth > vibes).

## Skool Unblocker (approval needed)

Goal: get Skool Discovery eligibility unblocked with clean artwork + About page save.

- Paste-ready About + pinned post copy:
  - `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Artwork (local files for direct upload):
  - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- If Skool requires direct file upload for cover/icon, upload in a normal browser outside the in-app file picker surface (Codex in-app file picker is blocked).

## Promo Workflow Readiness (approval needed to run, safe in preview)

GitHub Actions workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`

- `mode=preview` generates a dry-run media-backed campaign for `--offer=operator-lab`
- `mode=schedule` / `mode=publish` are external actions and require explicit confirmation
