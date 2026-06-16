# Operator Loop Brief

Updated: 2026-06-15T00:43:27Z

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, create paid accounts, change billing, or inspect authenticated third-party state without action-time confirmation.

## Current truth

- Warm revenue still outranks community polish.
- `node scripts/sales-pipeline.js summary` at `2026-06-15T00:43:26Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` at `2026-06-15T00:43:26Z` still returns `6` previews, `0` errors, `0` published, and `0` scheduled.
- Every local promo preview still shows `accountCount: 0`, so this runtime remains preview-only even though the media fallback under `public/assets/brand/*` resolves successfully.
- `npm run social:zernio:status` at `2026-06-15T00:43:27Z` is still dark: `0/6` healthy platforms and `0` rows in the last `24h`.
- Local secret readback at `2026-06-15T00:43:27Z` still shows `ZERNIO_API_KEY` absent from env, `.env`, and `.env.example`.
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown` at `2026-06-15T00:43:27Z` still returns `Members: 1` and `Visible posts on page: 0`.

## Official Skool refresh

Re-verified against Skool help on `2026-06-14`.

- Discovery still requires a threshold of members, posts, and activity plus a group description, About-page description/images, and a cover image.
- The current Discovery FAQ still says visibility usually lands within about `two hours` after threshold, while the older troubleshooting article still says `within an hour`; keep preferring the newer FAQ wording.
- Discovery ranking still penalizes `payments off-platform`, so public Skool copy should stay value-first.
- The About page still functions as the main landing surface and still supports native image/video upload.
- Classroom course access still supports `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`.
- Membership questions still cap at `3`, with only `1` email-type question.
- Account security guidance updated on `June 8, 2026` still prohibits sharing creator credentials, login codes, or cookies.

## Current decision

1. `A1` remains the only approval-ready money action: send the warm Reddit follow-up four-pack already staged in the money-now docs.
2. `A2` creator-platform dispatch remains secondary until either lead movement appears or authenticated Skool verification shows real public depth.
3. `A3` authenticated Skool verification remains the highest-value non-send check because the public shell is still too thin to justify more traffic.

Exact approval string for `A1`:

- `Approve A1 warm Reddit follow-up batch`

Lead IDs for `A1`:

- `reddit_deep_ad1959_r_cursor`
- `reddit_game_of_kton_r_cursor`
- `reddit_leogodin217_r_claudecode`
- `reddit_enthu_cutlet_1337_r_claudecode`

Use:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`
