# Operator Lab — Daily Checks (No-Posting)

Generated: 2026-05-05

Purpose: keep the Operator Lab growth + revenue loop “ready to execute” without inventing metrics or auto-publishing.

Guardrails:
- Do not publish posts, send messages, invite people, upload assets, submit forms, or change billing in this automation run.
- Do not paste unverified live metrics into GTM docs. Keep raw command output in an operator log.

## 1) Revenue truth (local)

- Hosted config snapshot: `npm run hosted:config`
- Revenue status: `npm run revenue:status`
- Revenue plan: `npm run revenue:plan`

## 2) Social / promo readiness (local)

- Zernio ingestion status (last 24h): `npm run social:zernio:status`
- Poll analytics (GitHub/Plausible/Zernio): `node scripts/social-analytics/poll-all.js`

## 3) Skool discovery readiness (manual UI check, after approval)

- Use `platform-requirements-refresh.md` as the checklist.
- Confirm: Settings → Discovery shows Listed/Unlisted, category, language, and rank.

## 4) Approval pack (what to execute after approval)

- Day 0 MVD: `operator-approval-queue.md`
- Start Here: `skool-start-here-post.md`
- First post: `skool-first-post.md`
- Day 4 routing: `skool-day4-routing-post.md`
