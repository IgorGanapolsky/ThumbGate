# Action-Time Approval Card — 2026-06-05

Guardrail: do not publish posts, send messages, invite members, upload files, create paid accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

This card is the single place to approve outbound actions for this run. When an action is executed, log it immediately in `reports/gtm/2026-05-04-money-now/operator-send-now.md` using the matching `Log after send` command.

## Approvals (check one per row when action-time confirmation exists)

- [ ] A1 — Send the 4 warm Reddit follow-ups (rows 1–4) from `reports/gtm/2026-05-04-money-now/operator-send-now.md`.
- [ ] A2 — Send the 2 contacted Pro close-follow-ups from `reports/gtm/2026-05-04-money-now/operator-send-now.md`.

- [ ] B1 — Update Skool Operator Lab visuals (cover + icon) using repo assets in `docs/marketing/assets/` (no new uploads beyond Skool itself).
- [ ] B2 — Publish + pin the `Start Here` value-first post using `reports/gtm/2026-05-04-community-course-promo/operator-lab-post-pack-2026-06-05.md`.
- [ ] B3 — Turn on membership questions with the current three-question pack after browser-authenticated verification.

- [ ] C1 — Run creator-platform promo preview only (safe, no outbound writes): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`.
- [ ] C2 — Dispatch `.github/workflows/thumbgate-creator-platform-promo.yml` in `publish` mode (requires Zernio secrets in GitHub Actions).
- [ ] C3 — Dispatch `.github/workflows/thumbgate-creator-platform-promo.yml` in `schedule` mode (requires an ISO-8601 schedule time + timezone).

## Notes (optional)

- Approved by: pending
- Time approved (America/New_York): pending
- Scope notes: Card reset to pending because this run prepared approval-ready actions only and did not execute outbound sends.
