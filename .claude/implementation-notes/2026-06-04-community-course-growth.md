## Task

Refresh the ThumbGate community/course growth loop artifacts for the Skool Operator Lab using current local evidence and current official Skool requirements.

## Decisions

- Added the missing `skool-classroom-listing-copy.md` file because the live operator handoff already referenced it as an approval-ready asset.
- Added a new dated `skool-growth-readback-2026-06-04.md` brief instead of backfilling the missing `2026-06-02` file.
  - Why: the latest verified evidence in this run is from 2026-06-04, and the old file never existed.
- Updated the current handoff and next-actions docs in place rather than creating another handoff variant.
  - Why: these are the active operator surfaces already linked from the revenue docs.
- Refreshed the active revenue + Skool docs again after re-verifying the live local state at `2026-06-04T21:38Z` to avoid leaving stale timestamps in the approval queue.
  - Why: these GTM files are operational runbooks; stale timestamps make approval-time decisions weaker.
- Refreshed the timestamps a second time after direct command re-verification at `2026-06-04T22:39Z`.
  - Why: this run produced fresh command output for sales pipeline, promo preview, Zernio status, and Skool readback, so the GTM docs needed to match the latest evidence exactly.
- Refreshed the timestamps a third time after direct command re-verification at `2026-06-04T23:39Z` and added the latest visible `main` CI readback.
  - Why: the revenue loop benefits more from exact current evidence than from preserving earlier timestamps inside operator runbooks.

## Assumptions

- VERIFIED: local sales-pipeline summary still reports `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local `--offer=operator-lab` promo dry-run still returns `6` previews and every referenced media asset exists.
- VERIFIED: local dry-run still reports `accountCount: 0` across the selected platforms, so live publishing should stay on the GitHub Actions path.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: `gh pr list --state open --limit 5` currently returns `#2503`, `#2464`, `#2463`, `#2461`, and `#2445`, while `main` CI still shows the latest merge commit completed successfully on `2026-06-04`.
- VERIFIED: official Skool help currently states Discovery visibility is usually within `2` hours after threshold, About page completion is required, membership questions max out at `3`, AutoDM sends in `1` to `5` minutes, and analytics refreshes for About/Growth metrics are every `8` hours.
- VERIFIED: official Skool help currently exposes course access modes `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`, which supports keeping the first course fully open.
- UNVERIFIED: the current Skool UI still accepts the existing local About copy without additional truncation or formatting changes beyond the known field guidance.
- UNVERIFIED: the Skool About page, cover, and icon are visibly live on the public group page because this runtime still cannot read back the page headlessly.

## Tradeoffs

- Kept paid conversion guidance off the main public About/course surfaces except as optional follow-up language.
  - Reason: current Skool Discovery guidance still lists off-platform payments as a ranking penalty.
- Did not attempt browser-authenticated verification or live publish/schedule.
  - Reason: the automation guardrail explicitly requires action-time confirmation for those write actions.

## Corrections

- Found that `operator-handoff.md` referenced two files that did not exist. Fixed by creating the missing assets and pointing the handoff to the current dated growth brief.
- Tightened the next-actions doc to call out A1 as the exact next approval action instead of implying the whole 12-row batch should move at once.
- Tightened `operator-send-now.md` to match the live queue: four active warm follow-ups, then two untouched Pro leads, then defer the longer cold queue.
- Added the latest successful `main` CI visibility into the money loop docs to separate repo health from revenue-loop blockers.

## 2026-06-05 Follow-up

- Re-ran the live local revenue-loop checks instead of trusting the prior timestamps:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh run list --branch main --limit 5`
- Updated the active GTM docs to this run's timestamp (`2026-06-05T01:42:27Z`) so the approval queue reflects current evidence, not the previous run.
- Added the discovery tradeoff more explicitly: Skool's current Discovery FAQ still lists off-platform payments as a ranking penalty, so public Skool surfaces should stay value-first and paid motion should happen only after direct follow-up or pain confirmation.
- Noted a fresh GitHub API connectivity failure when re-checking open PR state.
  - Why: session protocol requires PR visibility, but the runtime could only prove `main` CI visibility this run; open PR state remains last-known-good from the earlier successful check.
- Re-ran the same evidence loop again at `2026-06-05T02:43Z` after Skool help re-verification.
  - Why: the current run recovered direct `gh pr list` visibility, and the GTM docs needed to stop describing open-PR state as stale/intermittent when a fresh successful snapshot existed.
- Re-verified the latest observed Skool help update dates while keeping the same operational guidance:
  - Discovery FAQ: `April 8, 2026`
  - Why isn't my group visible on Discovery?: `April 15, 2026`
  - Analytics definitions: `February 12, 2026`
- Re-ran the same local evidence loop again at `2026-06-05T03:45Z`.
  - Why: the active money-action docs should reflect the current run's state, not a prior shell's timestamps.
- Confirmed the live revenue queue did not change:
  - `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid.
