# Action-Time Approval — 2026-06-01

Guardrail (non-negotiable): do not publish posts, send messages, invite members, upload files, create paid accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

This card exists to produce a single yes/no approval for any outbound action. Preview-only actions (dry-run renders, local copy drafting) are always allowed.

## Truth anchors (do not improvise)

- Offers + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Close scripts + routing: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`
- Send queue + logging commands: `reports/gtm/2026-05-04-money-now/operator-send-now.md`

## Decision A — Send warm DMs (outbound write)

Goal: convert 4 warm Reddit leads into a 15-minute diagnostic and route to Sprint (`$1500`) or Diagnostic (`$499`).

- Targets: the 4 warm Sprint DMs in `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`
- Logging: run each lead’s `Log after send` command from `reports/gtm/2026-05-04-money-now/operator-send-now.md` immediately after sending.

Approval: ☐ YES (send now) ☐ NO (defer)

## Decision B — Run local preview (no outbound writes)

Goal: verify the Operator Lab promo renders, including media plan, before any publish.

- Command:
  - `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Approval: ☐ YES (run preview) ☐ NO (defer)

## Decision C — Trigger GitHub Actions preview (no outbound writes)

Goal: generate the same dry-run output in CI for auditability and shareable logs.

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Inputs:
  - `mode=preview`
  - `offer=operator-lab`
  - `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Approval: ☐ YES (run preview workflow) ☐ NO (defer)

## Decision D — Trigger publish/schedule (outbound writes)

Goal: publish/schedule media-backed posts via the CI workflow (requires Zernio secrets).

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Inputs:
  - `mode=publish` OR `mode=schedule` (+ `schedule` ISO-8601 + `timezone`)
  - `offer=operator-lab`
  - `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Approval: ☐ YES (publish/schedule) ☐ NO (defer)

## Decision E — Update Skool conversion surfaces (outbound writes)

Goal: improve Skool group conversion by aligning cover/icon/About and pinning a “Start Here” router post.

- Skool group: https://www.skool.com/thumbgate-operator-lab-6000
- Assets (this checkout):
  - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Copy:
  - About/listing copy: `reports/gtm/2026-05-04-community-course-promo/skool-course-listing-copy-2026-06-01.md`
  - Pinned router links:
    - Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
    - Pro: `https://thumbgate-production.up.railway.app/checkout/pro`
    - Proof: `docs/VERIFICATION_EVIDENCE.md`

Approval: ☐ YES (update Skool + pin) ☐ NO (defer)

## Notes (constraints observed)

- Local Skool media upload remains blocked by the browser/native file picker; treat Skool media updates as action-time tasks.
- In this checkout, the confirmed Operator Lab assets under `docs/marketing/assets/` are:
  - `thumbgate-skool-cover-1084x576.png`
  - `thumbgate-skool-icon-128x128.png`
  - `thumbgate-operator-lab-about-hero.png`
  - `thumbgate-operator-lab-social-landscape.png`
  - `thumbgate-operator-lab-social-square.png`
  - `thumbgate-operator-lab-social-story.png`
