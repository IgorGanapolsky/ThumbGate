# ThumbGate Community + Course Promo Operator Handoff

Generated: 2026-05-04
Updated: 2026-06-06T12:10:30Z

## Live Assets

- Skool group: `https://www.skool.com/thumbgate-operator-lab-6000`
- Production landing page: `https://thumbgate-production.up.railway.app/`
- Marketing site: `https://thumbgate.ai/`
- Workflow sprint intake: linked from the production landing page
- Skool artwork (local files):
  - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`

## Skool Status

The group exists and the Hobby trial path is active. During setup, Skool showed the first owner charge as May 18, 2026 for `$9`.

Completed in Skool:

- Public group visibility selected.
- Discovery keywords filled.
- Sidebar description filled.
- Audience size answered as `Under 10k`.
- About page description drafted in the editor.

Current blockers:

- The public-save state for the About page is still not re-verified in this runtime.
- Cover/icon uploads remain blocked by the in-app browser file-picker surface, but local assets are ready.
- The first post and invite steps still require action-time confirmation before publication/sending.
- A headless read of the public Skool URL failed again in this environment in this run, so the live public page content still needs browser-side verification before claiming the surface is fully updated.
- Direct unauthenticated `curl -I -L https://www.skool.com/thumbgate-operator-lab-6000` previously returned HTTP `403` from CloudFront, so a headless anonymous verification path is not currently reliable from this runtime.
- Skool’s current Discovery FAQ lists `off-platform payments` as a ranking penalty, so external paid links on public Skool surfaces should be treated as a deliberate tradeoff instead of a default conversion step.
- GitHub visibility is only partially healthy in this runtime: `gh pr list --state open --limit 10` and `gh run list --branch main --limit 5` both succeed again in this run, but `npm run pr:manage` still fails with `error connecting to api.github.com`.
- Skool Growth-tab metrics have not been read back in a browser-authenticated session yet, so About-page conversion and traffic-source truth are still unknown.
- Zernio analytics are still dark in this runtime on 2026-06-06 (`0/6` healthy platforms, `0` rows in the last `24h`; generated `2026-06-06T12:10:30.128Z`).
- The latest local sales-pipeline summary at `2026-06-06T12:10:30Z` still shows `24` active leads, `22` stage-count contacted, `2` replied, `24` aggregate contacted, `0` paid, and `bookedRevenueCents: 0`, so warm outbound follow-up remains the fastest revenue path.
- Current local GitHub readback is partially reliable again in this shell; direct `gh` list/run reads work, but `npm run pr:manage` remains the flaky path.

Workaround for the in-app file picker:

- If Skool requires file uploads for cover/icon (likely), do the upload in a normal browser outside the in-app file picker surface.
- If you need URL-based embeds in the About editor, host the files first (do not assume the marketing site currently serves these paths).

## Recommended Setup

- Group name: ThumbGate Operator Lab
- Group URL: `skool.com/thumbgate-operator-lab-6000`
- Member pricing: free
- Description: Stop your AI coding agent from repeating the same mistake twice. Bring one repeated Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP workflow failure. We will turn it into a prevention rule, pre-action gate, or workflow-hardening teardown.
- Starter categories: Start Here, Repeated Mistakes, Pre-Action Gates, Workflow Teardowns, Claude Code, Codex, Cursor, MCP Servers, Sprint Intakes, Wins.
- Category constraints: up to `10` categories, with names up to `30` characters.
- Pinned-post constraints: admins can pin up to `3` feed posts; a post can also be pinned to a Classroom page.
- Public external links: Pro-only, up to `3` links on the group card.
- Membership questions: up to `3` total, and only `1` can use the email answer type.
- Rules surface: current Skool help recommends linking simple rules from the pinned post or first lesson.

## First Post

Welcome to ThumbGate Operator Lab.

Post one repeated AI-agent mistake using this format:

1. Agent/tool:
2. Repo/workflow:
3. What it keeps doing:
4. What should happen instead:
5. Current prevention attempt, if any:

