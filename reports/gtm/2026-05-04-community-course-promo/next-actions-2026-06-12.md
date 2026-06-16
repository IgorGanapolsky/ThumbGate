# Community Growth Next Actions — 2026-06-12

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Current truth

- Operator Lab promo dry-run re-verified locally in this run at `2026-06-13T02:12:06Z`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` returned `6` previews, `0` errors, and every preview still showed `accountCount: 0`.
- The local dry-run currently resolves every media path through `docs/marketing/assets/*`, and every asset reports `exists: false` in this checkout.
- `docs/marketing/assets/` itself is absent in this checkout, so the current media failure is a real filesystem gap.
- A direct filename search in this checkout also found no local copies of the expected Skool cover/icon/about/social/video assets.
- Every preview still shows `accountCount: 0`, so this runtime remains preview-only and live publish/schedule should stay on the GitHub Actions path with secrets.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` now succeeds again in this runtime and currently returns `Members: 1` with `Visible posts on page: 0`.
- That restored headless read is still shallow public-surface evidence only; it does not verify About-page copy, Classroom visibility, membership questions, or approval posture.
- Direct public-page readback of `https://www.skool.com/thumbgate-operator-lab-6000` confirms the shell is live with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs visible, plus `JOIN GROUP` and `1 Member`.
- The public shell is therefore not the blocker right now; the blocker is weak public activity plus lack of authenticated confirmation on About/Classroom/settings quality.
- Official Skool help-center guidance remains aligned with the current free-group posture as of `2026-06-13`.
- Official Skool help now also makes two constraints explicit for this motion:
  - free-community invites can be driven by invite links or email invites, so there is no product reason to rush paid-community setup
  - Skool natively supports direct video uploads in Classroom and community posts, so the current media blocker is the local browser/file-picker path, not a missing Skool feature
- Local pipeline re-check in this run still shows `24` active leads with actionable `byStage` truth of `22` at `contacted`, `2` at `replied`, and `0` untouched leads via `scripts/sales-pipeline.js`.

## Revenue interpretation

- The fastest money path is still the warm Reddit follow-up four-pack, not colder discovery.
- There is still no untouched self-serve Pro batch in the latest-per-lead pipeline state.
- Operator Lab promotion is approval-ready only for workflow dispatch, not for confident live measurement: analytics remain dark in this local runtime and local asset resolution is broken.
- Skool itself should stay free and value-first; Discovery still penalizes off-platform payments, so public Skool surfaces should keep routing to proof/value instead of checkout-heavy copy.
- The newly restored headless read plus direct page fetch raise urgency on content hygiene: with only `1` visible member and `0` visible posts, the next discovery-quality gains come from authenticated page verification and actual public activity, not more speculative infra work.
- Classroom quality and anti-spam controls matter operationally right now: the tab is publicly visible, so the remaining risk is empty/thin lesson inventory or loose approvals/chat access turning discovery traffic into noise.
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

### A3. Browser-authenticated Skool state verification

Only if action-time confirmation is granted to inspect the logged-in Skool session, verify:

1. About page still contains the value-first ThumbGate copy
2. Classroom actually contains the intended free starter lesson/media and not just an empty public tab
3. current membership questions count and instant-approval posture

Why this matters: the public shell is already visible, but only authenticated browser inspection can confirm whether the About page, Classroom contents, and membership controls are actually helping discovery.

## What changed in this run

- Re-verified that the promo workflow file still defaults to `offer: operator-lab`.
- Re-verified that the workflow-backed local preview command still works for copy generation.
- Re-verified that the underlying `docs/marketing/assets/*` targets are missing in this checkout.
- Added direct public-page evidence that the Operator Lab shell and top-level tabs are live.
- Refreshed the platform requirements brief to `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-12.md`.
