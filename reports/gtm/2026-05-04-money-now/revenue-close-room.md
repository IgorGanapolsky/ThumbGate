# Revenue Close Room (Money Now)

Updated: 2026-06-16T17:14:56Z

This file is the close-room script + truth table for converting warm/high-intent leads into:

- Workflow Hardening Diagnostic (`$499`)
- Workflow Hardening Sprint (`$1500`)
- Pro (`$19/mo` or `$149/yr`)

Source of truth:

- Commercial truth + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope + deliverables: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Proof / engineering evidence: `docs/VERIFICATION_EVIDENCE.md` + `proof/*` reports

Guardrail: do not publish posts, send messages, or invite members without explicit action-time confirmation.

## Current Signal Snapshot (operator-reported; not commercial proof)

- 30d visitors: 6169
- Checkout starts: 133
- Paid orders: 4 (operator-reported snapshot; not re-verified against hosted billing in this run)
- Booked: `$149` (operator-reported snapshot; not re-verified against hosted billing in this run)
- Signups: 475
- Sprint leads: 0
- Repo-side loop re-check at `2026-06-16T17:14:56Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1`, `Visible posts on page: 0`, and one visible category with zero posts; `npm run social:zernio:status` at `2026-06-16T17:14:10Z` is still dark, and the local creator-platform dry-run still shows `6` previews with `accountCount: 0` across all targeted platforms even though committed fallback media resolves from `public/assets/brand/*`.
- Repo-side loop re-check at `2026-06-16T16:14:57Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-16T16:14:57Z` is still dark, and the local creator-platform dry-run still shows `6` previews with `accountCount: 0` across all targeted platforms even though committed fallback media resolves from `public/assets/brand/*`.
- Repo-side loop re-check at `2026-06-16T15:14:12Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-16T15:14:12Z` is still dark, and the local creator-platform dry-run still shows `6` previews with `accountCount: 0` across all targeted platforms even though committed fallback media resolves from `public/assets/brand/*`.
- Repo-side loop re-check at `2026-06-16T10:07:44Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-16T10:07:44Z` is still dark, and the local creator-platform dry-run still shows `6` previews with `accountCount: 0` across all targeted platforms.
- Live pipeline state re-verified at `2026-06-13T12:18:16Z` via `scripts/sales-pipeline.js`: `24` active leads, `22` in `contacted`, `2` in `replied`, `0` paid
- Repo-side loop re-check at `2026-06-15T02:44:27Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T02:44:00Z` is still dark.
- Repo-side loop re-check at `2026-06-15T04:45:39Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T04:45:23Z` is still dark.
- Repo-side loop re-check at `2026-06-15T05:45:53Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T05:45:31Z` is still dark.
- Repo-side loop re-check at `2026-06-15T06:46:33Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T06:46:20Z` is still dark.
- Repo-side loop re-check at `2026-06-15T07:47:48Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T07:47:22Z` is still dark.
- Repo-side loop re-check at `2026-06-15T08:47:21Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T08:47:21Z` is still dark.
- Repo-side loop re-check at `2026-06-15T09:48:57Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T09:48:57Z` is still dark.
- Repo-side loop re-check at `2026-06-15T10:49:55Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T10:49:28Z` is still dark and still exits non-zero with the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T11:48:54Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T11:48:54Z` is still dark and still exits non-zero with the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T12:49:51Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T12:49:51Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T13:51:57Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T13:51:57Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T14:53:03Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T14:53:03Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T15:51:58Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T15:51:58Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T16:53:56Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-15T16:53:35Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T18:54:57Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1`, `totalPosts: 0`, and no visible posts; `npm run social:zernio:status` at `2026-06-15T18:54:57Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T19:56:45Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1`, `totalPosts: 0`, and no visible posts; `npm run social:zernio:status` at `2026-06-15T19:56:36Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-15T21:56:35Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1`, `totalPosts: 0`, and no visible posts; `npm run social:zernio:status` at `2026-06-15T21:56:18Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T00:58:10Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `totalMembers: 1`, `totalPosts: 0`, the live group description, and no visible posts; `npm run social:zernio:status` at `2026-06-16T00:58:09Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T01:59:47Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` at `2026-06-16T01:59:47Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T04:02:06Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool now reads `totalMembers: 1`, `totalPosts: 0`, the live Operator Lab description, and no visible posts; `npm run social:zernio:status` at `2026-06-16T04:01:57Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T05:02:45Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1` and `Visible posts on page: 0`, the direct public page still shows only the live description and placeholder feed shell, and `npm run social:zernio:status` at `2026-06-16T05:02:45Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T06:04:49Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `totalMembers: 1`, `totalPosts: 0`, one `General discussion` label, the live Operator Lab description, and no visible posts; `npm run social:zernio:status` at `2026-06-16T06:04:48Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Repo-side loop re-check at `2026-06-16T08:06:43Z` still shows no close motion: actionable `byStage` truth remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; public Skool still reads `Members: 1`, `Visible posts on page: 0`, one visible category with zero posts, and the live Operator Lab description; `npm run social:zernio:status` at `2026-06-16T08:06:14Z` is still dark, still exits non-zero, and still points to the same likely-cause guidance.
- Current loop constraints on 2026-06-13:
  - local Operator Lab promo preview still runs cleanly, and as of `2026-06-13T20:25:48Z` it is healthy as a media-backed preview path again because the launcher now falls back to committed brand assets when the canonical Skool asset pack is absent
  - local preview still shows `accountCount: 0` across platforms in this runtime, so live promo should stay on the GitHub Actions path with secrets
  - the working local preview path in this checkout is `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`; there is no callable `creator:platform:promo` npm alias here
  - that same local preview path was re-confirmed again in this run before `2026-06-13T18:24:04Z` with the same `6` previews, `0` errors, missing assets at the expected `docs/marketing/assets/*` paths, and `0` connected accounts
  - local shell still has no `ZERNIO_API_KEY` in env as of `2026-06-13T18:24:04Z`, so local runs should remain preview-only for media-backed publishing
  - the last verified Zernio analytics readback is still dark (`0/6` healthy platforms, `0` rows in the last `24h`) from `2026-06-11T18:45:22Z`
  - headless public-page Skool readback now succeeds in this runtime and currently returns `Members: 1` with `Visible posts on page: 0` at `2026-06-13T18:24:04Z`, but browser-authenticated verification is still required for About/Classroom/settings state
  - that same public-page baseline was re-confirmed again in this run before `2026-06-13T18:24:04Z`
  - no lead-stage movement was detected between the `2026-06-13T16:21:48Z` and `2026-06-13T18:24:04Z` snapshots
  - direct public-page fetch still shows the shell live with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, `JOIN GROUP`, `1 Member`, and the placeholder line `This is the start of something special`; this confirms visibility, not content quality
  - the same public page payload now also exposes `public: true` and `archived: true` in the embedded group metadata at `2026-06-13T18:24:04Z`; treat this as a high-priority verification target, not yet as a confirmed discovery blocker
  - local promo dry-run was re-confirmed again at `2026-06-13T19:25:39Z` with the same `6` previews, `0` errors, `0` connected accounts, and missing `docs/marketing/assets/*` media paths across all targeted platforms
  - the local promo dry-run was re-confirmed again at `2026-06-13T20:25:48Z` with the same `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`, each resolving with `exists: true`
  - the lead-state mix was re-confirmed again at `2026-06-13T19:25:39Z` via `node scripts/sales-pipeline.js summary`: `24` active leads, `22` in `contacted`, `2` in `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` paid
  - direct local file search at `2026-06-13T19:25:39Z` found only two Skool media files in this checkout under `.artifacts/claude-desktop/bundle/public/assets/skool/` (cover + icon), confirming the launcher-path failure is still unresolved and the other expected media assets are absent here
  - local secret readback at `2026-06-13T19:25:39Z` still shows no `ZERNIO_API_KEY` in shell env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local re-check at `2026-06-13T21:25:15Z` still shows `22` `contacted`, `2` `replied`, `0` conversions, `6` preview payloads, `0` connected accounts, `Members: 1`, `Visible posts on page: 0`, and `\"archived\":true` in the public payload
  - the latest pipeline re-check at `2026-06-13T22:25:20Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest pipeline re-check at `2026-06-13T23:26:26Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest pipeline re-check at `2026-06-14T01:29:02Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults to `--offer=operator-lab`
  - official Skool help still supports the current value-first free-group posture: Discovery FAQ updated `April 8, 2026` and now flags upcoming `Q2 2026` algorithm changes; invite flow updated `June 1, 2026`, Classroom visibility updated `May 29, 2026`, pricing updated `October 28, 2025`, About page updated `December 9, 2025`, Analytics definitions updated `November 24, 2025`, Payments FAQ updated `April 22, 2026`, payouts setup updated `January 22, 2026`, and spam / AutoMod guidance updated `April 2, 2026`
  - live Skool web verification in this run re-confirmed the same public-shell baseline on `2026-06-13`: `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, `About`, `JOIN GROUP`, `1 Member`, and the placeholder feed line `This is the start of something special`
  - the latest local promo re-check at `2026-06-13T23:26:26Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local Skool reader re-check at `2026-06-13T23:26:26Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local promo re-check at `2026-06-14T01:29:02Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local Skool reader re-check at `2026-06-14T01:29:02Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T01:29:05Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - the latest local promo re-check at `2026-06-14T02:28:43Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T02:28:43Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T02:28:43Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T02:28:43Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T02:28:43Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local promo re-check at `2026-06-14T03:28:56Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T03:28:56Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T03:28:56Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T03:28:56Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - live Skool web verification was re-checked again on `2026-06-14` and still shows the same thin public shell: `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, `About`, `JOIN GROUP`, `1 Member`, and `This is the start of something special`
  - the current checkout still does not contain `docs/marketing/assets/`, but the active launcher path is now updated so preview mode no longer depends on those missing files
  - the remaining promo blockers are no real local `ZERNIO_API_KEY`, `accountCount: 0` across platforms in this runtime, and the unresolved authenticated Skool archive-state check
  - refreshed platform brief now lives in `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-14.md`
  - the latest local promo re-check at `2026-06-14T04:30:08Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T04:30:08Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T04:30:08Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T04:30:08Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T04:30:08Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local promo re-check at `2026-06-14T05:31:28Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T05:31:28Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T05:31:28Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T05:31:28Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T05:31:28Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - direct unauthenticated raw-page fetch at `2026-06-14T05:32:00Z` returned only a minimal shell response with no readable `archived` or `public` markers, so it does not clear the earlier `archived` concern; authenticated verification is still required
  - the latest local promo re-check at `2026-06-14T06:31:56Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T06:31:56Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T06:31:56Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T06:31:56Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T06:31:56Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again at `2026-06-14T06:31:56Z` with no material requirement delta from the earlier June 14 refresh
  - the latest local promo re-check at `2026-06-14T07:32:46Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T07:32:46Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T07:32:46Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T07:32:46Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - official Skool help was re-checked again at `2026-06-14T07:32:46Z` with no material requirement delta from the earlier June 14 refresh, and Skool’s current Discovery FAQ now says visibility usually lands within about `two hours` after threshold
  - the latest local promo re-check at `2026-06-14T08:32:29Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T08:32:29Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T08:32:29Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T08:32:29Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T08:32:29Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - live web re-check on `2026-06-14` still shows the same thin public Skool shell with `1 Member`, `JOIN GROUP`, and `This is the start of something special`, so public visibility exists but content depth still does not
  - the latest local promo re-check at `2026-06-14T09:33:02Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T09:33:02Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T09:33:02Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T09:33:03Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - official Skool help was re-checked again at `2026-06-14T09:33:03Z` with no material requirement delta from the earlier June 14 refresh; Discovery still says visibility usually lands within about `two hours` after threshold
  - the latest local promo re-check at `2026-06-14T10:34:59Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T10:34:59Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T10:34:59Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T10:34:59Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T10:35:27Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local promo re-check at `2026-06-14T11:36:44Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T11:36:44Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T11:36:45Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T11:36:45Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T11:36:45Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again at `2026-06-14T11:37:07Z` with no material requirement delta; the one nuance to keep straight is that the newer Discovery FAQ updated `April 8, 2026` says visibility usually lands within about `two hours`, while the older Discovery-eligibility article updated `April 15, 2026` still says `within an hour`
  - the latest local promo re-check at `2026-06-14T12:37:08Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T12:37:08Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T12:37:08Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T12:37:08Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T12:37:08Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again at `2026-06-14T12:37:08Z` with no material requirement delta; the one nuance to keep straight is that the newer Discovery FAQ updated `April 8, 2026` says visibility usually lands within about `two hours`, while the older Discovery-eligibility article updated `April 15, 2026` still says `within an hour`
  - the latest local promo re-check at `2026-06-14T13:37:43Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T13:37:43Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T13:37:43Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T13:37:43Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T13:37:43Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again at `2026-06-14T13:37:43Z` with no material requirement delta; Discovery timing should still use the newer FAQ wording of `within two hours`
  - the latest local promo re-check at `2026-06-14T16:39:04Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T16:39:04Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T16:39:04Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T16:39:04Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T16:39:04Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local promo re-check at `2026-06-14T18:40:48Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T18:40:48Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T18:40:48Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T18:40:48Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T18:40:48Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - the latest local promo re-check at `2026-06-14T15:39:16Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T15:39:16Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T15:39:16Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T15:39:17Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T15:39:16Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again on `2026-06-14` with no material requirement delta; Discovery timing should still use the newer FAQ wording of `within two hours`
  - the latest local promo re-check at `2026-06-14T21:43:17Z` still shows `6` previews, `0` errors, `0` connected accounts, and committed fallback media paths under `public/assets/brand/*`
  - the latest local pipeline re-check at `2026-06-14T21:43:17Z` still shows actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - the latest local Skool reader re-check at `2026-06-14T21:43:17Z` still shows `Members: 1` and `Visible posts on page: 0`
  - the latest local Zernio analytics readback is now `2026-06-14T21:43:18Z`, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`
  - local runtime re-check at `2026-06-14T21:43:17Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`
  - official Skool help was re-checked again on `2026-06-14T21:43:18Z` with no material requirement delta; continue preferring the newer Discovery FAQ wording of `within two hours`
  - the latest repo-side Skool reader re-check at `2026-06-14T22:43:33Z` still shows `Members: 1` and `Visible posts on page: 0`
  - direct web readback on `2026-06-14` still shows the same thin public shell with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, `About`, `JOIN GROUP`, `1 Member`, and `This is the start of something special`
  - official Skool help re-check on `2026-06-14` still shows no material requirement delta; keep preferring the newer Discovery FAQ wording of `within two hours` over the older `within an hour` troubleshooting article

## Offer Routing (fast rules)

1. **Sprint** when: one workflow owner + repeated failure + rollout/approval risk + they want proof.
2. **Diagnostic** when: pain is real but scope is unclear; earn the right to sprint.
3. **Pro** when: self-serve install intent or “I just want the tool / dashboard / exports”.

Never claim ROI. Always anchor to “one repeated mistake → one prevention rule → one proof run”.

## Close Scripts (copy blocks)

### 1) First-touch (Sprint)

“If you have one repeated failure in one AI-agent workflow, I can harden it end-to-end this week: map the workflow, turn the repeated failure into an enforceable Pre-Action Gate, and produce a proof pack you can defend to your team. Worth a 15-minute diagnostic?”

CTA: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`

