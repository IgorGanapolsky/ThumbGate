# Next Actions (2026-05-06)

Outcome target: generate `>=1` qualified Diagnostic/Sprint conversation today.

## Awaiting action-time confirmation (external actions)

- Send 4 warm Reddit Sprint DMs (from `reports/gtm/2026-05-04-money-now/operator-send-now.md`).
- Upload Skool cover/icon + About media (from `docs/marketing/assets/*`) to unblock Discovery eligibility.
- (Optional) Run GitHub Actions with `mode=preview` to generate an approval artifact (safe; still uses GitHub).
- Never run `mode=publish` / `mode=schedule` unless you intend to publish/schedule (requires `confirm=PUBLISH`).

## Action-time confirmation checklist (read before doing anything external)

- Confirm you are about to do an external action (DM/post/upload/workflow publish/schedule), not a local preview.
- Use the exact copy + tracking commands from the linked report files (no improvising links).
- After each external action, immediately run the matching `npm run sales:pipeline -- advance ...` command.

## 1) Highest-ROI (approval needed)

Send the 4 warm Reddit Sprint DMs:

- Source: `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- After each send: run the row’s `Log after send` command (ledger truth > vibes).

## 2) Skool Discovery unblock (approval needed)

Upload cover + icon in a normal browser (Codex in-app picker is blocked):

- Packet: `reports/gtm/2026-05-06-community-course-promo/next-actions-2026-05-06.md`
- Assets: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png` + `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- About page media (Discovery eligibility requires About page completion):
  - `docs/marketing/assets/thumbgate-operator-lab-about-hero.png`
  - `docs/marketing/assets/thumbgate-operator-lab-explainer.mp4`
- Official requirements refresher:
  - `reports/gtm/2026-05-06-community-course-promo/skool-discovery-requirements-2026-05-06.md`

## 3) Promo preview (safe; no external publish)

Run GitHub Actions preview to generate an approval-ready `promo-preview.json` artifact:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Inputs: `mode=preview`, `offer=operator-lab`, `platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

UI steps (GitHub web):

1. Repo → Actions → `ThumbGate Creator Platform Promo`
2. `Run workflow` → `mode=preview`
3. Download artifact `thumbgate-creator-platform-promo-preview`

Optional local-only preview (safe; no publish):

- Output: `reports/gtm/2026-05-06-community-course-promo/promo-preview-operator-lab-2026-05-06.json`

Paid offer variant preview (safe; no publish):

- Output: `reports/gtm/2026-05-06-money-today/promo-preview-paid-sprint-2026-05-06.json`
- Note: If we want a GitHub Actions artifact for the paid lane, re-run the same workflow with `offer=paid-sprint` and `mode=preview` (still no publish).
