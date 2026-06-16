# Community Growth Readback — 2026-06-13

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Command evidence from this run

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-13T12:18:16Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Media proof: all `6` previews resolved `docs/marketing/assets/*` media paths, and every asset reported `exists: false`
  - Constraint: every preview still showed `accountCount: 0`, so this runtime remains preview-only
  - Command-path truth: there is no callable local `creator:platform:promo` npm alias in this checkout; `.github/workflows/thumbgate-creator-platform-promo.yml` invokes this same `social:publish:launch` command
  - Re-check in this run before `2026-06-13T14:20:56Z`: same `6` previews, same missing assets, same `0` connected accounts
  - Re-check in this run before `2026-06-13T15:20:14Z`: same `6` previews, same missing assets under `docs/marketing/assets/*`, same `0` connected accounts
  - Re-check in this run before `2026-06-13T16:21:48Z`: same `6` previews, same missing assets under `docs/marketing/assets/*`, and the same `0` connected accounts
  - Re-check in this run before `2026-06-13T18:24:04Z`: same `6` previews, same missing assets under `docs/marketing/assets/*`, and the same `0` connected accounts
  - Re-check in this run at `2026-06-13T20:25:48Z`: still `6` previews, `0` errors, `0` connected accounts, but the launcher now falls back to committed brand assets under `public/assets/brand/*`, so every preview media path resolves with `exists: true`
