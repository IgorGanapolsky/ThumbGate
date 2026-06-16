# Operator Loop Brief — 2026-06-14T17:40:50Z

Guardrail: do not publish posts, send messages, invite people, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Revenue truth

- `node scripts/sales-pipeline.js summary` at `2026-06-14T17:40:28Z` still shows `24` active leads with actionable `byStage` truth of `22` `contacted`, `2` `replied`, `0` `checkout_started`, `0` `sprint_intake`, and `0` `paid`.
- Fastest money path is still the same warm four-pack already staged in `reports/gtm/2026-05-04-money-now/operator-send-now.md`:
  - `reddit_deep_ad1959_r_cursor`
  - `reddit_game_of_kton_r_cursor`
  - `reddit_leogodin217_r_claudecode`
  - `reddit_enthu_cutlet_1337_r_claudecode`
- There is still no untouched self-serve batch that outranks those follow-ups.

## Community and promo truth

- `node scripts/skool-reader.js --community thumbgate-operator-lab-6000 --limit 5 --format markdown` at `2026-06-14T17:40:28Z` still returns only `Members: 1` and `Visible posts on page: 0`.
- Public web verification on `2026-06-14` still shows the Skool shell as visible but thin: `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, `About`, `1 Member`, `JOIN GROUP`, and `This is the start of something special`.
- `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` at `2026-06-14T17:40:28Z` still returns `6` previews, `0` errors, `0` published, and `0` scheduled.
- Every preview still shows `accountCount: 0`, so local runtime remains preview-only even though fallback media now resolves under committed `public/assets/brand/*`.
- `npm run social:zernio:status` at `2026-06-14T17:40:28Z` still reports `0/6` healthy platforms and `0` rows in the last `24h`.
- Local secret readback at `2026-06-14T17:40:28Z` still found no `ZERNIO_API_KEY` in env and no `ZERNIO_API_KEY=` line in local `.env` or `.env.example`.

## Official Skool requirement refresh

Refreshed from official help sources on `2026-06-14`:

- Discovery FAQ still says visibility lands within about `two hours` after the threshold is met.
- Discovery still requires the cover image, group description, About page, at least one post, and invited members before review for newer groups.
- Discovery ranking still rewards member growth, engagement, retention, authentic human engagement, active admins, and strong artwork/About copy.
- Discovery still penalizes bots, spam, low-quality artwork/About copy, `payments off-platform`, bad support, and inactive owners.
- Invite options still include share link, direct email invite, bulk CSV import, and Zapier-based invites.
- Membership questions still cap at `3` total, with only `1` email-type field.
- About page is still the landing/checkout surface inside Skool and still required for Discovery.
- Classroom still has to be enabled at the group-tab level before a starter course is truly visible.

## Decision

- Do not promote Skool discovery or creator-platform dispatch above warm outbound.
- A1 remains the only approval-ready money action.
- A2 and A3 are still secondary because the public group is too thin and local analytics remain dark.

## Approval-ready actions

### A1. Warm Reddit follow-up batch

Exact action-time approval string:

- `Approve A1 warm Reddit follow-up batch`

Use the follow-up drafts and logging commands already staged in:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- `reports/gtm/2026-05-04-money-now/MONEY_NOW_ACTIONS.md`

### A2. Operator Lab creator-platform promo dispatch

Only if explicit action-time approval is granted for social publishing:

- Workflow: `.github/workflows/thumbgate-creator-platform-promo.yml`
- Mode: `preview` first, then `schedule` or `publish`
- Offer: `operator-lab`
- Platforms: `linkedin,instagram,threads,bluesky,reddit,youtube`

### A3. Logged-in Skool verification

Only if explicit action-time approval is granted to inspect the authenticated Skool session:

1. Verify About page copy is still value-first and complete.
2. Verify Classroom actually contains the intended free starter lesson/media.
3. Verify membership question count and approval posture.
4. Verify whether any archived state is enabled in settings.

## Sources

- [Discovery FAQs](https://help.skool.com/article/153-discovery-faqs)
- [Why isn't my group visible on Discovery?](https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery)
- [How do I invite members to my community?](https://help.skool.com/article/14-how-do-i-invite-members-to-my-community)
- [How to set up Membership Questions?](https://help.skool.com/article/57-how-to-set-up-membership-questions)
- [How to set up my group’s About page?](https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page)
- [What is Classroom?](https://help.skool.com/article/166-what-is-classroom)
- [ThumbGate Operator Lab](https://www.skool.com/thumbgate-operator-lab-6000)