- Confirmed the local Operator Lab preview still renders `6` posts with all media assets present and `accountCount: 0` on every platform.
- Confirmed `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- Confirmed headless Skool readback still fails with `[skool-reader] fetch failed`.
- Corrected the GitHub visibility note again:
  - `gh pr list --state open --limit 5` had succeeded earlier in the session, but a fresh retry at `2026-06-05T03:45:40Z` failed with `error connecting to api.github.com`, so current PR visibility in this runtime must be described as degraded, not healthy.
- Added one more official Skool help delta:
  - Classroom basics article updated `May 29, 2026`.
- Re-ran the local evidence loop again at `2026-06-05T04:45Z` and refreshed the active GTM docs in place.
  - Why: this run restored direct `gh pr list` visibility, so the operator docs needed to stop describing GitHub API state as degraded.
- Confirmed the live revenue queue is unchanged:
  - `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid.
- Confirmed the local Operator Lab preview still renders `6` posts with all media assets present and `accountCount: 0` on every platform.
- Confirmed `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- Confirmed headless Skool readback still fails with `[skool-reader] fetch failed`.
- Corrected the GitHub visibility note again:
  - `gh pr list --state open --limit 5` succeeded at `2026-06-05T04:45:58Z`, so open-PR visibility is currently healthy in this runtime even though it had been intermittent earlier in the session.
- Re-ran the local evidence loop again at `2026-06-05T05:48Z` and refreshed the active GTM docs in place.
  - Why: this run was focused on the official-platform refresh, so the money-action docs needed one fresh local proof timestamp instead of relying on the prior pass.
- Confirmed the live revenue queue is still unchanged:
  - `23` active leads, `21` contacted, `2` targeted, `1` replied, `0` paid.
- Confirmed the local Operator Lab preview still renders `6` posts with all media assets present and `accountCount: 0` on every platform.
- Confirmed `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- Confirmed headless Skool readback still fails with `[skool-reader] fetch failed`.
- Re-verified additional official Skool platform docs that matter for the community/course monetization path:
  - Payments FAQ updated `April 22, 2026`
  - Payout-status guidance updated `May 5, 2026`
  - These reinforce that Skool can support paid surfaces later, but the current Discovery penalty on off-platform payments still makes the free/community-first posture the right public move for now.

## 2026-06-05 Current Run

- Re-ran the live local evidence loop at `2026-06-05T06:49:08Z`:
  - `npm run sales:pipeline -- summary`
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `npm run social:zernio:status`
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown`
  - `gh pr list --state open --limit 5`
- VERIFIED: live revenue queue is still unchanged at `23` active, `21` contacted, `2` targeted, `1` replied, `0` paid.
- VERIFIED: local Operator Lab preview still renders `6` posts and every referenced media asset exists.
- VERIFIED: local preview still reports `accountCount: 0` for every selected platform, so live publish/schedule should remain on the GitHub Actions path with secrets.
- VERIFIED: Zernio analytics are still dark at `0/6` healthy platforms and `0` rows in the last `24h`.
- VERIFIED: headless Skool readback still fails with `[skool-reader] fetch failed`.
- VERIFIED: GitHub API visibility is degraded again in this runtime; `gh pr list` failed with `error connecting to api.github.com`.
- VERIFIED: the last known open-PR snapshot remains `#2503`, `#2464`, `#2463`, `#2461`, and `#2445` from the earlier successful `2026-06-05T04:45:58Z` readback.
- Decision: reordered the active `MONEY_NOW_ACTIONS.md` send queue so the listed order matches the documented highest-ROI action (the four warm Reddit follow-ups first, then the two untouched GitHub Pro leads).
  - Why: the previous queue contradicted the A1 priority and made the approval-ready action pack less trustworthy.
- Tradeoff: updated the docs in place instead of creating another dated handoff file.
  - Why: the existing operator files are already the action surfaces referenced elsewhere in the repo, so another variant would add noise.
