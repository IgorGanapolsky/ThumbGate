# Team features: what the code has, what the README and site say (25 Nov 2026)

Base commit: origin/main at the time of this audit (searched with `git grep`).

## What the code has

| Item | Path | What it is |
|---|---|---|
| Team price | `scripts/commercial-offer.js:16-20` | `TEAM_MONTHLY_PRICE_ID` and `TEAM_MONTHLY_PRICE_DOLLARS = 49` |
| Team checkout summary | `src/api/server.js` (`resolveCheckoutOfferSummary`, `planId === 'team'`) | prices `$49 x seats` per month |
| Team Stripe session | `scripts/billing.js` (lines near 511, 538, 557, 1794) | creates a "ThumbGate Team" subscription when `planId` is `team` |
| Team tier names | `scripts/entitlement.js:42-47` (`TIER_FEATURES.team`) | lists `hosted-dashboard`, `hosted-sync`, `learned-models`, `org-visibility` |

## What the code does not have

A search of `scripts`, `src`, `adapters` and `bin` found no call to `requireEntitlement` or `requirePaidFeature` for `hosted-sync`, `org-visibility` or `hosted-dashboard`. Those three names exist in the tier table, but nothing checks them.

`learned-models` is different: it is checked. `requireLearnedModelsEntitlement()` in `scripts/entitlement.js` calls `requirePaidFeature('learned-models')`, and `scripts/thompson-sampling.js`, `scripts/risk-scorer.js`, `scripts/agent-reward-model.js`, `scripts/bayes-optimal-gate.js` and `scripts/intervention-policy.js` call it. With `THUMBGATE_ENFORCE_ENTITLEMENTS=1` those paths reject a user without the entitlement. Pro has `learned-models` too, so it is a paid feature, not a team-only one.

The only team-only name is `org-visibility`, and it is unchecked. Shared team rules, lessons synced across machines and an org dashboard are not implemented as features.

## What the README and site say

- `README.md` pricing section: "There is no self-serve team checkout", team path is a 30-day pilot request, "Hosted team lesson sync" and "Hosted org dashboard" are marked "Not general availability".
- `public/index.html`: "Not shipped yet: team-shared rules, lessons synced across machines, audit history."
- Neither names a $49 team plan.

## Result

README and site already match the code: they do not promise team features or a $49 team plan. No copy change is needed. The `$49` team checkout is reachable only through the API path above, not from any public page.

## Open question for Igor (not changed here)

Keep or remove the hidden team checkout and the `team` tier names, since they price a plan whose only team-only feature (`org-visibility`) is not implemented.
