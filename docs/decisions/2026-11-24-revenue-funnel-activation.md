# Decision record: the activated-to-checkout drop-off (2026-11-24)

Format: observation → explanation → intervention → result → revised rule.
Owner: revenue ops thread, run as a Ralph loop (Observe → Act → Feedback → Promote → Enforce) with a
pstack-style playbook (investigate first, baseline before change, verify on the real artifact).

## 1. Observation (read-only, 2026-11-24 ~22:20 UTC)

Sources: `GET /v1/admin/money` (Stripe-backed, read in the owner's signed-in browser), Railway HTTP
logs for `thumbgate-production`, public `GET /v1/metrics/real`, npm downloads API.

| Stage (30 days unless noted) | Count | Source |
|---|---|---|
| npm downloads, last 30 days | 3,218 (1,284 last week) | api.npmjs.org |
| Real site visitors | 23,464 | admin money `traffic30d.realVisitors` |
| CLI installs that reported in | 626 unique, 261 active | metrics/real `last30Days`, admin `usage30d` |
| **Activated** (first gate firing, `first_block`) | **112 installs** | admin `usage30d.activatedInstalls` |
| Returning installs | 1 | admin `usage30d.returningInstalls` |
| Stripe checkout sessions | 441 started, 435 unclassified (before the 2026-11-19 bot check), **2 human** | admin `checkouts30d` |
| Paid | **0 customers, $0 MRR, $0 revenue** | admin `payingCustomers`, `mrr`, `revenueLast30Days` |

Last 7 days: 9 sessions, 2 human, 0 completed. Railway logs show both human sessions
(2026-11-20 19:10 UTC and 2026-11-24 15:57 UTC) went straight from `/checkout/pro` to Stripe and never
reached `/success`. The 11-20 browser signed in to `/admin` minutes later, so it was an owner test.

**Biggest drop-off: activated (112) → human checkout (≤2, likely 0 non-owner) → paid (0).**
Install → activation (626 → 112, 18%) is a smaller relative loss than activation → checkout (~100%).

## 2. Explanation (why activated users never reach checkout)

1. **Almost no activated user was ever shown a user-facing upgrade path.** The user-facing
   first-block line (`scripts/first-block-upsell.js`, host `systemMessage`) landed on 2026-11-20.
   `usage30d.byVersion` shows 1 install in 30 days on ≥ 1.40.10; 225 are on versions old enough to
   send no version. The older CTA (`buildBlockActionProCta`) goes to the model, not the person, is
   off for the whole 7-day trial, and is off until the 5th block.
2. **When the line does show, it is hard to act on:** `thumbgate.ai/pricing?...` with no scheme is
   not clickable in most terminals, and `/pricing` is two clicks from Stripe.
3. **The capture limit (the free-tier wall) linked to a raw `buy.stripe.com` payment link**, outside
   attribution and the human-click session flow, and hits were never counted (`cli_limit_hit` did
   not exist).
4. **Measurement was blind at this exact stage.** `/v1/metrics/real` reported
   `firstBlockedToolCall.count = 0` while production had 109 `first_block` events (the KPI only
   matched the legacy name `first_blocked_tool_call`). A stale stored key turned every gate firing
   on the owner's machines into a 401 on `/v1/activation/first-block` (35+ in 5 days) and dropped
   the activation. No event recorded that an upgrade line was shown.

## 3. Intervention (bounded, reversible; one PR)

| Change | Metric it should move | Baseline (2026-11-24) |
|---|---|---|
| Upgrade line links `https://thumbgate.ai/checkout/pro?utm_source=cli&utm_medium=first_block&utm_campaign=first_block_upsell&utm_content=<gate>` | `activationFunnel.firstBlockCheckoutViews` (30d) | 0 measured (no such counter) |
| `first_block_upsell_shown` ping on each showing | `activationFunnel.upsellShownInstalls` | 0 measured |
| CLI capture-limit link via `thumbgate.ai/go/pro`; `cli_limit_hit` ping | `activationFunnel.limitHitInstalls`, `cliCheckoutViews` | 0 measured |
| KPI counts `first_block`, once per install; `first_block` counts as active | `last30Days.firstBlockedToolCall.count` | 0 reported (109 events real) |
| 401/403 on the account route falls back to one anonymous ping, remembers a hash of the rejected key | 401s on `/v1/activation/first-block` per day | ~7/day from owner machines |
| `activationFunnel` block on `/v1/metrics/real` (7d and 30d) | the funnel itself is readable without a key | absent |

Out of scope here (other threads): unit economics and margin views in the admin.

## 4. Result

Completion check for this loop iteration (all must pass, same-turn evidence):

1. Unit tests for the changed modules are green.
2. Production `/health` shows the merged build, and `/v1/metrics/real` shows
   `last30Days.firstBlockedToolCall.count > 0` and an `activationFunnel` object.
3. The upgrade URL returns 200 on production and renders the "Pay $19/mo with Stripe" button.

Business check (follow-up on 2026-12-01 and 2026-12-08): `upsellShownInstalls ≥ 1` and
`firstBlockCheckoutViews ≥ 1` from new installs; the target is the first non-owner paid checkout.
If shown ≥ 10 installs and checkout views stay at 0, the line's copy or placement is the problem; if
shown stays 0 while activated grows, version reach is the problem (see revised rule 3).

Results are appended below as they come in.

**2026-11-25 01:20 UTC: loop 1 completion check passed.**

- #5188 merged as 297d27f and #5190 as 42a69e5. Both are in npm `thumbgate@1.40.14` (published 2026-11-24
  23:12 UTC), so CLIs that install or self-update from now on get the new upgrade line and pings.
