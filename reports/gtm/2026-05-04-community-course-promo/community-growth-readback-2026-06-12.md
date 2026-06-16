# Community Growth Readback — 2026-06-12

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Command evidence from this run

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-13T02:12:06Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Media proof: all `6` previews resolved `docs/marketing/assets/*` media paths, and every asset reported `exists: false`
  - Constraint: every preview still showed `accountCount: 0`, so this runtime remains preview-only
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-13T02:12:06Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so operator docs should continue using the `byStage` mix as the real queue state
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown`
  - Run time: `2026-06-13T02:12:06Z`
  - Result: public read succeeded with `Members: 1`, `Visible posts on page: 0`, and no ranked revenue signals
  - Constraint: this is still only shallow public-page evidence; it does not prove About/Classroom/settings state
- Public page readback via direct web fetch of `https://www.skool.com/thumbgate-operator-lab-6000`
  - Run time: `2026-06-12`
  - Result: public shell currently exposes `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs, shows `JOIN GROUP`, and still shows `1 Member`
  - Constraint: this confirms the public shell and tab visibility only; it still does not verify actual About-page media/copy contents, Classroom lesson quality, or membership settings

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

## Asset truth in this checkout

- `docs/marketing/assets/` is missing from this checkout, so the underlying cover/icon/social/explainer files do not currently exist locally.
- A direct filename search in this checkout found no local copies of the expected `thumbgate-skool-*` or `thumbgate-operator-lab-*` media files.
- The promo launcher still expects those exact asset paths in `scripts/social-analytics/publish-thumbgate-launch.js`, so the failure is a real repo-path mismatch, not a copy-generation bug.
- The operator prompt says the Skool media assets should exist locally, so this remains a verified repo-vs-memory mismatch.

Implication: today’s local promo path is copy-preview-only. It is not a healthy media-backed proof path until the underlying asset files are restored into this checkout.

## Command-path truth

- The workflow-backed preview path present in this checkout is `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`.
- `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults `offer` to `operator-lab`.
- Direct public-page verification is available again in this runtime, but it only exposes a minimal public baseline.
- Authenticated browser readback is still required for About-page copy/media, Classroom lesson readiness, membership questions, and approval-state verification.

## Next approval-ready action

1. `Approve A1 warm Reddit follow-up batch`
2. If social dispatch is preferred instead: `Approve A2 Operator Lab promo preview`

Why A1 remains first: there is still no untouched self-serve Pro batch in the latest pipeline state, and warm contacted Reddit leads remain the shortest path to a Diagnostic or Sprint conversation.
