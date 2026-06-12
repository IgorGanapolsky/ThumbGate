# Community Growth Readback — 2026-06-11

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Command evidence from this run

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-12T03:55:38Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Media proof: all `6` previews resolved `docs/marketing/assets/*` media paths, and every asset reported `exists: false`
  - Constraint: every preview still showed `accountCount: 0`, so this runtime remains preview-only
- `npm run social:zernio:status`
  - Run time: `2026-06-12T03:54:59.008Z`
  - Result: `0/6` healthy platforms, `0` rows in the last `24h`
  - Immediate interpretation: Zernio is not giving useful analytics readback in this runtime today
- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown`
  - Run time: `2026-06-12T03:55:38Z`
  - Result: succeeded with `Members: 1` and `Visible posts on page: 0`
  - Immediate interpretation: public readback works again, and the verified bottleneck is sparse public activity rather than verification failure
- `node scripts/sales-pipeline.js`
  - Run time: `2026-06-12T03:55:37Z`
  - Result: `24` active leads with `byStage.contacted=22`, `byStage.replied=2`, `0` targeted, `0` paid
  - Command-path correction: the valid verification command is the default `report` invocation; `snapshot` is not a supported subcommand

## Official Skool refresh

Re-checked Skool help-center guidance on `2026-06-11`:

- Discovery still requires cover image, group description, completed About page, and enough members/posts/activity to become visible.
- Discovery FAQ still says visibility lands within `2` hours after threshold, while the checklist still says "usually within an hour."
- Discovery FAQ also now carries a banner that Discovery algorithm updates are coming in `Q2 of 2026`.
- Discovery ranking still penalizes `Payments off-platform`, so public Skool copy should stay value-first instead of checkout-heavy.
- The About page is still framed as the landing/checkout page and still must be completed for Discovery eligibility.
- Pricing modes still include `free`, `subscription`, `freemium`, `tiered pricing`, and `one-time payment`.
- Membership questions still cap at `3`, with only `1` email-type question.
- Classroom/course behavior still supports `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`, and the publish-a-course article still says courses are published by default until toggled back to draft.
- The current `What is Classroom?` article updated `May 29, 2026` still confirms the first free course can act as a document/lesson/resource surface with folders, resource links/files, and pinned community posts.
- The `AutoMod` anti-spam article updated `April 2, 2026` now makes Skool's preferred moderation ladder explicit: manual approvals, membership questions, posting/chat level locks, and one-click ban/delete cleanup.
- Skool now documents a Meta pixel plugin for About-page views, membership requests, and purchases; that is a future measurement lever, not an approved current action.
- Payout setup still uses a Skool-managed Stripe Express connection and still recommends previewing the public About page before going live with paid settings.
- Skool's Discovery checklist still explicitly calls for at least one post plus invited members for newer groups, which matters because the current public readback only shows `1` member and `0` visible posts.

## Asset truth in this checkout

- `public/assets/skool/` is absent in this checkout, so there is no local fallback layer for the missing `docs/marketing/assets/*` files.
- `docs/marketing/assets/` is missing from this checkout, so the underlying cover/icon files do not currently exist.
- `find docs/marketing -maxdepth 3 -type f` currently returns only `codex-marketplace-revenue-pack.json`, `codex-marketplace-revenue-pack.md`, and `codex-operator-queue.csv`.
- The operator prompt says the Skool media assets should exist locally, so this is a verified repo-vs-memory mismatch rather than just a bad preview path.
- local explainer MP4/social-story asset files referenced in older notes are also absent from this checkout.
- The free-course listing copy itself is present and current at `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`; the missing layer is only the media-backed live edit path.

Implication: today’s local promo path is copy-preview-only. It is not a healthy media-backed proof path until the underlying asset files are restored.

## Command-path correction

- The workflow-backed preview path present in this checkout is `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`.
- `.github/scripts/creator-platform-promo.js` is not present locally, so any older note that cites that path as runnable evidence should be treated as stale.
- Direct public-page verification is available again through `node scripts/skool-reader.js`, which now returns a minimal public digest for the live group.
- Pipeline verification note: `node scripts/sales-pipeline.js` exposes both `summary.contacted` and `summary.byStage.contacted`; use `byStage` for true stage counts because `summary.contacted` is a broader rollup of all contacted-or-beyond leads.

## Next approval-ready action

1. `Approve A1 warm Reddit follow-up batch`
2. If social dispatch is preferred instead: `Approve A2 Operator Lab promo preview`
3. If community setup work is preferred instead: `Approve A3 free Classroom starter-course edit`
4. If a lighter community seed is preferred instead: `Approve A4 first public Skool post`

Why A1 remains first: there is still no untouched self-serve Pro batch in the latest pipeline state, and warm contacted Reddit leads remain the shortest path to a Diagnostic or Sprint conversation.
