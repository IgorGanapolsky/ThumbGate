# Action-Time Approval Card — 2026-06-01

Guardrail: do not publish posts, send messages, invite members, upload files, create paid accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

This card is the single place to approve outbound actions for this run. When an action is executed, log it immediately in `reports/gtm/2026-05-04-money-now/operator-send-now.md` using the matching `Log after send` command.

## Approvals (check one per row)

- [ ] A1 — Send the 4 warm Reddit Sprint DMs (rows 1–4) from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`.
- [ ] A2 — Send the 3 Pro “guide-first” messages (rows 5–7) from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`.
- [ ] A3 — Send the 5 strongest Sprint “production rollout” messages (rows 8–12) from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`.

- [ ] B1 — Update Skool Operator Lab visuals (cover + icon) using repo assets in `docs/marketing/assets/` (no new uploads beyond Skool itself).
- [ ] B2 — Publish + pin the “Start Here” post from `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`.

- [ ] C1 — Run creator-platform promo preview only (safe, no outbound writes): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`.
- [ ] C2 — Dispatch `.github/workflows/thumbgate-creator-platform-promo.yml` in `publish` mode (requires Zernio secrets in GitHub Actions).
- [ ] C3 — Dispatch `.github/workflows/thumbgate-creator-platform-promo.yml` in `schedule` mode (requires an ISO-8601 schedule time + timezone).

## Notes (optional)

- Approved by:
- Time approved (America/New_York):
- Scope notes:

