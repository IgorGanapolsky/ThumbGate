# Implementation Notes — Community Course Growth

Date: 2026-06-05
Task: Refresh the ThumbGate Skool/community/course growth and revenue loop with current repo evidence and official Skool requirement checks.

## Decisions

- Updated only GTM/community docs and automation memory surfaces, not product code.
  - Why: this run's highest-ROI work is keeping the money-motion queue and Skool requirements truthful so the next approval-ready outbound action stays clear.
- Kept the next action anchored on the four warm Reddit follow-ups before more Skool setup work.
  - Why: the live pipeline still shows `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid, so warm follow-up remains closer to revenue than more surface polish.
- Preserved the value-first Skool posture and kept paid conversion off the public Skool surface.
  - Why: current Skool Discovery help still lists off-platform payments as a ranking penalty, so public community copy should not lead with checkout.

## Assumptions

- VERIFIED: local dry-run promo previews are sufficient to prove workflow readiness for preview mode.
  - Evidence: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` returned `6` previews with repo-backed media files present.
- VERIFIED: local live publish is still not appropriate from this runtime.
  - Evidence: preview output still reports `accountCount: 0` on every platform, and `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless public Skool readback is still blocked here.
  - Evidence: `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` still exits with `[skool-reader] fetch failed`.
- VERIFIED: GitHub PR/CI visibility is blocked in this shell.
  - Evidence: `npm run pr:manage` failed with `error connecting to api.github.com`.
- VERIFIED: the Skool analytics definitions help article is older than the current Discovery/Classroom/payment articles.
  - Evidence: `https://help.skool.com/article/216-analytics-definitions` shows `Last updated on November 24, 2025`, while the other Skool help surfaces rechecked in this run show `April 8, 2026`, `April 15, 2026`, `May 29, 2026`, `April 22, 2026`, and `May 5, 2026`.

## Tradeoffs

- Did not touch unrelated dirty files already present in the worktree.
  - Alternative rejected: broad cleanup. Reason: the user explicitly asked to respect unrelated dirty changes.
- Did not attempt live Skool edits, outbound sends, or workflow dispatches.
  - Alternative rejected: action execution. Reason: the user explicitly requires action-time confirmation for publish/send/invite/upload operations.

## Corrections

- Corrected the GTM loop docs to reflect the current GitHub API blocker in this runtime instead of the earlier recovered-state note.
- Corrected the Skool analytics definitions timestamp in the community readback from `February 12, 2026` to `November 24, 2025`.
- Brought the stale acquisition queue forward from `2026-06-03` / `2026-05-05` framing to the current `2026-06-05` evidence set.

## Async Review Notes

- Current approval-ready money action is unchanged: approve A1 only first, the four warm Reddit follow-ups.
- Current operational blockers are also unchanged: Skool public readback is still blocked in headless mode, and Zernio analytics still has no local readback signal.

## 2026-06-05 Current Run 09:53Z

- Re-ran the live local evidence loop at `2026-06-05T09:53:24Z`:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
- VERIFIED: the live revenue queue is still unchanged at `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts, every referenced media asset exists, and `accountCount` remains `0` on every selected platform in this runtime.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility recovered in this shell; open PRs re-read successfully as `#2503`, `#2464`, `#2463`, `#2461`, and `#2445`, and the latest `main` push at `2026-06-04T21:15:42Z` still shows successful `CI`, `Deploy to Railway`, and deploy verification jobs.
- VERIFIED: official Skool help facts still support the current value-first free-group posture:
  - Discovery FAQ updated `April 8, 2026`
  - Discovery checklist updated `April 15, 2026`
  - About page setup updated `December 9, 2025`
  - Classroom updated `May 29, 2026`
  - Course permissions updated `November 10, 2025`
  - AutoDM updated `September 20, 2025`
  - Payments FAQ updated `April 22, 2026`
  - Payout status updated `May 5, 2026`
  - Analytics definitions updated `November 24, 2025`
- Corrections applied in this run:
  - Removed stale "GitHub blocked" notes from the active GTM docs and replaced them with the successful PR + `main` CI readback from this run.
  - Corrected the analytics definitions date in the operator handoff to `November 24, 2025`.
  - Corrected the payments help URL in the operator handoff to `https://help.skool.com/article/86-payments-faq`.

## 2026-06-05 Current Run 11:56Z

- Re-ran the local evidence loop at `2026-06-05T11:56:51Z`:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
- VERIFIED: the live revenue queue is still `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts, every referenced media asset exists, and `accountCount` remains `0` on every selected platform in this runtime.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility regressed again in this shell; `gh pr list --state open --limit 5` and `gh run list --branch main --limit 5` now fail with `error connecting to api.github.com`.
- Corrections applied in this run:
  - Replaced fresh/healthy GitHub language in the GTM docs with a truthful “current API visibility blocked” note.
  - Advanced all approval-ready revenue/community docs to the latest verification timestamp.

## 2026-06-05 Current Run 12:57Z

- Re-ran the highest-signal local checks at `2026-06-05T12:57:24Z`:
  - `printenv ZERNIO_API_KEY`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run pr:manage`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
- VERIFIED: `ZERNIO_API_KEY` is still missing in the local shell, so local live publish remains out of bounds for this runtime.
- VERIFIED: local Operator Lab preview still renders `6` posts and every referenced media asset exists.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility is still blocked in this shell; both `npm run pr:manage` and direct `gh` readbacks fail with `error connecting to api.github.com`.
- VERIFIED: public Skool/search signals still support the free-first posture:
  - `AI Operations Lab`: `722` members, free
  - `AI OPERATORS HQ`: `41` members, free
  - `AI Operator Club`: `40` members, free
  - `AI Operator Academy`: `35` members, `$999/year`
  - `AI Operator`: `13` members, free
- Corrections applied in this run:
  - Fixed the stale “PR/CI hygiene is readable again” line in the Skool growth readback.
  - Refreshed the public Skool market-signal section with current benchmark examples instead of the older June 3 snapshot.

## 2026-06-05 Current Run 13:58Z

- Re-ran the local evidence loop at `2026-06-05T13:58:41Z`:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
  - `npm run pr:manage`
- VERIFIED: the live revenue queue is still `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts, every referenced media asset exists, and `accountCount` remains `0` on every selected platform in this runtime.
- VERIFIED: `ZERNIO_API_KEY` is still absent locally and `npm run social:zernio:status` still reports `0/6` healthy platforms with `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility is now split, not fully blocked: direct `gh pr list` and `gh run list` succeed, while `npm run pr:manage` still fails with `error connecting to api.github.com`.
- VERIFIED: current open PR readback in this shell is `#2503`, `#2464`, `#2463`, `#2461`, and `#2445`; latest visible `main` CI/deploy evidence remains the successful `2026-06-04T21:15:42Z` push for `#2501`.
- Corrections applied in this run:
  - Removed stale “GitHub blocked” wording from the active GTM docs where direct `gh` evidence had recovered.
  - Removed the retired Team-tier language from `docs/WORKFLOW_HARDENING_SPRINT.md` so it matches `docs/COMMERCIAL_TRUTH.md`.

## 2026-06-05 Current Run 14:59Z

- Re-ran the live local evidence loop at `2026-06-05T14:59:56Z`:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
- VERIFIED: the live revenue queue is still `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts, every referenced media asset exists, and `accountCount` remains `0` on every selected platform in this runtime.
- VERIFIED: `ZERNIO_API_KEY` is still absent locally and `npm run social:zernio:status` still reports `0/6` healthy platforms with `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility regressed again from the prior split state; direct `gh` readbacks and `npm run pr:manage` now all fail with `error connecting to api.github.com`.
- VERIFIED: current Skool acquisition requirements still include the membership-questions cap of `3` total questions with only `1` email-type field, which is useful for capturing source + pain on join without overloading the form.
- Corrections applied in this run:
  - Replaced the stale “GitHub recovered” language across the active GTM/community docs with the current blocked state.
  - Added the current Skool membership-question constraint to the operator handoff and growth readback so the next browser-authenticated edit can wire the join funnel cleanly.

## 2026-06-05 Current Run 16:01Z

- Re-ran the live local evidence loop at `2026-06-05T16:01:19Z`:
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `npm run sales:pipeline`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
  - `gh run list --branch main --limit 5`
  - `npm run pr:manage`
- VERIFIED: the live revenue queue is still `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts, every referenced media asset exists, and `accountCount` remains `0` on every selected platform in this runtime.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility is partially available, not fully blocked:
  - `gh pr list --state open --limit 5` succeeds and currently shows `#2507`, `#2506`, `#2505`, `#2503`, and `#2464`
  - `gh run list --branch main --limit 5` fails with `HTTP 403` API rate limiting
  - `npm run pr:manage` still fails with `error connecting to api.github.com`
- Corrections applied in this run:
  - Replaced broad “GitHub blocked” wording in active GTM docs with the more accurate split-state readback.
  - Advanced the revenue/community timestamps to the latest local evidence set without changing the actual next money action.
