# Community Growth Next Actions — 2026-06-11

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Current truth

- Operator Lab promo dry-run re-verified locally in this run at `2026-06-11T18:45:22Z`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` returned `6` previews, `0` errors, and every preview still showed `accountCount: 0`.
- The local dry-run currently resolves every media path through `docs/marketing/assets/*`, and every asset reports `exists: false` in this checkout.
- `public/assets/skool/` is absent in this checkout, so there is no local fallback layer for the missing `docs/marketing/assets/*` files.
- `docs/marketing/assets/` itself is absent in this checkout; only three non-asset files remain under `docs/marketing/`, so the current media failure is a real filesystem gap.
- Every preview still shows `accountCount: 0`, so this runtime remains preview-only and live publish/schedule should stay on the GitHub Actions path with secrets.
- `npm run social:zernio:status` on `2026-06-11T18:45:22Z` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` still fails with `[skool-reader] fetch failed` in this run, so public-page readback is still blocked in the headless path.
- Opening `https://www.skool.com/thumbgate-operator-lab-6000` through the web reader in this run also failed, so there is still no trustworthy non-browser public-page verification path available here.
- Official Skool help-center guidance remains aligned with the current free-group posture as of `2026-06-11`:
  - Discovery FAQ updated `2026-04-08`
  - Discovery visibility checklist updated `2026-04-15`
  - About page updated `2025-12-09`
  - Pricing updated `2025-10-28`
  - Membership questions updated `2025-09-19`
  - Classroom updated `2026-05-29`
  - Payments FAQ updated `2026-04-22`
  - Payout setup updated `2026-01-22`
  - Payout status updated `2026-05-05`

## Revenue interpretation

- The fastest money path is still the warm Reddit follow-up four-pack, not colder discovery.
- There is still no untouched self-serve Pro batch in the latest-per-lead pipeline state.
- Operator Lab promotion is operationally ready for GitHub Actions preview/publish, but analytics visibility is still dark until Zernio credentials/add-on/account health is fixed.
- Operator Lab promotion is approval-ready only for workflow dispatch, not for confident live measurement: analytics are dark and local asset resolution is broken.
- The only approval-ready action that does not depend on missing media or dark analytics is still A1 warm lead follow-up.
- Local pipeline re-check in this run still shows `24` active leads with `22` at `contacted`, `2` at `replied`, and `0` untouched leads via `scripts/sales-pipeline.js`.
- Skool itself should stay free and value-first; Discovery still penalizes off-platform payments, so public Skool surfaces should keep routing to proof/value instead of checkout-heavy copy.
- The About page remains the right place for proof, explainer media, and course framing, but not for aggressive checkout language.
- The current checkout does not contain the underlying `docs/marketing/assets/` files expected by the promo launcher; older notes that treat those assets as present are stale.

## Approval-ready actions

### A1. Warm Reddit follow-up batch

Ask for action-time confirmation to send these four follow-ups:

1. `reddit_deep_ad1959_r_cursor`
2. `reddit_game_of_kton_r_cursor`
3. `reddit_leogodin217_r_claudecode`
4. `reddit_enthu_cutlet_1337_r_claudecode`

Use the follow-up drafts in:

- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- `reports/gtm/2026-05-04-money-now/operator-send-now.md`

After each send, log the pipeline movement with that row's `npm run sales:pipeline -- advance ...` command from the send sheet.

### A2. Operator Lab creator-platform promo dispatch

Only if action-time confirmation is granted for social publishing, use the GitHub Actions workflow:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Recommended mode: `preview` first, then `schedule` or `publish`
- Required offer input: `operator-lab`
- Recommended platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

Safe confirmation bundle:

1. `mode=preview`
2. `offer=operator-lab`
3. `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Escalate before `publish` or `schedule` because this local runtime cannot prove connected Zernio accounts.

## What changed in this run

- Re-verified that the promo workflow file exists again and defaults to `offer: operator-lab`.
- Re-verified that the workflow-backed local preview command is `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`; the older `.github/scripts/creator-platform-promo.js` path is absent in this checkout.
- Re-verified that `public/assets/skool/` is absent and the underlying `docs/marketing/assets/*` targets are still missing in this checkout.
- Re-verified with `find docs/marketing -maxdepth 3 -type f` that the local Skool asset set is absent despite the operator memory saying those files should exist.
- Re-verified that headless Skool readback is still blocked, so browser-authenticated readback remains the only trustworthy public-surface verification path.
- Refreshed the platform requirements brief to `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-11.md`.
