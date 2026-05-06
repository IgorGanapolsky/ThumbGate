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

Known issue (as-of 2026-05-06): Codex in-app browser file picker blocks Skool cover/icon uploads. Workaround is a normal browser upload outside the in-app picker surface.

## 3) Promo Workflow Readiness (approval needed to run publish/schedule)

GitHub Actions workflow:

- `.github/workflows/thumbgate-creator-platform-promo.yml`

Preview is safe (no publish) and should be used before any external action:

- `mode=preview` runs `--dry-run` with the Operator Lab media plan (`--offer=operator-lab`)
- `mode=publish` / `mode=schedule` are external actions and require explicit confirmation

## 4) Course listing copy (no external actions)

Use the updated listing bundle:

- `reports/gtm/2026-05-06-community-course-promo/course-listing-copy-2026-05-06.md`

## 5) Signals readback (local-only)

If local env has no `ZERNIO_API_KEY`, treat this as “best-effort status,” not a blocker:

```bash
npm run social:zernio:status
npm run social:poll
```

