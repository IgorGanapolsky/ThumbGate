# ThumbGate Community + Course Promo Operator Handoff

Generated: 2026-05-04
Updated: 2026-06-03

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
- A headless read of the public Skool URL failed in this environment on 2026-06-02, so the live public page content still needs browser-side verification before claiming the surface is fully updated.
- Direct unauthenticated `curl -I -L https://www.skool.com/thumbgate-operator-lab-6000` returned HTTP `403` from CloudFront on 2026-06-02, so a headless anonymous verification path is not currently reliable from this runtime.
- Skool’s current Discovery FAQ lists `off-platform payments` as a ranking penalty, so external paid links on public Skool surfaces should be treated as a deliberate tradeoff instead of a default conversion step.
- `gh pr list --state open --limit 20` succeeded on `2026-06-03` and showed `17` open PRs, while `npm run pr:manage` still failed with `error connecting to api.github.com`, so direct GitHub queue readback is available but the higher-level manager script is still blocked in this runtime.
- Skool Growth-tab metrics have not been read back in a browser-authenticated session yet, so About-page conversion and traffic-source truth are still unknown.

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

Skool official sources (re-verified 2026-06-02):

- Pricing models supported: free, subscription, freemium, tiered pricing, and one-time payment.
  - https://help.skool.com/article/215-how-to-setup-pricing-for-the-group
- Owner billing: plans are recurring subscriptions after a 14-day free trial.
  - https://help.skool.com/article/227-payment-terms-and-policy
- Category limit: up to 10 categories per group.
  - https://help.skool.com/article/67-how-to-setup-categories
- Cover + icon setup path: Settings > General (opens the native file manager).
  - https://help.skool.com/article/120-how-to-set-up-my-group-logo-and-cover-photo
- About page: must be completed for Discovery eligibility and supports uploading images/videos in the editor.
  - https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- Public group-card links: available on the Pro plan, with up to `3` links.
  - https://help.skool.com/article/76-how-to-add-links
- Pinned posts: up to `3` feed pins; posts can also be pinned to a course page.
  - https://help.skool.com/article/38-how-do-to-pin-a-post
- Group rules: can be linked from pinned posts or the first lesson.
  - https://help.skool.com/article/189-how-to-setup-group-rules
- AutoDM exists, but should stay off until the first join flow is proven and approved.
  - https://help.skool.com/article/64-how-to-set-up-autodm
- Discovery eligibility + ranking:
  - Eligibility needs: minimum threshold of members, posts, and activity plus group description, About page description/images, and cover image. (Threshold values are not published.)
  - Visibility timing: once threshold is hit, Skool says visibility is within two hours.
  - Ranking boosts: high-quality artwork/about page, authentic engagement, active owner/admin behavior.
  - Ranking penalties: bots/fake accounts, spam or low-quality engagement, low-quality artwork/about page, off-platform payments, bad customer support, inactive owner.
  - https://help.skool.com/article/153-discovery-faqs
- Discovery “unlisted” checklist (new groups):
  - Cover image, group description, completed About page, at least one post, invite members.
  - https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery

## Zernio Status

GitHub Actions can authenticate to Zernio through repository secrets and found 7 connected accounts: Bluesky, Instagram, LinkedIn, Reddit, Threads, Twitter/X, and YouTube.

Zernio analytics polling is blocked by the Analytics add-on paywall. Treat Zernio as the publishing pipe and use UTM/Plausible/PostHog plus native dashboards for readback.

## Automation Update

The `thumbgate-creator-platform-promo.yml` workflow now passes `--offer=operator-lab`, so previews/schedules/publishes from that workflow promote the free Skool Operator Lab instead of the older first-customer launch copy.

As of 2026-06-03, local dry-runs still preview the Operator Lab campaign without Zernio credentials and include the planned media attachments in the preview JSON:

`npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`

Current dry-run facts from 2026-06-03:

- The preview renders six platform-specific posts for `linkedin,instagram,threads,bluesky,reddit,youtube`.
- Each preview references a repo-backed media asset and reports `exists: true`.
- Local `accountCount` was `0` across platforms in this runtime, which is acceptable for preview but means live publish/schedule should stay in GitHub Actions with repo secrets.
- `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h`, so Zernio remains a publish pipe only until analytics readback is restored.

## Classroom / Course Surface

- Approval-ready course copy now lives in:
  - `reports/gtm/2026-05-04-community-course-promo/skool-classroom-listing-copy.md`
- Approval-ready Skool measurement/readback brief now lives in:
  - `reports/gtm/2026-05-04-community-course-promo/skool-growth-readback-2026-06-02.md`
- Recommended posture:
  - keep the group free
  - use one free Classroom starter course
  - keep Skool’s public Discovery-facing copy value-first
  - keep paid conversion on ThumbGate-owned checkout/intake only after direct follow-up or pain confirmation
  - do not enable Skool one-time pricing or paid tiers yet
