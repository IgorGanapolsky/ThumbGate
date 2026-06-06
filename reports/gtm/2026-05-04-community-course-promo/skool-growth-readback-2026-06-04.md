# Skool Growth Readback Brief

Updated: 2026-06-06T19:18:17Z

Guardrail: do not change the live Skool group, publish posts, upload media, or submit forms without action-time confirmation.

## Verified in this run

- Headless Skool readback remains blocked in this runtime as of `2026-06-06T19:18:17Z`: `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` still exits with `[skool-reader] fetch failed`.
- Local promo preview for `--offer=operator-lab` is still healthy as of `2026-06-06T19:18:17Z` and returns `6` previews for `linkedin,instagram,threads,bluesky,reddit,youtube`.
- Every previewed media asset still resolves to a local file with `exists: true`.
- Preview-mode `accountCount` is still `0` for each platform in this runtime, so publish/schedule should stay on the GitHub Actions workflow with secrets.
- `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h` as of `2026-06-06T19:17:44Z`.
- GitHub visibility remains partial in this runtime as of `2026-06-06T19:18:17Z`:
  - `gh pr list --state open --limit 5` succeeds and currently shows open PRs `#2550`, `#2541`, `#2540`, `#2511`, and `#2503`
  - deeper Actions and PR-manager readback were not re-verified in this run

## Current Skool analytics cadence from official help

- `Members`: real-time
- `MRR`: real-time
- `Monthly Free Trials`: real-time
- `Conversion Rate`: every `8` hours
- `About Page Views And Conversion`: every `8` hours
- `Monthly Cashflow`: every `8` hours

Reference:

- https://help.skool.com/article/216-analytics-definitions
- Latest observed help-center update dates in this run:
  - Analytics definitions: `November 24, 2025`
  - Discovery FAQ: `April 8, 2026`
  - Discovery checklist ("Why isn't my group visible on Discovery?"): `April 15, 2026`
  - About page setup: `December 9, 2025`
  - Classroom basics: `May 29, 2026`
  - Membership questions: re-verified in this run for the current `3` question / `1` email-field limit
  - Payments FAQ: `April 22, 2026`
  - Payout-status guidance: `May 5, 2026`

## What to verify in the next browser-authenticated window

1. Public About page shows the current ThumbGate Operator Lab copy.
2. Cover image and icon are visibly live.
3. Growth tab reports non-zero About page visits after promo traffic lands.
4. Membership question responses capture source + workflow pain once the join flow is opened.
5. A pinned `Start Here` post exists and is visible publicly.
6. Membership questions are live with exactly three prompts: source, repeated workflow failure, and contact email.

## Approval-ready interpretation

- Discovery setup remains incomplete until public readback confirms the About page, artwork, and at least one post.
- Skool's current Discovery FAQ still lists off-platform payments as a ranking penalty, so public Skool surfaces should stay value-first and route paid closes only after direct follow-up or pain confirmation.
- Promo workflow readiness is good for preview, but not for local publish.
- PR/CI hygiene is only partially readable from this shell right now: open PR listing and `main` workflow rows are readable again, but PR-manager and per-PR detail readback still fail against `api.github.com`.
- Current highest-ROI bottleneck is still outbound follow-up on the four warm Reddit rows, not new platform setup work.
- Latest approval-ready money action remains the same: send the first four warm Reddit follow-ups before doing more Skool surface work or inventing a colder batch.