### 2) Diagnostic close ($499)

“If you’re not sure yet whether this is a Sprint or just wiring + guardrails, we can do the Workflow Hardening Diagnostic first. You’ll leave with the workflow map, failure pattern, and the exact gate + proof plan. If it’s a fit, the Sprint is the immediate next step.”

Use the `$499` diagnostic checkout link from `docs/COMMERCIAL_TRUTH.md` / sprint docs (do not improvise links).

### 3) Sprint close ($1500)

“You’ll get: (1) workflow map + approval boundaries, (2) the prevention gate wired into your agent loop, (3) proof artifacts that show the repeated failure stopped repeating. Sprint is `$1500` for one workflow.”

Use the `$1500` sprint checkout link from `docs/COMMERCIAL_TRUTH.md` / sprint docs (do not improvise links).

### 4) Pro close ($19/mo or $149/yr)

“If you want to evaluate self-serve first, start with the setup guide. If one mistake keeps repeating, Pro is the clean next step for evidence + exports.”

- Guide: `https://thumbgate-production.up.railway.app/guide`
- Pro checkout: `https://thumbgate-production.up.railway.app/checkout/pro`

## Proof Packet (only after pain is confirmed)

- Commercial truth: `docs/COMMERCIAL_TRUTH.md`
- Verification evidence: `docs/VERIFICATION_EVIDENCE.md`
- Proof reports: `proof/compatibility/report.json` and `proof/automation/report.json`

