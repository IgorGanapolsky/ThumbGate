# Next Actions — Skool Operator Lab (2026-06-05)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Action-time approval card:

- `reports/gtm/2026-05-04-money-now/action-time-approval-2026-06-01.md`

Latest verification addenda:

- `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`
- `reports/gtm/2026-05-04-community-course-promo/skool-growth-readback-2026-06-04.md`

## Current truth anchors

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close-room scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Skool copy pack: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Next approval-ready money actions (highest ROI first)

### 1) Warm DMs (12 total) → log → route to Diagnostic/Sprint/Pro

- Queue + copy: `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- Logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- Current verified live queue at `2026-06-05T16:01:19Z`: `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid
- Highest-ROI rows remain the same six-lead batch: `github_easingthemes_dx_aem_flow`, `github_zaxbysauce_opencode_swarm`, `reddit_deep_ad1959_r_cursor`, `reddit_game_of_kton_r_cursor`, `reddit_leogodin217_r_claudecode`, `reddit_enthu_cutlet_1337_r_claudecode`
- Exact next approval-ready action: approve A1 only first, because the four warm Reddit follow-ups are the highest-intent rows and unblock either Diagnostic (`$499`) or Sprint (`$1500`) faster than more Skool setup work.
- This remains true after the `2026-06-05T16:01:19Z` re-verification pass: no newer revenue signal outranked the warm Reddit four-pack.

Approval rows:

- A1 (warm Sprint DMs 1–4)
- A2 (Pro guide-first 5–6)
- A3 (Sprint rollout 8–12)

### 2) Skool surface (unblocks conversion once traffic lands)

- Visual assets: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`, `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- About + pinned post copy: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Free starter-course copy: `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`
- Measurement/readback brief: `reports/gtm/2026-05-04-community-course-promo/skool-growth-readback-2026-06-04.md`
- Official Skool requirements re-verified on `2026-06-05`: Discovery FAQ updated `April 8, 2026`; unlisted checklist updated `April 15, 2026`; About page setup updated `December 9, 2025`; Classroom updated `May 29, 2026`; course publishing updated `March 13, 2025`; analytics definitions updated `November 24, 2025`.
- Membership intake guardrail re-verified on `2026-06-05`: Skool still allows a maximum of `3` membership questions, and only `1` can use the email answer type.

Approval rows:

- B1 (visuals)
- B2 (“Start Here” pinned post)
- B3 (free starter course)

### 3) Creator-platform promo workflow (preview-only unless approved)

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Local preview (safe): `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
- Current `2026-06-05T16:01:18Z` preview result: `6` previews rendered, every media asset exists, `accountCount: 0` on every platform in this runtime
- Local secret state re-verified at `2026-06-05T16:01:19Z`: `ZERNIO_API_KEY` is still missing in this shell, so live publish/schedule should stay on the GitHub Actions path with approved secrets
- Workflow target re-verified at `2026-06-05T16:01:19Z`: `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults to `operator-lab`
- Current `2026-06-05T16:01:18Z` Zernio readback result: `0/6` healthy platforms, `0` rows in the last `24h`
- GitHub visibility is split in this shell at `2026-06-05T16:01:19Z`: `gh pr list --state open --limit 5` succeeds, but `gh run list --branch main --limit 5` fails with GitHub API rate limiting and `npm run pr:manage` still fails with `error connecting to api.github.com`.
- Discovery guardrail from current Skool help: public Skool surfaces should avoid leading with off-platform payments because Skool currently lists that as a ranking penalty in Discovery.
- Official-platform refresh in this run: Skool Payments FAQ is still updated `April 22, 2026`, payout timing guidance is updated `May 5, 2026`, and Classroom guidance is updated `May 29, 2026`.

Approval rows:

- C1 (preview)
- C2 (publish)
- C3 (schedule)
