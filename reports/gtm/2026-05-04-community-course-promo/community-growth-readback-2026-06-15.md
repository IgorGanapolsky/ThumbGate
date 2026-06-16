# Community Growth Readback — 2026-06-15

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Latest command evidence

- Repo-side refresh timestamp: `2026-06-15T23:57:40Z`

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T23:57:26Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `npm run sales:pipeline -- summary`
  - Run time: `2026-06-15T23:57:26Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --json`
  - Run time: `2026-06-15T23:57:26Z`
  - Result: public read still returns `totalMembers: 1`, `totalPosts: 0`, one `General discussion` label, and no visible posts
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T23:57:26Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts

- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T01:43:47Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T01:43:47Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T01:43:47Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T01:43:47Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:zernio:status`
  - Run time: `2026-06-15T02:44:00Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: no connected-account evidence appeared between the `01:43Z` and `02:44Z` checks
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T04:45:23Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T04:45:22Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T04:45:23Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T04:45:23Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T05:45:53Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T05:45:53Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T05:45:53Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T05:45:31Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T06:46:20Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T06:46:20Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T06:46:33Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T06:46:20Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T07:47:48Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T07:47:48Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T07:47:48Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T07:47:48Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T08:47:21Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T08:47:21Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T08:47:21Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T08:47:21Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- Official Skool help readback
  - Run time: `2026-06-15`
  - Result: no material requirement delta versus the June 14 refresh; Discovery still needs threshold + complete About/cover setup, and the newer FAQ still says visibility lands within about `two hours`
  - Nuance: the older Discovery troubleshooting article still says `within an hour`, so operator docs should keep preferring the newer FAQ wording
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T09:48:57Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T09:48:57Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T09:48:57Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T09:48:57Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T10:49:55Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T10:49:55Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T10:49:55Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T10:49:28Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T11:48:53Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T11:48:54Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T11:48:54Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T11:48:54Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T12:49:51Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T12:49:51Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T12:49:51Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T12:49:51Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T13:51:55Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T13:51:56Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T13:51:56Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T13:51:57Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T14:53:03Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T14:53:03Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T14:53:03Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T14:53:03Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T16:53:34Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T16:53:35Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T16:53:35Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T15:51:58Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T15:51:58Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T15:51:58Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T15:51:58Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T17:54:23Z`
  - Result: still `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --json`
  - Run time: `2026-06-15T17:54:23Z`
  - Result: public read still returns `ThumbGate Operator Lab`, `Members: 1`, `totalPosts: 0`, one `General discussion` label, and no visible posts
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T17:54:23Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T21:56:35Z`
  - Result: `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 10 --format markdown`
  - Run time: `2026-06-15T21:56:36Z`
  - Result: public read still returns `Members: 1` and `Visible posts on page: 0`
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T21:56:18Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T21:56:35Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
 - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T19:56:36Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T19:56:36Z`
  - Result: still `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --json`
  - Run time: `2026-06-15T19:56:36Z`
  - Result: public read still returns `ThumbGate Operator Lab`, `Members: 1`, `totalPosts: 0`, one `General discussion` label, and no visible posts
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T19:56:36Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - Run time: `2026-06-15T18:54:57Z`
  - Result: `6` previews, `0` errors, `0` published, `0` scheduled
  - Constraint: every preview still shows `accountCount: 0`, so this runtime remains preview-only
  - Media proof: all preview media paths still resolve under committed `public/assets/brand/*` with `exists: true`
- `node scripts/sales-pipeline.js summary`
  - Run time: `2026-06-15T18:54:57Z`
  - Result: still `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`
  - Caveat: the script still emits a top-level `contacted: 24`, so queue decisions should keep using `summary.byStage`
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --json`
  - Run time: `2026-06-15T18:54:57Z`
  - Result: public read still returns `ThumbGate Operator Lab`, `Members: 1`, `totalPosts: 0`, one `General discussion` label, and no visible posts
  - Constraint: this is still shallow public-page evidence only; it does not verify About/Classroom/settings state
- `npm run social:zernio:status`
  - Run time: `2026-06-15T18:54:57Z`
  - Result: still dark at `0/6` healthy platforms and `0` rows in the last `24h`
  - Constraint: the command still exits non-zero; likely causes remain missing/revoked `ZERNIO_API_KEY`, analytics paywall, or disconnected accounts
- Official Skool help readback
  - Run time: `2026-06-15`
  - Result: still no material requirement delta; Discovery FAQ continues to say visibility lands within about `two hours` after threshold, and the invite/Classroom help pages still surface as recently published
  - Nuance: the public-community shell is still too thin to justify elevating discovery work above warm outbound

## Revenue interpretation

- The fastest money path is still the warm Reddit follow-up four-pack, not colder discovery or creator-platform distribution.
- Zero `checkout_started`, zero `sprint_intake`, and zero `paid` in the live pipeline keep that conclusion unchanged.
- Operator Lab promo is still dispatch-ready only through approval plus the GitHub Actions workflow; this local runtime cannot prove connected Zernio accounts or live analytics health.
- Public Skool visibility exists, but content depth does not. With only `1` visible member and `0` visible posts, driving more traffic into the same shell is unlikely to outperform direct warm follow-up.

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

### A2. Operator Lab creator-platform promo dispatch

Only if action-time confirmation is granted for social publishing:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Recommended mode: `preview` first, then `schedule` or `publish`
- Required offer input: `operator-lab`
- Recommended platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

### A3. Browser-authenticated Skool state verification

Only if action-time confirmation is granted to inspect the logged-in Skool session:

1. Verify About page copy is still value-first and complete.
2. Verify Classroom actually contains the intended free starter lesson/media.
3. Verify membership question count and approval posture.
4. Verify whether any archived state is enabled in settings.

## What changed in this run

- Re-confirmed at `2026-06-15T06:46:33Z` that A1 remains the only approval-ready money action.
- Re-verified the local promo preview path, pipeline state, public Skool baseline, and dark Zernio-status path.
- Re-verified official Skool help on `2026-06-15` and found no material requirement delta versus the June 14 refresh.
- Re-ran the repo-side loop at `2026-06-15T06:46:33Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T07:47:48Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T08:47:21Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T09:48:57Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T10:49:55Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T11:48:54Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T12:49:51Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T13:51:57Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
- Re-ran the repo-side loop at `2026-06-15T18:54:57Z` and still found no pipeline movement, no public Skool depth gain, and no Zernio analytics recovery.