- `npm run sales:pipeline`
  - Run time: `2026-06-13T12:18:16Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so operator docs should continue using the `byStage` mix as the real queue state
  - Re-check in this run before `2026-06-13T14:20:56Z`: no stage movement; actionable state is still `22` `contacted`, `2` `replied`, `0` `paid`
  - Re-check in this run before `2026-06-13T15:20:14Z`: still no stage movement; actionable state remains `22` `contacted`, `2` `replied`, `0` `paid`, `0` `checkout_started`, and `0` `sprint_intake`
  - Re-check in this run before `2026-06-13T16:21:48Z`: still no stage movement; actionable state remains `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown`
  - Run time: `2026-06-13T12:18:16Z`
  - Result: public read succeeded with `Members: 1`, `Visible posts on page: 0`, and no ranked revenue signals
  - Constraint: this is still only shallow public-page evidence; it does not prove About/Classroom/settings state
  - Re-check in this run before `2026-06-13T14:20:56Z`: same shallow baseline of `Members: 1` and `Visible posts on page: 0`
  - Re-check in this run before `2026-06-13T15:20:14Z`: same shallow baseline of `Members: 1`, `Visible posts on page: 0`, and no ranked revenue signals
  - Re-check in this run before `2026-06-13T16:21:48Z`: same shallow baseline of `Members: 1`, `Visible posts on page: 0`, and no ranked revenue signals
  - Re-check in this run before `2026-06-13T18:24:04Z`: same shallow baseline of `Members: 1`, `Visible posts on page: 0`, and no ranked revenue signals
- Public page readback via direct web fetch of `https://www.skool.com/thumbgate-operator-lab-6000`
  - Run time: `2026-06-13T12:18:16Z`
  - Result: public shell currently exposes `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, shows `JOIN GROUP`, still shows `1 Member`, and search-visible copy still reads “Stop repeated AI-agent mistakes. Bring a Claude Code, Codex, Cursor, Gemini, Amp, or MCP failure; we turn it into a prevention rule.”
  - Additional signal: the public community feed still shows the placeholder line `This is the start of something special`, which reinforces that discovery-facing public activity is still thin
  - Additional signal: the page payload currently exposes `public: true` and `archived: true` in the embedded group metadata, which raises the priority of logged-in verification
  - Constraint: this confirms the public shell and tab visibility only; it still does not verify actual About-page media/copy contents, Classroom lesson quality, membership settings, or whether the archived flag is intentional
  - Re-check in this run before `2026-06-13T15:20:14Z`: same public shell with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, the same `JOIN GROUP` CTA, and the same placeholder activity line
  - Re-check in this run before `2026-06-13T16:21:48Z`: same public shell with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, the same `JOIN GROUP` CTA, and the same placeholder activity line
  - Re-check in this run before `2026-06-13T18:24:04Z`: same public shell with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, the same `JOIN GROUP` CTA, the same placeholder activity line, and the same `archived: true` payload signal
- Local secret-path check
  - Run time: `2026-06-13T18:24:04Z`
  - Result: `ZERNIO_API_KEY` is absent from the current env
  - Constraint: live media-backed publish/schedule remains GitHub-Actions-only until a real secret is loaded in a controlled runtime
- Local asset-path check
  - Run time: `2026-06-13T18:24:04Z`
  - Result: `docs/marketing/assets/` is still absent in this checkout, so every social preview media path still resolves to a missing file; only `thumbgate-skool-cover-1084x576.png` and `thumbgate-skool-icon-128x128.png` were found elsewhere under `.artifacts/claude-desktop/bundle/public/assets/skool/`
  - Constraint: even preview evidence is copy-only until the asset pack is restored into the repo path expected by the launcher or the launcher path is updated
- Latest loop re-check
  - Run time: `2026-06-13T18:24:04Z`
  - Result: `npm run sales:pipeline` still reports `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` still returns `Members: 1` and `Visible posts on page: 0`; `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still returns `6` previews, `0` errors, `0` published, `0` scheduled, `0` connected accounts, and missing `docs/marketing/assets/*` media paths
  - Constraint: the revenue queue is unchanged, the promo path is still copy-preview-only in this local runtime, and the Skool archive-state signal is still unresolved
  - Update at `2026-06-13T20:25:48Z`: the revenue queue is still unchanged, and the Skool archive-state signal is still unresolved, but the local promo path is no longer blocked on missing media because the launcher now resolves committed fallback assets under `public/assets/brand/*`; it remains preview-only because `accountCount` is still `0` and there is still no live local `ZERNIO_API_KEY`
  - Update at `2026-06-13T21:25:15Z`: the queue remains unchanged, `.env` and `.env.example` still contain no `ZERNIO_API_KEY=` line, and a direct public fetch still matches `\"archived\":true` plus the placeholder starter-feed line
  - Update at `2026-06-13T22:25:20Z`: `node scripts/sales-pipeline.js summary` still reports actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; live web verification still shows the same thin public shell with `JOIN GROUP`, `1 Member`, and `This is the start of something special`
  - Update at `2026-06-13T23:26:26Z`: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still returns `6` previews, `0` errors, `0` published, `0` scheduled, and `0` connected accounts, with every preview media path resolving under committed `public/assets/brand/*`; `node scripts/sales-pipeline.js summary` still reports actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` still returns `Members: 1` and `Visible posts on page: 0`
  - Update at `2026-06-14T00:28:11Z`: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still returns `6` previews, `0` errors, `0` published, `0` scheduled, and `0` connected accounts, with every preview media path resolving under committed `public/assets/brand/*`; `node scripts/sales-pipeline.js summary` still reports actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` still returns `Members: 1` and `Visible posts on page: 0`
  - Update at `2026-06-14T01:29:05Z`: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still returns `6` previews, `0` errors, `0` published, `0` scheduled, and `0` connected accounts, with every preview media path resolving under committed `public/assets/brand/*`; `node scripts/sales-pipeline.js summary` still reports actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` still returns `Members: 1` and `Visible posts on page: 0`; `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`

## Official Skool refresh

Re-checked Skool help-center guidance on `2026-06-13`:

- Discovery still requires cover image, group description, completed About page, and enough members/posts/activity to become visible.
- Discovery FAQ still says visibility lands within `2` hours after threshold, while the checklist still says "usually within an hour."
- Discovery FAQ still carries a banner that Discovery algorithm updates are coming in `Q2 of 2026`.
- Discovery ranking still penalizes `Payments off-platform`, so public Skool copy should stay value-first instead of checkout-heavy.
- The About page is still framed as the landing/checkout page and still must be completed for Discovery eligibility.
- The Classroom tab is still a separate visibility control, so a free course can be effectively hidden even when published if the tab is off.
- Free-community invites are still supported directly through the Invite tab via share link or email invite, so current growth ops do not require flipping Operator Lab to paid.
- Pricing modes still include `free`, `subscription`, `freemium`, `tiered pricing`, and `one-time payment`.
- Membership questions still cap at `3`, with only `1` email-type question.
- Classroom/course behavior still supports `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`.
- Skool still supports native video upload for Classroom pages and community posts/comments, which confirms the current media blockage is a local automation/file-picker issue rather than a platform limitation.
- Skool now explicitly documents AutoMod-style spam controls: manual approvals, membership questions, and level-gated posting/chat.
- Payout setup still uses a Skool-managed Stripe Express connection and still recommends previewing the public About page before going live with paid settings.
- Public-source spot checks on `2026-06-13T16:21:48Z` found no requirement delta versus the earlier June 13 refresh.
- Official-source web readback was re-confirmed again in this run on `2026-06-13`; no requirement delta was detected versus the earlier June 13 refresh.
- Official-source web readback was re-confirmed again at `2026-06-13T23:26:26Z`; no requirement delta was detected versus the earlier June 13 refresh.
- Official-source web readback was re-confirmed again at `2026-06-14T00:28:11Z`; no requirement delta was detected versus the earlier June 13 refresh.

## Asset truth in this checkout

- `docs/marketing/assets/` is missing from this checkout, so the launcher's expected asset path is currently broken.
- A direct filename search in this checkout found only `thumbgate-skool-cover-1084x576.png` and `thumbgate-skool-icon-128x128.png` under `.artifacts/claude-desktop/bundle/public/assets/skool/`; the remaining expected `thumbgate-skool-*` or `thumbgate-operator-lab-*` media files were not present locally.
- `scripts/social-analytics/publish-thumbgate-launch.js` now falls back to committed brand assets under `public/assets/brand/thumbgate-logo-1200x360.png` and `public/assets/brand/thumbgate-icon-512.png` when the canonical Skool asset pack is absent.
- The operator prompt says the Skool media assets should exist locally, so this remains a verified repo-vs-memory mismatch.

Implication: today’s local promo path is media-backed again for preview purposes, but not locally publishable. The remaining blockers are `accountCount: 0`, no real local `ZERNIO_API_KEY`, and the unresolved authenticated Skool state check.

No queue movement was detected between the `2026-06-13T11:17:53Z` and `2026-06-13T12:18:16Z` checks.
No queue movement was detected between the `2026-06-13T12:18:16Z`, `2026-06-13T14:20:56Z`, and `2026-06-13T15:20:14Z` checks either.
No queue movement was detected between the `2026-06-13T15:20:14Z` and `2026-06-13T16:21:48Z` checks either.
No queue movement was detected between the `2026-06-13T16:21:48Z` and `2026-06-13T17:21:55Z` checks either.
No queue movement was detected between the `2026-06-13T17:21:55Z` and `2026-06-13T18:24:04Z` checks either.
No queue movement was detected between the `2026-06-13T21:25:15Z` and `2026-06-13T22:25:20Z` checks either.
No queue movement was detected between the `2026-06-13T22:25:20Z` and `2026-06-13T23:26:26Z` checks either.
No queue movement was detected between the `2026-06-13T23:26:26Z` and `2026-06-14T00:28:11Z` checks either.
No queue movement was detected between the `2026-06-14T00:28:11Z` and `2026-06-14T01:29:05Z` checks either.

## Command-path truth

- The workflow-backed preview path present in this checkout is `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`.
- `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults `offer` to `operator-lab`.
- Direct public-page verification is available again in this runtime, but it only exposes a minimal public baseline.
- Direct public-page verification is available again in this runtime, but it only exposes a minimal public baseline plus an unresolved `archived: true` metadata signal.
- Authenticated browser readback is still required for About-page copy/media, Classroom lesson readiness, membership questions, and approval-state verification.

## Next approval-ready action

1. `Approve A1 warm Reddit follow-up batch`
2. If social dispatch is preferred instead: `Approve A2 Operator Lab promo preview`
3. If logged-in Skool inspection is preferred instead: `Approve A3 browser-authenticated Skool verification`

Why A1 remains first: there is still no untouched self-serve Pro batch in the latest pipeline state, and warm contacted Reddit leads remain the shortest path to a Diagnostic or Sprint conversation. A3 moved up in priority because the public payload now suggests the group may be archived.
