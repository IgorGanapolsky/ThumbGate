# Community Growth Next Actions — 2026-06-14

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Current truth

- Fresh local readback at `2026-06-15T00:43:27Z` did not change the state.
- Promo path: `6` dry-run previews, `0` errors, committed brand media resolves, but every platform still shows `accountCount: 0`.
- Revenue path: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- Community path: public Skool still reads as `Members: 1` and `Visible posts on page: 0`.
- Analytics path: Zernio status is still dark at `0/6` healthy platforms and `0` rows in the last `24h`.
- Local secret path: no `ZERNIO_API_KEY` in env, `.env`, or `.env.example`.
- Official Skool help re-check on `2026-06-14` still found no material requirement shift; prefer the newer Discovery FAQ wording of `within two hours` after threshold over the older `within an hour` help article.

## Decision

- A1 remains the only approval-ready money action.
- A2 creator-platform dispatch is still secondary because local analytics are dark and the Skool surface is too thin.
- A3 authenticated Skool verification remains the highest-priority non-send action because the public shell cannot verify About-page quality, Classroom inventory, or archive/approval state.
- Repo drift note: the working public readback command in this checkout is `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`; older `skool-public-read.js` references are stale.

## Approval-ready actions

### A1. Warm Reddit follow-up batch

Ask for action-time confirmation to send:

1. `reddit_deep_ad1959_r_cursor`
2. `reddit_game_of_kton_r_cursor`
3. `reddit_leogodin217_r_claudecode`
4. `reddit_enthu_cutlet_1337_r_claudecode`

Exact approval string:

- `Approve A1 warm Reddit follow-up batch`

Use:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

### A2. Operator Lab creator-platform promo dispatch

Only if action-time confirmation is granted for social publishing:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Mode: `preview` first, then `schedule` or `publish`
- Offer: `operator-lab`
- Platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

### A3. Logged-in Skool verification

Only if action-time confirmation is granted to inspect the authenticated Skool session:

1. Verify About-page copy is complete and still value-first.
2. Verify Classroom contains the intended free starter lesson/media.
3. Verify membership questions and approval posture.
4. Verify whether any archived state is enabled.