- Production `/health` shows build c6c692e, which includes 297d27f. `/dashboard` serves the sign-in page.
  Railway held every deploy from 22:38 UTC until about 01:00 UTC (see the Railway queue stall note), so the server
  part went live about 2.5 hours after the merge.
- `/v1/metrics/real` now shows `last30Days.firstBlockedToolCall.count = 117` (was 0) and 34 in the last 7 days.
- `activationFunnel`, 30 days: 269 CLI installs, 117 activated, 0 shown, 0 limit hits, 1 CLI checkout view,
  0 clicks, 0 paid. The 0 shown is expected: no install runs 1.40.14 yet.
- `/checkout/pro?utm_source=cli&utm_medium=first_block&utm_campaign=first_block_upsell` returns 200 and renders
  "Pay $19/mo with Stripe".
- Still open: `medianMinutes` is null because production CLIs send `first_block` without `minutesSinceInstall`.
  The timing KPI needs that field, which is a small follow-up.

The business check on Dec 1 and Dec 8 stays as written above.

## Loop 2 (same day): get old installs onto the current version

**Observation.** `usage30d.byVersion`: 225 of 261 active installs send no version (builds older than
the version field), 29 run 1.39.x, 1 runs ≥ 1.40.10. **Explanation.** Hook commands run the cached
runtime at `~/.thumbgate/runtime` first (`scripts/published-cli.js` fast path, `install-shim.js`).
Once cached it never updates by default (a deliberate rule: hooks must not mutate a pinned runtime),
and `thumbgate self-update` only ran `npm install -g`, which hooks never use. So every install stays
on the build it first installed, and no hook-side fix (including loop 1) reaches it.
The MCP server is wired as `thumbgate@latest`, so it is the one current component on those machines.

**Intervention.**

| Change | Metric | Baseline |
|---|---|---|
| `self-update` also refreshes `~/.thumbgate/runtime` (only when the person runs it) | share of active installs on the latest minor in `usage30d.byVersion` | 1 of 261 on ≥ 1.40.10 |
| MCP `initialize` detects an older hook runtime and adds one operational sentence to `instructions` naming `npx thumbgate@latest self-update`; nothing is installed | same | same |
| `runtime_version_skew` ping, at most once per 24h per machine | count of skewed machines (new denominator) | not measured |

Auto-upgrading the runtime stays opt-in (`THUMBGATE_SHIM_AUTO_UPDATE=1`); changing that default is
Igor's call, not this loop's.

## 5. Revised rules

1. Every upgrade link the CLI or a hook prints is an absolute `https://` URL through `thumbgate.ai`
   (`/checkout/pro` or `/go/pro`), never a raw payment link and never scheme-less text.
2. Any stage of the funnel that has a prompt must emit a "shown" event, so conversion has a denominator.
3. A conversion change only reaches people who upgrade. Check `usage30d.byVersion` before judging a
   CLI-side change; next loop iteration: get existing installs onto current versions (hook runtime
   self-update notice), since 225 of 261 active installs run old builds.
4. Before quoting an activation number, check the event name the shipped CLI actually sends.

## Loop 3 (2026-11-25): why installs still do not update

**Observation.** 15 hours after 1.40.14 was published, `activationFunnel.upsellShownInstalls` was 0 (30d and 7d)
while 34 installs activated in 7 days. A clean `npx thumbgate@1.40.14 init` in an empty home wrote every Claude
hook as `... npm exec --prefix ~/.thumbgate/runtime --package thumbgate@1.40.14 ...`, not the shim, and
`npm exec --prefix` does not fill `~/.thumbgate/runtime` (checked: the folder stays empty). `npx --package
thumbgate@latest` does re-resolve the dist-tag (checked: with 1.40.13 cached it ran 1.40.14).

**Explanation.** `CLAUDE_HOOKS` in `scripts/auto-wire-hooks.js` was built when the module loaded, before
`wireClaudeHooks` installed the shim. On a first install the shim did not exist yet, so hooks were pinned to the
init version forever. Loop 2's skew check read only the runtime folder, which pinned installs never have, so it
never fired for them. Also, `usage30d.byVersion` "unknown" (234 of 269) is mostly a measurement gap: `first_block`
pings carried no version or platform (118 platform "unknown" = 118 `first_block` events), and CLI versions were
only stored from 2026-11-24 17:36 UTC. It does not mean those installs are old.

**Intervention.**

| Change | Metric | Baseline (2026-11-25 14:35 UTC) |
|---|---|---|
| Hook table built at wire time, so first installs get the `@latest` shim | `byVersion` share on ≥ 1.40.15 among installs active in 7 days | 0 of 37 |
| Skew check also reads `thumbgate@x.y.z` pins from `~/.claude/settings*.json`; ping carries `source: pinned-hooks` | `runtime_version_skew` events | 0 |
| `self-update` refreshes the hook runtime first (creates it for pinned hooks) | same | same |
| `first_block` ping carries `pkgVersion`, `platform`, `minutesSinceInstall`; owner console counts `first_block` as first value | `usage30d.firstValueInstalls`, `timeToFirstValue.medianMinutes` | 0, null |
| Ship `recent-commands.js`, `lesson-effect.js`, `pilot-request.js` (required, missing from `files`) | package-boundary test | red on main |

Business check stays Dec 1: `upsellShownInstalls ≥ 1` from installs on ≥ 1.40.15.