The best first win is narrow: one mistake, one rule, one blocked repeat.

## Research Notes

Skool official sources (re-verified 2026-06-06):

- Skool Payments FAQs: current transaction fees, non-refundable processing fees, current `$100,000` per-charge limit, and payout behavior for paid memberships inside Skool.
  - https://help.skool.com/article/86-subscriptions-faq
- Payout status: payouts are initiated weekly on Wednesdays, with first payout availability taking roughly `8` to `14` days.
  - https://help.skool.com/article/85-how-to-check-the-skool-subscriptions-payout
- Owner billing: plans are recurring subscriptions after a 14-day free trial.
  - https://help.skool.com/article/227-payment-terms-and-policy
- Category limit: up to 10 categories per group.
  - https://help.skool.com/article/67-how-to-setup-categories
- Cover + icon setup path: Settings > General (opens the native file manager).
  - https://help.skool.com/article/120-how-to-set-up-my-group-logo-and-cover-photo
- Membership questions live under Plugins and still allow up to `3` questions with only `1` email-type field.
  - https://help.skool.com/article/57-how-to-set-up-membership-questions
- Pricing models supported: free, subscription, freemium, tiered pricing, and one-time payment.
  - https://help.skool.com/article/215-how-to-setup-pricing-for-the-group
- About page: must be completed for Discovery eligibility and supports uploading images/videos in the editor.
  - https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- About page role: Skool explicitly frames the About page as a landing/checkout surface, which makes value-first copy and strong visual proof more important than extra product detail.
  - https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- Classroom basics: courses are created in Classroom and pages can be published as lessons.
  - https://help.skool.com/article/166-what-is-classroom
- Course publishing: a new course needs a name, description, cover photo, and access setting; individual pages only become visible after they are toggled to `published` and saved.
  - https://help.skool.com/article/143-how-to-publish-a-course
- Course access modes: Open, Level unlock, Buy now, Time unlock, and Private.
  - https://help.skool.com/article/23-how-to-set-permissions-for-a-course
- Points/levels remain group-local and still use the documented ladder of `0`, `5`, `20`, `65`, `155`, `515`, `2,015`, `8,015`, and `33,015` points for levels `1` through `9`.
  - https://help.skool.com/article/183-how-do-points-and-level-work
- Native video in courses/posts: direct upload is supported, English captions auto-generate for videos with sound, and each course can have up to `200` pages.
  - https://help.skool.com/article/58-video-link-tips
- Traffic-source attribution:
  - direct About/community links preserve source attribution better than redirects or link shorteners
  - redirects, link-in-bio tools, and URL shorteners collapse into `Direct`, so promo posts should keep the raw Skool URL with UTMs
  - https://help.skool.com/article/226-traffic-sources
- Course-page extras: pages can add transcripts, resource files, resource links, and pinned community posts, so the first free course can double as both onboarding and proof surface.
  - https://help.skool.com/article/166-what-is-classroom
- Public group-card links: available on the Pro plan, with up to `3` links.
  - https://help.skool.com/article/76-how-to-add-links
- Pinned posts: up to `3` feed pins; posts can also be pinned to a course page.
  - https://help.skool.com/article/38-how-do-to-pin-a-post
- Group rules: can be linked from pinned posts or the first lesson.
  - https://help.skool.com/article/189-how-to-setup-group-rules
- AutoDM exists, sends within `1` to `5` minutes for new members when enabled, but should stay off until the first join flow is proven and approved.
  - https://help.skool.com/article/64-how-to-set-up-autodm
- Membership questions: maximum `3`, with only one email-type question allowed.
  - https://help.skool.com/article/57-how-to-set-up-membership-questions
- Membership Questions plugin guidance now explicitly suggests using the slots for fit, contact capture, and source attribution, which matches the current three-question pack.
  - https://help.skool.com/article/176-how-to-use-plugins
