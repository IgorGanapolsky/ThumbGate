# Skool Platform Requirements — 2026-06-14 Refresh

Guardrail: do not publish posts, send messages, invite members, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Official help-center refresh

Re-verified against Skool official help sources on `2026-06-14`, including an evening readback after the local Operator Lab checks.

- Discovery FAQ still says groups need a minimum threshold of members, posts, and activity, plus a group description, About-page description/images, and a cover image. It also still says visibility lands within about `two hours` after the threshold is met.
- The older discovery troubleshooting article still says listing usually happens `within an hour`; treat that as stale/conflicting copy and prefer the newer Discovery FAQ wording of `within two hours`.
- Discovery ranking still rewards member growth, engagement, retention, strong artwork/About quality, authentic human engagement, and active owners/admins.
- Discovery ranking still penalizes bots or fake accounts, spam or low-quality engagement, low-quality artwork/About copy, `payments off-platform`, bad customer support, and inactive owners.
- The discovery troubleshooting article still lists the newer-group setup checklist: cover image, group description, completed About page, at least one post, and invited members.
- Free-community invites are still supported by share link, direct email invite, bulk CSV import, and Zapier.
- Membership questions still cap at `3` total, and only `1` question can use the email-address answer type.
- The About page still acts as the community landing/checkout surface and supports direct image/video upload.
- Classroom is still the core course/resource surface, and course permissions still support `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`.
- New Classroom pages still need `published` toggled on to be visible, and courses remain publishable/draftable from the Classroom UI.
- Native video upload is still supported for Classroom pages plus community posts/comments, so media friction remains an operator-tooling issue, not a Skool platform limitation.
- Analytics definitions are unchanged: About-page conversion is based on joined members divided by unique non-member About-page visits, and most growth/cashflow surfaces refresh every `8 hours`, not instantly.
- Skool pricing options still include free, subscription, freemium, tiered, and one-time payment models, but Discovery guidance still penalizes `payments off-platform`, so public discovery surfaces should stay value-first rather than checkout-first.
- AutoMod is still active platform-wide, and Skool still recommends turning off instant membership approval to reduce spam risk.
- Account security guidance updated on `2026-06-08` still explicitly prohibits sharing creator credentials, login codes, cookies, or other access artifacts with teammates or tools.

## Source dates

- `2026-04-08`: Discovery FAQ
- `2026-06-01`: community invites
- `2025-09-19`: membership questions
- `2025-11-24`: analytics definitions
- `2025-10-28`: group pricing
- `2026-04-02`: spam / AutoMod
- `2026-06-08`: account security

## Operator implications

1. Keep Operator Lab free and value-first until there is evidence that a paid Skool-native packaging beats the current owned checkout path.
2. Do not lead public Skool surfaces with Pro, Diagnostic, or Sprint checkout language because the current Discovery guidance still treats off-platform payments as a ranking penalty.
3. Public-surface quality still depends on About-page completeness, at least one visible post, member activity, and enabled Classroom inventory before more distribution effort is worth prioritizing.
4. Since Skool already supports native media, publish controls, analytics, and invite flows, the main bottlenecks remain operational: authenticated state verification, visible public content depth, and actual engagement.

## ThumbGate-specific posture

- Current best-fit posture remains:
  - free Skool group
  - one free starter course
  - value-first public copy
  - paid conversion only after direct follow-up or explicit workflow pain
- Local public readback on `2026-06-14T19:41:35Z` still shows only `Members: 1` and `Visible posts on page: 0`.
- That public-shell baseline is too thin to justify elevating discovery/promo above warm outbound follow-up.
- Browser-authenticated verification is still required to confirm About-page quality, Classroom inventory, membership-question settings, approval posture, and whether any archive state is enabled.

## Sources

- https://help.skool.com/article/153-discovery-faqs
- https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- https://help.skool.com/article/14-how-do-i-invite-members-to-my-community
- https://help.skool.com/article/57-how-to-set-up-membership-questions
- https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- https://help.skool.com/article/166-what-is-classroom
- https://help.skool.com/article/143-how-to-publish-a-course
- https://help.skool.com/article/23-how-to-set-permissions-for-a-course
- https://help.skool.com/article/216-analytics-definitions
- https://help.skool.com/article/215-how-to-setup-pricing-for-the-group
- https://help.skool.com/article/184-how-to-manage-spam-in-your-skool-community
- https://help.skool.com/article/186-account-security
