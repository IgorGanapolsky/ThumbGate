# Operator Loop Brief — 2026-06-16T00:58:10Z

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Repo-side truth

- `npm run sales:pipeline -- summary` at `2026-06-16T00:58:09Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`; the script still overstates the top-level `contacted` field as `24`.
- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --json` at `2026-06-16T00:58:10Z` still shows `totalMembers: 1`, `totalPosts: 0`, one `General discussion` label, the live group description, and no visible posts.
- `npm run social:zernio:status` at `2026-06-16T00:58:09Z` still shows `0/6` healthy platforms, `0` rows in the last `24h`, and exits non-zero with the same likely-cause guidance.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` at `2026-06-16T00:58:09Z` still renders `6` previews, `0` errors, committed media under `public/assets/brand/*`, and `accountCount: 0` on every platform.

## Public/official truth

- Public Skool page re-check on `2026-06-15` still shows a thin shell: tabs are visible, `JOIN GROUP` is present, the group description is live, but there is still no visible post depth and no sign of member activity beyond `1` member.
- Official Skool help re-check on `2026-06-15` still shows no material requirement delta. Discovery still depends on complete artwork/About, at least one visible post, invited members, and real activity.
- Discovery timing guidance is still internally inconsistent across Skool help pages: the newer FAQ published about `2 months ago` says visibility lands within about `two hours`, while the older troubleshooting article published about `2 months ago` still says `within an hour`. Operator docs should keep preferring the newer FAQ wording.
- Classroom guidance remains current in official help search results with the article published `2 weeks ago`, and Skool still supports native files/video inside Classroom.

## Current decision

- A1 remains the only approval-ready money action: the warm Reddit follow-up four-pack.
- A2 creator-platform dispatch remains secondary until connected accounts or analytics recover, or the public Skool surface gains real content depth.
- A3 authenticated Skool verification remains the top non-send action because the public shell still cannot verify About-page quality, Classroom inventory, membership questions, approval posture, or archive state.

## If approval is granted now

- Approval string: `Approve A1 warm Reddit follow-up batch`
- Use follow-up drafts from `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md` and `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- If Skool inspection is approved instead, verify About completeness, Classroom starter lesson visibility, membership-question settings, and whether any archive state is enabled before spending more effort on discovery/promo.
