# Operator Approval Queue — Community/Course Growth

Updated: 2026-05-05

These are the next “money motion” actions prepared for quick approval.

Note: Use `https://thumbgate-production.up.railway.app` as the canonical CTA base unless `thumbgate.ai` redirect behavior has been verified.

## Skool setup (approval-required)

- Decisions to confirm (pick 1 per line before executing anything):
  - About media: `hero_image` | `landscape_video` | `vertical_video` | `skip_for_now`
  - Pinned post: `skool-start-here-post.md` Version A (default) | (pick another version)
  - First post: `skool-first-post.md` Version A (default) | B | C
  - Link policy for posts: `no_links` | `guide_only` | `guide+pro+sprint` (avoid “Diagnostic” unless hosted checkout is configured)

- Today’s minimum viable launch:
  - Upload cover + icon
  - Publish + pin “Start Here”
  - Publish the first post
  - Invite first 10–20
  - Optional: follow the 7-day launch plan (`skool-7-day-launch-plan.md`)

- Today’s “copy pack” (paste verbatim after approval):
  - Start Here (pin this): Version A in `skool-start-here-post.md`
  - First post (publish same day): Version A in `skool-first-post.md`

- Upload cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Upload icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Upload About media (optional): see `skool-media-upload-steps.md`
- Publish first post: pick Version A/B/C from `skool-first-post.md`
- Publish + pin “Start Here” post: pick Version A from `skool-start-here-post.md`
- Refresh listing fields (sidebar/About/keywords) from `skool-listing-copy.md`
- Invite first 10–20: populate `docs/OUTREACH_TARGETS.md` first, then invite
- Invite target queue template (Skool-specific): `skool-invite-target-queue.md`
- Refresh Skool discovery requirements checklist in `platform-requirements-refresh.md`
- Optional (Day 4): post routing clarity using `skool-day4-routing-post.md`
- Optional: prepare a Skool promo-group post (Classifieds-style) from `skool-classifieds-post-drafts.md`
- Optional: run the week plan: `skool-7-day-launch-plan.md`

## Revenue injection (approval-required)

- Send the top 4 warm Reddit sprint DMs from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- Send 3 self-serve Pro guide-first messages from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- After replies: use `reports/gtm/2026-05-04-money-now/revenue-close-room.md` scripts

## Promo drafts (no publishing, approval-required)

Goal: generate operator-lab promo post drafts for off-platform shares without publishing anything.

- Local dry-run (generates drafts only; requires no posting credentials):

```bash
npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms='linkedin,instagram,threads,bluesky,reddit,youtube'
```

- GitHub Actions dry-run (same output intent; safe preview mode):
  - Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
  - Inputs: `mode=preview`, `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
