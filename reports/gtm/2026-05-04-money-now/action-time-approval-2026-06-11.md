# Action-Time Approval Card — 2026-06-11

Use this card when requesting confirmation for any revenue or promo action from the current queue.

## Action 1

- Type: outbound follow-up
- Priority: A1
- Goal: convert warm Reddit leads into a Diagnostic (`$499`) or Sprint (`$1500`) conversation
- Queue size: `4`
- Targets:
  - `reddit_deep_ad1959_r_cursor`
  - `reddit_game_of_kton_r_cursor`
  - `reddit_leogodin217_r_claudecode`
  - `reddit_enthu_cutlet_1337_r_claudecode`
- Why now: highest-intent queue still available; no untouched Pro batch outranks it
- Copy source:
  - `reports/gtm/2026-05-04-money-now/operator-send-now.md`
  - `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- Confirmation needed because: sending messages is an external write action

## Action 2

- Type: creator-platform promo dispatch
- Priority: A2
- Goal: publish or schedule the Operator Lab awareness campaign through the GitHub Actions workflow
- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Inputs:
  - `mode=preview|publish|schedule`
  - `offer=operator-lab`
  - `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`
  - `schedule=<ISO-8601>` when `mode=schedule`
  - `timezone=America/New_York`
- Current evidence:
  - local dry-run re-verified in this run and returns `6` previews plus `0` errors
  - asset resolution currently points at missing `docs/marketing/assets/*` files through `public/assets/skool/*` symlinks
  - local runtime still shows `accountCount: 0` on all `6` platform previews
  - Zernio analytics status re-verified at `2026-06-11T14:41:05Z` and is still dark at `0/6` healthy platforms
  - headless Skool readback failed again in this run with `[skool-reader] fetch failed`
- Confirmation needed because: publish/schedule changes third-party state

## Recommended ask

Approve one of these exactly:

1. `Approve A1 warm Reddit follow-up batch`
2. `Approve A2 Operator Lab promo preview`
3. `Approve A2 Operator Lab promo schedule for <timestamp>`
4. `Approve A2 Operator Lab promo publish now`

## Do not approve blindly when

- Zernio account connectivity has not been confirmed and the request is `publish` or `schedule`.
- The request would add paid or checkout-heavy copy to public Skool surfaces.
- The request would require a native file-picker upload in this environment.
