# Ralph Loop Community Course Growth — 2026-06-05

## Decisions

- Keep the highest-ROI next action on the warm Reddit four-pack instead of new Skool setup work.
  - Why: the live queue still shows `23` active leads with `21` already contacted and `2` untouched Pro leads, while Skool readback remains blocked in the headless runtime.
- Refresh the Skool/community action packet with current timestamps rather than inventing new channel actions.
  - Why: the official Skool help posture is still compatible with the existing free/value-first setup, so the value is in clearer approval-ready execution, not a new strategy pivot.
- Add a fresh text-first post pack dated for this run.
  - Why: local file picker/upload constraints remain unresolved, so posts that do not require new media are the safest ready-to-publish fallback once approved.
- Refresh the money-room truth docs with this run's actual CLI evidence.
  - Why: GitHub visibility changed again during the day, and stale operator timestamps make the next approval decision weaker.
- Create a new dated action-time approval card instead of silently reusing the June 1 card.
  - Why: the old card still referenced `3` Pro guide-first messages, but the live queue now has `2`, so keeping the old card would make the approval surface internally inconsistent.

## Assumptions

- VERIFIED: local `--offer=operator-lab` preview still renders six previews with valid local media paths.
- VERIFIED: local publish remains blocked by missing `ZERNIO_API_KEY` in this shell and by zero connected preview accounts.
- VERIFIED: headless Skool readback still fails in this runtime with `[skool-reader] fetch failed`.
- VERIFIED: GitHub visibility is inconsistent in this shell; `gh pr list` works while `gh run list` is now rate-limited again, and `npm run pr:manage` plus direct `gh pr view` calls still fail against `api.github.com`.
- VERIFIED: the latest local sales-pipeline report still shows `23` active leads with `2` targeted, `20` stage-count `contacted`, `1` `replied`, and `21` aggregate contacted leads.
- UNVERIFIED: the public Skool page currently displays the saved About/covers/pinned content exactly as intended, because authenticated browser readback was not available in this run.

## Things Corrected

- Corrected the earlier assumption that GitHub read visibility was stably improving. It briefly returned `main` workflow rows earlier, but by `2026-06-05T18:03:36Z` the same `gh run list --branch main --limit 5` call was rate-limited again.
- Corrected the action-time approval surface drift. The June 1 approval card still advertised `3` untouched Pro messages, but the live queue and current operator docs only support `2`.

## Tradeoffs

- Chose docs/runbook updates over broader pipeline rewrites.
  - Rejected alternative: modify sales pipeline source data.
  - Reason: the user asked for continuous growth/revenue operation with approval-ready actions, and the highest signal gap was the current action packet, not the underlying broader campaign pool.
- Chose to add the membership-question pack to the Skool readback docs rather than creating a separate standalone file.
  - Rejected alternative: another dedicated Skool setup doc.
  - Reason: the current bottleneck is action-time execution clarity, so the join-question guidance is more useful inline with the live readback.
- Chose not to attempt live publish/schedule actions.
  - Rejected alternative: forcing GitHub workflow dispatch or third-party posting.
  - Reason: explicit instruction requires action-time confirmation before any live publishing or outbound messaging.

## Async Review Notes

- The main new artifact to use next is the June 5 Skool/community action brief plus the refreshed post pack.
- If a future run gets authenticated browser access, the next verification step is to confirm the public About page, artwork, pinned post, and starter course visibility on Skool itself.
- The next approval-ready money action is still unchanged: send A1 only, the four warm Reddit follow-ups, then log each send with the row-specific pipeline command.

## 2026-06-05T20:06:59Z Addendum

- Re-verified the same-day shell state before touching the docs again:
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still renders `6` previews with repo-backed media and `accountCount: 0` across the board.
  - `npm run social:zernio:status` still exits non-zero with `0/6` healthy platforms and `0` rows in the last `24h`.
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` still fails with `[skool-reader] fetch failed`.
  - `npm run sales:pipeline -- summary` still reports `23` total active leads with `2` targeted, `20` stage-count contacted, and `1` replied.
  - `gh pr list --state open --limit 10` still works, but `gh run list --branch main --limit 5` is rate-limited with `HTTP 403` and `npm run pr:manage` still fails on `api.github.com`.
- Corrected one more doc drift in this pass:
  - `MONEY_NOW_ACTIONS.md` was still pointing at `action-time-approval-2026-06-03.md`; it now points at the current June 5 approval card that matches the live `A1` and `A2` queue.

## 2026-06-05T21:07:55Z Addendum

- Refreshed the official Skool help facts from source instead of relying on older search snippets:
  - Discovery FAQ still says off-platform payments are a ranking penalty and is still updated `April 8, 2026`.
  - Discovery checklist still requires cover image, group description, About page, one post, and invited members, updated `April 15, 2026`.
  - Classroom basics are still updated `May 29, 2026`.
  - Course permissions still allow `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`, updated `November 10, 2025`.
  - Membership questions still cap at `3` total with only `1` email field, updated `September 19, 2025`.
  - Video uploads still support native hosting plus auto English captions, updated `February 12, 2026`.
  - Analytics definitions still say About-page conversion refreshes every `8` hours, updated `November 24, 2025`.
  - Payments FAQ is still updated `April 22, 2026`; payout-status guidance is still updated `May 5, 2026`.
- VERIFIED: `npm run social:zernio:status` still exits with `0/6` healthy platforms and `0` rows in the last `24h` at `2026-06-05T21:07:55Z`.
- Tradeoff kept: update the operator packet with exact platform constraints instead of broadening the queue. The same six approval-ready leads remain the only near-term path with revenue signal.

## 2026-06-05T22:07:35Z Addendum

- Re-ran the core revenue-loop checks from the dirty lane to confirm nothing material changed before finalizing the packet:
  - `npm run sales:pipeline -- summary` still reports `23` active leads with `2` targeted, `20` stage-count contacted, `1` replied, `21` aggregate contacted, and `0` paid.
  - `npm run social:zernio:status` still exits non-zero with `0/6` healthy platforms and `0` rows in the last `24h`.
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still renders `6` previews with repo-backed media and `accountCount: 0` throughout.
  - `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` still fails with `[skool-reader] fetch failed`.
  - the latest combined GitHub probe now fails entirely with `error connecting to api.github.com`, so the last trustworthy shell snapshot for PR visibility remains the earlier partial read from `2026-06-05T20:06:59Z`.
- Corrected one evidence nuance from the official source refresh:
  - the Skool Payments FAQ is currently updated `April 22, 2026`; older snippets showing `February 1, 2026` are stale search-crawl metadata and should not drive the docs.
- VERIFIED: the next approval-ready money action did not change after re-checking the live state; `A1` remains the four warm Reddit follow-ups, then `A2` remains the two untouched Pro leads.