- Discovery eligibility + ranking:
  - Discovery FAQ now explicitly notes "Updates coming to the Discovery algorithm in Q2 of 2026."
  - Eligibility needs: minimum threshold of members, posts, and activity plus group description, About page description/images, and cover image. (Threshold values are not published.)
  - Visibility timing: Skool currently says "usually within an hour" on the unlisted-checklist page and "within two hours" on the FAQ page, so treat same-day visibility as likely but not instant.
  - Ranking boosts: high-quality artwork/about page, authentic engagement, active owner/admin behavior.
  - Ranking penalties: bots/fake accounts, spam or low-quality engagement, low-quality artwork/about page, off-platform payments, bad customer support, inactive owner.
  - Latest official help updates observed in this run: Discovery FAQ updated `April 8, 2026`; unlisted/discovery checklist updated `April 15, 2026`; Classroom updated `May 29, 2026`; video guidance updated `February 12, 2026`; Payments FAQ updated `April 22, 2026`; payout-status guidance updated `May 5, 2026`; About page setup updated `December 9, 2025`; Analytics definitions updated `November 24, 2025`.
  - https://help.skool.com/article/153-discovery-faqs
  - https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- Discovery “unlisted” checklist (new groups):
  - Cover image, group description, completed About page, at least one post, invite members.
  - https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- Analytics refresh cadence:
  - Members/MRR/Free trials are real-time.
  - Conversion Rate and About Page Views And Conversion refresh every `8` hours.
  - https://help.skool.com/article/216-analytics-definitions
- Pinning limits:
  - up to `3` feed pins per community and up to `12` posts pinned per Classroom page.
  - https://help.skool.com/article/38-how-do-to-pin-a-post
- Payments / payouts:
  - Paid groups use a Stripe Express connection owned by Skool.
  - Current fees are `2.9% + 30c` up to `$899` and `3.9% + 30c` above `$900` on Pro, or `10% + 30c` on Hobby.
  - https://help.skool.com/article/86-subscriptions-faq

## Zernio Status

GitHub Actions can authenticate to Zernio through repository secrets and found 7 connected accounts: Bluesky, Instagram, LinkedIn, Reddit, Threads, Twitter/X, and YouTube.

Zernio analytics polling is blocked by the Analytics add-on paywall. Treat Zernio as the publishing pipe and use UTM/Plausible/PostHog plus native dashboards for readback.

## Automation Update

The `thumbgate-creator-platform-promo.yml` workflow now passes `--offer=operator-lab`, so previews/schedules/publishes from that workflow promote the free Skool Operator Lab instead of the older first-customer launch copy.

As of 2026-06-06T12:10:30Z, local dry-runs still preview the Operator Lab campaign without Zernio credentials and include the planned media attachments in the preview JSON:

`npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Current dry-run facts from 2026-06-06T12:10:30Z:

- The preview renders six platform-specific posts for `linkedin,instagram,threads,bluesky,reddit,youtube`.
- Each preview references a repo-backed media asset and reports `exists: true`.
- Local `accountCount` was `0` across platforms in this runtime, which is acceptable for preview but means live publish/schedule should stay in GitHub Actions with repo secrets.
- The canonical local preview entrypoint is still `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`; the older `creator:platform:promo` alias is not present in this checkout.
- `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`, so Zernio remains a publish pipe only until analytics readback is restored.
- GitHub readback is partially healthy again in this runtime; direct PR/run reads succeed, but `npm run pr:manage` still fails against `api.github.com`.

## Classroom / Course Surface

- Approval-ready course copy now lives in:
  - `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`
- Approval-ready Skool measurement/readback brief now lives in:
  - `reports/gtm/2026-05-04-community-course-promo/skool-growth-readback-2026-06-04.md`
- Recommended posture:
  - keep the group free
  - use one free Classroom starter course
  - keep the first Classroom course `Open`, not paid or locked
  - keep Skool’s public Discovery-facing copy value-first
  - keep paid conversion on ThumbGate-owned checkout/intake only after direct follow-up or pain confirmation
  - do not enable Skool one-time pricing or paid tiers yet
