# Next Actions (2026-05-06)

Guardrail: do not publish posts, send messages, invite members, create accounts, change billing, upload files to third-party services, submit forms, or run paid ads without explicit action-time confirmation.

Goals for 2026-05-06:

- Generate `>=1` Workflow Hardening Diagnostic / Sprint conversation.
- Unblock Skool Discovery eligibility (cover/icon + About + pinned “Start Here” post).
- Prepare media-backed Operator Lab promo posts for approval-ready publish/schedule.

## 1) Highest-ROI Money Action (approval needed)

Send the 4 warm Reddit Workflow Hardening Sprint DMs (copy + tracking commands live in `reports/gtm/2026-05-04-money-now/operator-send-now.md`).

Rule: after each send, run that row's `Log after send` command (sales ledger truth > vibes).

## 2) Skool Discovery Unblocker (approval needed)

Objective: satisfy Skool’s “unlisted” checklist (cover image, group description, completed About page, at least one post, invite members).

- Paste-ready About + pinned post copy:
  - `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`
- Artwork (local files for direct upload):
  - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Official requirements refresher:
  - `reports/gtm/2026-05-06-community-course-promo/skool-discovery-requirements-2026-05-06.md`

Known issue (as-of 2026-05-06): Codex in-app browser file picker blocks Skool cover/icon uploads. Workaround is a normal browser upload outside the in-app picker surface.

Approval-ready upload steps (no new copy required):

1. Open: https://www.skool.com/thumbgate-operator-lab-6000
2. Admin → Group settings → Branding (cover + icon)
3. Upload cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
4. Upload icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
5. About page → paste copy: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md` (if it ever got lost)
6. About page → upload at least one image/video (Discovery eligibility requires About page completion):
   - Hero image: `docs/marketing/assets/thumbgate-operator-lab-about-hero.png`
   - Explainer (landscape): `docs/marketing/assets/thumbgate-operator-lab-explainer.mp4`
   - Explainer (vertical): `docs/marketing/assets/thumbgate-operator-lab-explainer-vertical.mp4`

## 3) Promo Workflow Readiness (approval needed to run publish/schedule)

GitHub Actions workflow:

- `.github/workflows/thumbgate-creator-platform-promo.yml`

Preview is safe (no publish) and should be used before any external action:

- `mode=preview` runs `--dry-run` with the Operator Lab media plan (`--offer=operator-lab`)
- The workflow uploads a `thumbgate-creator-platform-promo-preview` artifact containing `promo-preview.json` (captions + media plan) for approval review.
- `mode=publish` / `mode=schedule` are external actions and require explicit confirmation (`confirm=PUBLISH`)

Local-only preview already generated (safe; no publish):

- `reports/gtm/2026-05-06-community-course-promo/promo-preview-operator-lab-2026-05-06.json`

Approval-ready GitHub Actions inputs:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- `mode`: `preview`
- `offer`: `operator-lab`
- `platforms`: `linkedin,instagram,threads,bluesky,reddit,youtube`

Approval-ready UI steps (GitHub web):

1. Repo → Actions → `ThumbGate Creator Platform Promo`
2. `Run workflow`
3. Set `mode=preview` (safe)
4. Confirm `offer=operator-lab` and `platforms=...`
5. Run → download the `thumbgate-creator-platform-promo-preview` artifact and review captions/media before any publish/schedule

## 4) Course listing copy (no external actions)

Use the updated listing bundle:

- `reports/gtm/2026-05-06-community-course-promo/course-listing-copy-2026-05-06.md`

## 5) Signals readback (local-only)

If local env has no `ZERNIO_API_KEY`, treat this as “best-effort status,” not a blocker:

```bash
npm run social:zernio:status
npm run social:poll
```

Local status as-of 2026-05-06: `npm run social:zernio:status` exits non-zero with `NO DATA` when `ZERNIO_API_KEY` is missing (expected in this repo checkout unless explicitly loaded).
