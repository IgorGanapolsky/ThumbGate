# Operator Loop Brief — 2026-06-15T07:47:48Z

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Command evidence

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still reports `accountCount: 0`
  - Media proof: committed brand media resolves under `public/assets/brand/*`
- `node scripts/sales-pipeline.js summary`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, `0` `paid`
  - Caveat: the script still emits top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Result: public shell still reads `Members: 1` and `Visible posts on page: 0`
- `npm run social:zernio:status`
  - Result: exits non-zero with `0/6` healthy platforms and `0` rows in the last `24h`
  - Likely causes listed by the script: missing or revoked `ZERNIO_API_KEY`, Zernio analytics paywall, or no connected accounts
- `.github/workflows/thumbgate-creator-platform-promo.yml`
  - Result: still exposes `preview`, `publish`, and `schedule`, and still defaults `offer` to `operator-lab`

## Official Skool refresh

- Re-checked official Skool help on `2026-06-15`.
- No material requirement delta surfaced versus the earlier June 15 refresh.
- Keep using the newer Discovery FAQ wording that visibility lands within about `two hours` after threshold; the older troubleshooting article still says `within an hour`.
- Membership questions still cap at `3`, with only `1` email-answer question allowed.
- About remains the landing/checkout surface and Classroom remains the core course/resource surface.

## Revenue read

- The fastest money path is still the warm Reddit follow-up four-pack already staged in `reports/gtm/2026-05-04-money-now/operator-send-now.md`.
- Creator-platform promo remains secondary because the destination surface is still thin and local analytics remain dark.
- Public Skool discovery work remains low ROI until there is at least one visible post and more than a one-member shell.

## Next approval-ready action

Ask for action-time confirmation to send the warm Reddit follow-up batch:

1. `reddit_deep_ad1959_r_cursor`
2. `reddit_game_of_kton_r_cursor`
3. `reddit_leogodin217_r_claudecode`
4. `reddit_enthu_cutlet_1337_r_claudecode`

Exact approval string:

- `Approve A1 warm Reddit follow-up batch`

## Secondary action if approval is granted

- Logged-in Skool verification remains the highest-value non-send action because only an authenticated session can verify:
  - About-page completeness
  - Classroom starter lesson presence
  - membership questions and approval posture
  - archive state
