# Operator Loop Brief — 2026-06-14T19:41:44Z

Guardrail: do not publish posts, send messages, invite people, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Revenue truth

- `node scripts/sales-pipeline.js summary` at `2026-06-14T19:41:35Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- Fastest money path is still the same warm four-pack already staged in `reports/gtm/2026-05-04-money-now/operator-send-now.md`:
  - `reddit_deep_ad1959_r_cursor`
  - `reddit_game_of_kton_r_cursor`
  - `reddit_leogodin217_r_claudecode`
  - `reddit_enthu_cutlet_1337_r_claudecode`
- There is still no untouched self-serve batch that outranks those follow-ups.

## Community and promo truth

- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown` at `2026-06-14T19:41:35Z` still returns only `Members: 1` and `Visible posts on page: 0`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` at `2026-06-14T19:41:35Z` still returns `6` previews, `0` errors, `0` published, and `0` scheduled.
- Every preview still shows `accountCount: 0`, so local runtime remains preview-only even though fallback media resolves under committed `public/assets/brand/*`.
- `npm run social:zernio:status` at `2026-06-14T19:41:35Z` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- Local secret readback at `2026-06-14T19:41:35Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`.
- `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults to `offer: operator-lab`.

## Official Skool requirement refresh

- Official help was re-checked on `2026-06-14`; no material requirement delta was found.
- Discovery FAQ still says visibility lands within about `two hours` after threshold.
- Invite options still include share link, email invite, bulk CSV import, and Zapier.
- Membership questions still cap at `3` total with only `1` email-type field.
- About page remains required for Discovery, and Classroom still has to be enabled and populated before a starter course is truly visible.

## Decision

- Do not promote Skool discovery or creator-platform dispatch above warm outbound.
- A1 remains the only approval-ready money action.
- A2 and A3 are still secondary because the public group is too thin and local analytics remain dark.

## Approval-ready actions

### A1. Warm Reddit follow-up batch

Exact action-time approval string:

- `Approve A1 warm Reddit follow-up batch`

Use the follow-up drafts and logging commands already staged in:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`

### A2. Operator Lab creator-platform promo dispatch

Only if explicit action-time approval is granted for social publishing:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Mode: `preview` first, then `schedule` or `publish`
- Offer: `operator-lab`
- Platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

### A3. Logged-in Skool verification

Only if explicit action-time approval is granted to inspect the authenticated Skool session:

1. Verify About page copy is still value-first and complete.
2. Verify Classroom actually contains the intended free starter lesson/media.
3. Verify membership question count and approval posture.
4. Verify whether any archived state is enabled in settings.
