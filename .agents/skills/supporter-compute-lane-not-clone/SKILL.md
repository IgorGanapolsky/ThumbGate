---
name: supporter-compute-lane-not-clone
description: Separate cash sponsors from a capped compute-only supporter balance; never wrap boostmyagents or add SKUs.
---

# Supporter compute lane, not a vendor clone

Use this skill when someone pitches or proposes letting users fund maintainer AI usage, compute credits, or sponsor-backed token budgets on ThumbGate.

## Format to keep

Cash sponsors and a compute-only supporter balance are different lanes.

1. Cash sponsorship sends money to the maintainer.
2. A compute-only supporter balance lets a supporter buy a fixed amount of AI usage for the maintainer, and that balance can only be spent on agent compute.
3. The compute balance has a hard ceiling and cannot be withdrawn as cash.

Keep those two lanes separate in product notes, accounting, and budget checks so compute credits are never counted as withdrawable cash or revenue.

## Vendor boundary

`boostmyagents` at `https://boostmyagents.com` pitches a compute-only supporter balance beside GitHub Sponsors. Keep only the lane separation above. ThumbGate does not wrap `boostmyagents`.

| Never | Always |
| --- | --- |
| Wrap `boostmyagents`, install `bma-cli`, or call its API | Keep supporter compute accounting as a plain internal rule |
| Add a `boostmyagents` badge to any `README.md` | Keep repository docs limited to shipped ThumbGate features |
| Repeat `boostmyagents` fee splits, GitHub identity claims, or prompt-storage claims as ThumbGate facts | State only verified ThumbGate behavior |
| Buy `boostmyagents` credits or spend money outbound | Keep outbound spend at `$0` |
| Create a new price, a new Stripe product, or a new checkout link | Keep existing public ThumbGate plans unchanged |

## Public pricing stays unchanged

No new price, no new Stripe product, no new checkout link. Public prices stay Pro at $19 a month or $149 a year, and the Setup Sprint at $499 at `https://thumbgate.ai/diagnostic`.

## Verification

Run local congruence and budget checks when editing docs or skills near pricing or compute limits:

```bash
node scripts/check-congruence.js
npm run budget:status
```