## Next Money Actions (no auto-send)

1. Send the 4 contacted warm Reddit follow-ups first from `reports/gtm/2026-05-04-money-now/operator-send-now.md`.
2. There is no untouched Pro batch left in the latest-per-lead pipeline state; wait for reply movement or create a new ranked batch before sending colder outreach.
3. After each send, log the stage movement using `npm run sales:pipeline -- advance ...` (commands are in the send sheet).
4. If a warm lead confirms pain but scope is unclear, use the Diagnostic close first.
5. If the lead already has one workflow owner plus one repeated failure blocking rollout, use the Sprint close.
6. Before prioritizing more Skool discovery work, verify whether the live group is intentionally archived or accidentally archived in the logged-in Skool session.
7. Until that authenticated archive/settings check is done, do not treat the public Skool shell as a strong enough surface to outrank the warm Reddit batch.
8. Latest repo-side checks at `2026-06-15T04:45:39Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
9. Latest repo-side checks at `2026-06-15T05:45:53Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
10. Latest repo-side checks at `2026-06-15T08:47:21Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
11. Latest repo-side checks at `2026-06-15T09:48:57Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
12. Latest repo-side checks at `2026-06-15T10:49:55Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
13. Latest repo-side checks at `2026-06-15T11:48:54Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
14. Latest repo-side checks at `2026-06-15T12:49:51Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
15. Latest repo-side checks at `2026-06-15T13:51:57Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
16. Latest repo-side checks at `2026-06-15T14:53:03Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
17. Latest repo-side checks at `2026-06-15T15:51:58Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
18. Latest repo-side checks at `2026-06-15T16:53:56Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
19. Latest repo-side checks at `2026-06-15T17:54:23Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
20. Latest repo-side checks at `2026-06-15T18:54:57Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
21. Latest repo-side checks at `2026-06-15T19:56:45Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
22. Latest repo-side checks at `2026-06-15T21:56:35Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, and dark Zernio analytics.
23. Latest repo-side checks at `2026-06-16T00:58:10Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` public posts, dark Zernio analytics, and only one meaningful positive signal on the public surface: the Skool group description is live.
24. Latest repo-side checks at `2026-06-16T01:59:47Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, dark Zernio analytics, and no connected-account evidence for creator-platform distribution.
25. Latest repo-side checks at `2026-06-16T05:02:45Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` visible posts, dark Zernio analytics, and only a thin public shell on the Skool surface.
26. Latest repo-side checks at `2026-06-16T06:04:49Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` public posts, dark Zernio analytics, and preview-only creator-platform distribution with `accountCount: 0` on every target platform.
27. Latest repo-side checks at `2026-06-16T10:07:44Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` public posts, dark Zernio analytics, and preview-only creator-platform distribution with `accountCount: 0` on every target platform.
28. Latest repo-side checks at `2026-06-16T15:14:12Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` public posts, dark Zernio analytics, and preview-only creator-platform distribution with `accountCount: 0` on every target platform even though committed fallback media resolves locally.
29. Latest repo-side checks at `2026-06-16T16:14:57Z` still show the same bottleneck: `22` `contacted`, `2` `replied`, `0` conversions, `1` public member, `0` public posts, dark Zernio analytics, and preview-only creator-platform distribution with `accountCount: 0` on every target platform even though committed fallback media resolves locally.
