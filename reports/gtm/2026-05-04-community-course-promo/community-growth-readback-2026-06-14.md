# Community Growth Readback — 2026-06-14

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Latest command evidence

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T00:43:26Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T00:43:26Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T00:43:27Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T00:43:27Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- Local secret-path check
  - Run time: `2026-06-15T00:43:27Z`
  - Result: no `ZERNIO_API_KEY` is present in the current env, and there is still no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
- GitHub Actions workflow readback
  - Run time: `2026-06-14`
  - Result: `.github/workflows/thumbgate-creator-platform-promo.yml` still exposes `preview`, `publish`, and `schedule` modes and still defaults to `offer: operator-lab`
- Official Skool help readback
  - Run time: `2026-06-14T21:43:18Z`
  - Result: no material requirement delta versus the earlier June 14 refresh; Discovery still needs threshold + complete About/cover setup, and the current FAQ still says visibility lands within about `two hours`
  - Nuance: the older Discovery troubleshooting article still says `within an hour`, so operator docs should keep preferring the newer FAQ wording

## Revenue interpretation

- The fastest money path is still the warm Reddit follow-up four-pack, not colder discovery or creator-platform distribution.
- Zero `checkout_started`, zero `sprint_intake`, and zero `paid` in the live pipeline keep that conclusion unchanged.
- Operator Lab promo is still dispatch-ready only through approval plus the GitHub Actions workflow; this local runtime cannot prove connected Zernio accounts or live analytics health.
- Public Skool visibility exists, but content depth does not. With only `1` visible member and `0` visible posts, driving more traffic into the same shell is unlikely to outperform direct warm follow-up.

## Approval-ready actions

### A1. Warm Reddit follow-up batch

Ask for action-time confirmation to send these four follow-ups:

1. `reddit_deep_ad1959_r_cursor`
2. `reddit_game_of_kton_r_cursor`
3. `reddit_leogodin217_r_claudecode`
4. `reddit_enthu_cutlet_1337_r_claudecode`

Exact approval string:

- `Approve A1 warm Reddit follow-up batch`

Use the follow-up drafts in:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

### A2. Operator Lab creator-platform promo dispatch

Only if action-time confirmation is granted for social publishing:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Recommended mode: `preview` first, then `schedule` or `publish`
- Required offer input: `operator-lab`
- Recommended platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

### A3. Browser-authenticated Skool state verification

Only if action-time confirmation is granted to inspect the logged-in Skool session:

1. Verify About page copy is still value-first and complete.
2. Verify Classroom actually contains the intended free starter lesson/media.
3. Verify membership question count and approval posture.
4. Verify whether any archived state is enabled in settings.

## What changed in this run

- Re-confirmed at `2026-06-15T00:43:27Z` that A1 remains the only approval-ready money action.
- Re-verified the local promo preview path, pipeline state, public Skool baseline, and dark Zernio-status path.
- Re-verified official Skool help on `2026-06-14` and found no material requirement delta versus the earlier same-day refresh.
- Re-ran the current repo-side Skool reader entrypoint at `2026-06-15T00:43:27Z`; it still resolves to `Members: 1` and `Visible posts on page: 0`, matching the direct public-page shell readback.
