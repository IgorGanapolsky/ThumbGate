# Community Growth Readback — 2026-06-12

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Command evidence from this run

- `node scripts/sales-pipeline.js`
  - Run time: `2026-06-12T18:05:34Z`
  - Result: `24` active leads with `byStage.contacted=22`, `byStage.replied=2`, `0` targeted, and `0` paid
  - Interpretation: pipeline still has no untouched batch; the warm Reddit four-pack remains the highest-ROI queue
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - Run time: `2026-06-12T18:05:34Z`
  - Result: `Members: 1` and `Visible posts on page: 0`
  - Interpretation: public Skool visibility exists, but public surface density is still effectively zero
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-12T18:05:34Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, and every referenced `docs/marketing/assets/*` file still resolves `exists: false`
- `npm run social:zernio:status`
  - Run time: `2026-06-12T18:05:22.035Z`
  - Result: `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the status command exited non-zero and reported likely causes as `ZERNIO_API_KEY missing or revoked`, Zernio analytics paywall, or no accounts connected
  - Interpretation: GitHub Actions remains the only approved live promo path, but even that path still lacks useful analytics readback in this runtime

## External public-signal readback

Re-checked public web/search visibility on `2026-06-12`:

- the public Skool group page is indexed and shows `1 Member`
- public search also surfaces the YouTube Short `ThumbGate Operator Lab: stop fixing the same AI-agent mistake twice` at `https://www.youtube.com/shorts/vl1cuPogSHg`

Interpretation:

- awareness surfaces exist outside the repo
- those surfaces have not yet translated into Skool member growth or visible post activity
- the next community bottleneck is not copy generation; it is getting the first visible Skool post live

## Platform requirement refresh

Re-verified from official Skool help on `2026-06-12`:

- Discovery still requires group description, About page completion, cover image, and enough members/posts/activity
- Discovery FAQ still warns that algorithm changes are coming in `Q2 2026`
- the About page is still positioned as a landing/checkout page with image/video support
- Classroom still supports `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`
- AutoMod guidance still pushes manual approval, membership questions, and posting/chat level locks before broader growth
- Payments FAQ still documents the current fee schedule and payout model for paid communities

Primary brief:

- `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-12.md`

## Current blockers

1. no action-time confirmation yet for live posting or outreach
2. `docs/marketing/assets/` is still missing from this checkout, and a repo-wide asset filename search in this run found no Operator Lab media pack files anywhere in the checkout
3. local native media upload remains blocked, so live Skool work should stay copy-only or use a supported embed path
4. Zernio analytics still shows `0/6` healthy platforms, so social distribution is still measurement-dark even if publish approval arrives
5. the workflow is ready for an approval-time GitHub Actions run, but local runtime evidence still supports `preview` only for media-backed promo

## Next approval-ready action

1. `A1`: send the four warm Reddit follow-ups in `reports/gtm/2026-05-04-money-now/operator-send-now.md`
2. `A2`: publish the first copy-only public Skool post from `reports/gtm/2026-05-04-community-course-promo/skool-public-post-draft-2026-06-11.md`

Decision rule:

- choose `A1` if the goal is nearest-term revenue
- choose `A2` if the goal is Discovery/community unlock
