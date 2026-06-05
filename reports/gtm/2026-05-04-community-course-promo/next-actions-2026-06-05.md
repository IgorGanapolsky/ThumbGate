# Next Actions — Skool Operator Lab (2026-06-05)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Action-time approval card:

- `reports/gtm/2026-05-04-money-now/action-time-approval-2026-06-05.md`

Latest verification addenda:

- `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`
- `reports/gtm/2026-05-04-community-course-promo/skool-growth-readback-2026-06-04.md`
- `reports/gtm/2026-05-04-community-course-promo/operator-lab-post-pack-2026-06-05.md`

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Skool copy pack: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Current evidence snapshot

- Local `--offer=operator-lab` dry-run re-verified at `2026-06-05T22:07:35Z`: `6` previews rendered for `linkedin,instagram,threads,bluesky,reddit,youtube`.
- Every referenced media asset in the preview still resolves with `exists: true`.
- Local preview still shows `accountCount: 0` for every platform, so this shell is still preview-only for social publishing.
- `npm run social:zernio:status` re-verified at `2026-06-05T22:07:35Z`: `0/6` healthy platforms and `0` analytics rows in the last `24h`.
- Headless Skool readback still fails at `2026-06-05T22:07:35Z` with `[skool-reader] fetch failed`.
- GitHub visibility is unstable:
  - the most recent partial snapshot remains the earlier `2026-06-05T20:06:59Z` read where `gh pr list --state open --limit 10` succeeded and showed `#2511`, `#2509`, `#2503`, `#2464`, `#2463`, `#2461`, `#2445`, `#2444`, `#2439`, and `#2438`
  - the latest combined PR/Actions probe failed at `2026-06-05T22:07:35Z` with `error connecting to api.github.com`
  - `npm run pr:manage` and direct `gh pr view` calls remain unreliable from this shell
- Official Skool help re-confirmed in this run:
  - Discovery FAQ updated `April 8, 2026`
  - Discovery checklist updated `April 15, 2026`
  - Classroom basics updated `May 29, 2026`
  - Points and levels updated `January 24, 2025`
  - Course permissions updated `November 10, 2025`
  - Membership questions updated `September 19, 2025`
  - Video uploads updated `February 12, 2026`
  - Course permissions guidance still shows `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`
  - Membership questions guidance still limits joins to `3` questions with `1` email answer field
  - Analytics definitions updated `November 24, 2025`, and About-page conversion refreshes every `8` hours
  - Payments FAQ updated `April 22, 2026`
  - Payout-status guidance updated `May 5, 2026`

## Next approval-ready money actions

### 1) A1 first: warm Reddit four-pack

- Queue + copy: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Offer path: Diagnostic (`$499`) if pain is real but scope is unclear; Sprint (`$1500`) if one workflow owner and one repeated failure are already clear.
- Rows:
  - `reddit_deep_ad1959_r_cursor`
  - `reddit_game_of_kton_r_cursor`
  - `reddit_leogodin217_r_claudecode`
  - `reddit_enthu_cutlet_1337_r_claudecode`
- Why first: this is still the highest-intent queue and the fastest path to booked revenue; nothing in the current Skool or social readback outranks it.
- After each send, run the exact `Log after send` command from `operator-send-now.md`.

### 2) A2 second: untouched Pro guide-first leads

- Rows:
  - `github_easingthemes_dx_aem_flow`
  - `github_zaxbysauce_opencode_swarm`
- Offer path: guide-first self-serve, then Pro at `$19/mo` or `$149/yr` if the install/evidence lane fits.
- Only work this batch after A1 is approved/sent.

### 3) B-lane: Skool conversion surface

- Use the current cover/icon assets and About copy already staged in the repo.
- Keep the public Skool page value-first because Skool Discovery still treats off-platform payments as a ranking penalty.
- When membership questions are turned on, use the current three-question pack:
  - current agent or workflow
  - repeated mistake or approval risk
  - contact email
- Highest-value missing public checks once browser-authenticated access is available:
  - About page is live
  - cover + icon are visibly live
  - pinned `Start Here` post is public
  - starter course is published and open

### 4) C-lane: creator-platform promo workflow

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Current target is still `--offer=operator-lab`.
- Safe local command:

```bash
npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube
```

- Live publish/schedule should remain on the GitHub Actions path with approved secrets only.
- Do not queue live publish until action-time confirmation exists and Zernio/analytics visibility is healthy enough to measure the post.

## Recommended approval prompt for the next live action

- Approve `A1` only: send the four warm Reddit follow-ups from `operator-send-now.md`, then log each send with the row-specific pipeline command.

## What not to spend the next cycle on

- Do not invent a new offer ladder.
- Do not spend another cycle polishing Skool copy while the warm six-lead queue is untouched.
- Do not attempt local live publish from this shell.
