# Community Growth Next Actions — 2026-06-13

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Current truth

- Operator Lab promo dry-run re-verified locally in this run at `2026-06-13T04:13:56Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T05:13:59Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T06:14:40Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T07:15:18Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T08:16:16Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T09:17:09Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T10:17:11Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T11:17:53Z`.
- Operator Lab promo dry-run re-verified locally again in this run at `2026-06-13T12:18:16Z`.
- Operator Lab promo dry-run re-confirmed locally again in this run before `2026-06-13T14:20:56Z`.
- Operator Lab promo dry-run re-confirmed locally again in this run before `2026-06-13T15:20:14Z`.
- Operator Lab promo dry-run re-confirmed locally again in this run before `2026-06-13T16:21:48Z`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` returned `6` previews, `0` errors, and every preview still showed `accountCount: 0`.
- There is no callable local `creator:platform:promo` npm alias in this checkout; the GitHub workflow and the working local launcher both use `social:publish:launch`.
- The local dry-run originally resolved every media path through `docs/marketing/assets/*`, and every asset reported `exists: false` in this checkout.
- `docs/marketing/assets/` itself is absent in this checkout, so the current media failure is a real filesystem gap.
- A direct filename search in this checkout also found no local copies of the expected Skool cover/icon/about/social/video assets.
- Every preview still shows `accountCount: 0`, so this runtime remains preview-only and live publish/schedule should stay on the GitHub Actions path with secrets.
- `scripts/social-analytics/publish-thumbgate-launch.js` was patched in this run at `2026-06-13T20:25:48Z` to fall back to committed brand assets under `public/assets/brand/*`, and the dry-run now resolves media with `exists: true` while still showing `accountCount: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` now succeeds again in this runtime and currently returns `Members: 1` with `Visible posts on page: 0` as of `2026-06-13T06:14:40Z`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T07:15:18Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T08:16:16Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T09:17:09Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T10:17:11Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T11:17:53Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline in this run at `2026-06-13T12:18:16Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline again in this run before `2026-06-13T14:20:56Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline again in this run before `2026-06-13T15:20:14Z`: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed the same shallow public baseline again in this run before `2026-06-13T16:21:48Z`: `Members: 1`, `Visible posts on page: 0`.
- That restored headless read is still shallow public-surface evidence only; it does not verify About-page copy, Classroom visibility, membership questions, or approval posture.
- Direct public-page readback of `https://www.skool.com/thumbgate-operator-lab-6000` confirms the shell is live with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs visible, plus `JOIN GROUP`, `1 Member`, and search-visible value-prop copy that still matches the current Operator Lab positioning.
- The same public read still shows the placeholder line `This is the start of something special`, which is another signal that public activity/content depth is the immediate discovery bottleneck.
- The public shell is therefore not the blocker right now; the blocker is weak public activity plus lack of authenticated confirmation on About/Classroom/settings quality.
- Official Skool help-center guidance remains aligned with the current free-group posture as of `2026-06-13`.
- Official Skool help now also makes two constraints explicit for this motion:
  - free-community invites can be driven by invite links or email invites, so there is no product reason to rush paid-community setup
  - Skool natively supports direct video uploads in Classroom and community posts, so the current media blocker is the local browser/file-picker path, not a missing Skool feature
- Local pipeline re-check in this run still shows `24` active leads with actionable `byStage` truth of `22` at `contacted`, `2` at `replied`, and `0` untouched leads via `scripts/sales-pipeline.js`.
- The `2026-06-13T12:18:16Z` re-check showed no queue movement versus `2026-06-13T11:17:53Z`; the fastest money path remains the same warm Reddit four-pack.
- The same no-movement pipeline state was re-confirmed again in this run before `2026-06-13T14:20:56Z`.
- The same no-movement pipeline state was re-confirmed again in this run before `2026-06-13T15:20:14Z`.
- The same no-movement pipeline state was re-confirmed again in this run before `2026-06-13T16:21:48Z`.
- Direct web readback of the public group page also re-confirmed before `2026-06-13T15:20:14Z` that the public shell is live but still thin: `1 Member`, `JOIN GROUP`, and the placeholder line `This is the start of something special`.
- Direct web readback of the public group page also re-confirmed before `2026-06-13T16:21:48Z` that the public shell is live but still thin: `1 Member`, `JOIN GROUP`, and the placeholder line `This is the start of something special`.
- The same pipeline command still exposes an incorrect top-level `contacted: 24`, so operator docs should keep using `summary.byStage` as the actionable queue truth.
- Local runtime check before `2026-06-13T16:21:48Z` still found no `docs/marketing/assets/` directory, no matching Skool media filenames anywhere in the checkout, no `ZERNIO_API_KEY` in env, and no local `.env*` declaration for that secret.
- Local runtime check before `2026-06-13T17:21:55Z` still found no `docs/marketing/assets/` directory, no matching Skool media filenames anywhere in the checkout, no `ZERNIO_API_KEY` in env, and no local `.env*` declaration for that secret.
- `npm run sales:pipeline` re-confirmed again before `2026-06-13T17:21:55Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed again before `2026-06-13T17:21:55Z` the same shallow public baseline: `Members: 1`, `Visible posts on page: 0`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` re-confirmed again before `2026-06-13T17:21:55Z` the same `6` previews, `0` errors, `0` connected accounts, and missing media files under `docs/marketing/assets/*`.
- Local runtime check before `2026-06-13T18:24:04Z` still found no `docs/marketing/assets/` directory, found only the cover/icon assets under `.artifacts/claude-desktop/bundle/public/assets/skool/`, found no `ZERNIO_API_KEY` in env, and found no real local secret file carrying that key.
- `npm run sales:pipeline` re-confirmed again before `2026-06-13T18:24:04Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed again before `2026-06-13T18:24:04Z` the same shallow public baseline: `Members: 1`, `Visible posts on page: 0`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` re-confirmed again before `2026-06-13T18:24:04Z` the same `6` previews, `0` errors, `0` connected accounts, and missing media files under `docs/marketing/assets/*`.
- Direct public-page fetch before `2026-06-13T18:24:04Z` also exposed `public: true` and `archived: true` in the page payload, so archive-state verification is now more urgent than another unauthenticated public re-read.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` re-confirmed again at `2026-06-13T19:25:39Z` the same `6` previews, `0` errors, `0` connected accounts, and missing media files under `docs/marketing/assets/*`.
- `node scripts/sales-pipeline.js summary` re-confirmed again at `2026-06-13T19:25:39Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- Local runtime check at `2026-06-13T19:25:39Z` still found only the cover/icon assets under `.artifacts/claude-desktop/bundle/public/assets/skool/`, found no `docs/marketing/assets/` directory, and found no `ZERNIO_API_KEY` in env or local `.env*`.
- Local runtime check at `2026-06-13T21:25:15Z` still found no `ZERNIO_API_KEY` in env, no `ZERNIO_API_KEY=` line in `.env` or `.env.example`, and no movement in either the pipeline or public Skool baseline.
- `node scripts/sales-pipeline.js summary` re-confirmed again at `2026-06-13T22:25:20Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- Live Skool public-page verification in this run re-confirmed on `2026-06-13` the same thin shell: `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, `About`, `JOIN GROUP`, `1 Member`, and the placeholder line `This is the start of something special`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` re-confirmed again at `2026-06-13T23:26:26Z` the same `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`.
- `node scripts/sales-pipeline.js summary` re-confirmed again at `2026-06-13T23:26:26Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed again at `2026-06-13T23:26:26Z` the same shallow public baseline: `Members: 1`, `Visible posts on page: 0`.
- Local runtime check at `2026-06-13T23:26:26Z` still found no `ZERNIO_API_KEY` in env and no local `.env` or `.env.example` declaration for that key.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` re-confirmed again at `2026-06-14T00:28:11Z` the same `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`.
- `node scripts/sales-pipeline.js summary` re-confirmed again at `2026-06-14T00:28:11Z` that the actionable state is still `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` re-confirmed again at `2026-06-14T00:28:11Z` the same shallow public baseline: `Members: 1`, `Visible posts on page: 0`.
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` re-confirmed again at `2026-06-14T01:29:02Z` the same shallow public baseline: `Members: 1`, `Visible posts on page: 0`.
- `npm run social:zernio:status` re-confirmed again at `2026-06-14T01:29:05Z` that analytics remain dark: `0/6` healthy platforms and `0` rows in the last `24h`.

## Revenue interpretation

- The fastest money path is still the warm Reddit follow-up four-pack, not colder discovery.
- Zero `checkout_started`, zero `sprint_intake`, and zero `paid` in the live pipeline report keep that conclusion unchanged.
- There is still no untouched self-serve Pro batch in the latest-per-lead pipeline state.
- Operator Lab promotion is approval-ready only for workflow dispatch, not for confident live measurement: analytics remain dark in this local runtime, but local media resolution is no longer the blocker after the fallback-asset patch.
- Skool itself should stay free and value-first; Discovery still penalizes off-platform payments, so public Skool surfaces should keep routing to proof/value instead of checkout-heavy copy.
- The newly restored headless read plus direct page fetch raise urgency on content hygiene: with only `1` visible member and `0` visible posts, the next discovery-quality gains come from authenticated page verification and actual public activity, not more speculative infra work.
- The new `archived: true` payload signal increases urgency further: if that flag is live in the logged-in group settings, discovery/content work may be artificially capped until it is cleared.
- Classroom quality and anti-spam controls matter operationally right now: the tab is publicly visible, so the remaining risk is empty/thin lesson inventory or loose approvals/chat access turning discovery traffic into noise.
- The current checkout still does not contain the underlying `docs/marketing/assets/` files expected by older notes, but the active launcher now falls back to committed brand assets so preview evidence is no longer media-empty.
- Local runtime check at `2026-06-13T13:20:04Z` confirmed `ZERNIO_API_KEY` is absent from env and no local `.env*` file in this checkout declares it.

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

Why this matters: the public shell is already visible, but only authenticated browser inspection can confirm whether the About page, Classroom contents, membership controls, and apparent archive state are actually helping or blocking discovery.

## What changed in this run

- Re-verified that the promo workflow file still defaults to `offer: operator-lab`.
- Re-verified that the workflow-backed local preview command still works for copy generation.
- Re-verified that the underlying `docs/marketing/assets/*` targets are missing in this checkout.
- Re-verified that the dry-run still produces `6` previews, `0` errors, and `0` connected accounts across all target platforms.
- Patched the launcher in this run so the same dry-run now resolves committed fallback media under `public/assets/brand/*` instead of failing every preview on missing `docs/marketing/assets/*`.
- Re-verified in this run that the lead-state mix is still `22` contacted, `2` replied, and `0` paid, so the queue priority did not change.
- Re-verified in this run that public Skool still has only `1` visible member and `0` visible posts, so discovery quality is still constrained by content depth rather than shell visibility.
- Re-verified in this run that the public page still exposes the placeholder starter-feed line, which raises the cost of prioritizing discovery traffic before more public activity exists.
- Re-verified in this run that there is still no local asset pack and no local Zernio secret, so A2 remains workflow-ready but not locally publishable.
- Re-verified in this run that the current lead state remains frozen through `2026-06-13T18:24:04Z`, so A1 stays the only approval-worthy money action.
- Added a new high-priority warning from the public Skool payload: the group currently reports `archived: true` even though the shell is still public.
- Added direct public-page evidence that the Operator Lab shell and top-level tabs are live.
- Refreshed the platform requirements brief to `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-13.md`.
- Re-verified in this run at `2026-06-13T19:25:39Z` that none of those conclusions changed, so A1 remains the next approval-ready money action.
- Re-verified again at `2026-06-13T21:25:15Z` that none of those conclusions changed, and corrected the docs to reflect that neither `.env` nor `.env.example` currently carries a `ZERNIO_API_KEY` line.
- Re-verified again at `2026-06-13T22:25:20Z` that none of those conclusions changed, so A1 remains the next approval-ready money action and A3 remains the highest-priority non-send verification.
- Re-verified again at `2026-06-13T23:26:26Z` that none of those conclusions changed, so A1 remains the next approval-ready money action and A3 remains the highest-priority non-send verification.
- Re-verified again at `2026-06-14T00:28:11Z` that none of those conclusions changed, so A1 remains the next approval-ready money action and A3 remains the highest-priority non-send verification.
- Re-verified again at `2026-06-14T01:29:05Z` that none of those conclusions changed, so A1 remains the next approval-ready money action and A3 remains the highest-priority non-send verification.
