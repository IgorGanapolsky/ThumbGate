# ThumbGate Community + Course Promo Operator Handoff

Generated: 2026-05-04
Updated: 2026-05-05

## Live Assets

- Skool group: `https://www.skool.com/thumbgate-operator-lab-6000`
- Production landing page: `https://thumbgate-production.up.railway.app/`
- Marketing site: `https://thumbgate.ai/`
- Workflow sprint intake: linked from the production landing page
- Skool artwork (hosted):
  - Cover: `https://thumbgate.ai/assets/skool/thumbgate-skool-cover-1084x576.png`
  - Icon: `https://thumbgate.ai/assets/skool/thumbgate-skool-icon-128x128.png`

## Skool Status

The group exists and the Hobby trial path is active. During setup, Skool showed the first owner charge as May 18, 2026 for `$9`.

Completed in Skool:

- Public group visibility selected.
- Discovery keywords filled.
- Sidebar description filled.
- Audience size answered as `Under 10k`.
- About page description drafted in the editor.

Current blockers:

- The About page is waiting on final public-save confirmation.
- Cover/icon uploads are blocked by the in-app browser file-picker surface, but local assets are ready.
- The first post and invite steps require action-time confirmation before publication/sending.

Workaround for the in-app file picker:

- If Skool allows URL-based embeds in the About editor, use the hosted artwork URLs above.
- If Skool requires file uploads for cover/icon (likely), do the upload in a normal browser outside the in-app file picker surface.

## Recommended Setup

- Group name: ThumbGate Operator Lab
- Group URL: `skool.com/thumbgate-operator-lab-6000`
- Member pricing: free
- Description: Stop your AI coding agent from repeating the same mistake twice. Bring one repeated Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP workflow failure. We will turn it into a prevention rule, pre-action gate, or workflow-hardening teardown.
- Starter categories: Start Here, Repeated Mistakes, Pre-Action Gates, Workflow Teardowns, Claude Code, Codex, Cursor, MCP Servers, Sprint Intakes, Wins.

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

Skool official sources (verified 2026-05-05):

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
- Discovery eligibility + ranking:
  - Eligibility needs: minimum threshold of members/posts/activity + group description + about page description/images + cover image. (Threshold values are not published.)
  - Visibility timing: once threshold is hit, visibility is typically within ~2 hours.
  - Ranking boosts: high-quality artwork/about page, authentic engagement, active owner/admin behavior.
  - https://help.skool.com/article/153-discovery-faqs
- Discovery “unlisted” checklist (new groups):
  - Cover image, group description, completed About page, at least one post, invite members.
  - https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery

## Zernio Status

GitHub Actions can authenticate to Zernio through repository secrets and found 7 connected accounts: Bluesky, Instagram, LinkedIn, Reddit, Threads, Twitter/X, and YouTube.

Zernio analytics polling is blocked by the Analytics add-on paywall. Treat Zernio as the publishing pipe and use UTM/Plausible/PostHog plus native dashboards for readback.

## Automation Update

The `thumbgate-creator-platform-promo.yml` workflow now passes `--offer=operator-lab`, so previews/schedules/publishes from that workflow promote the free Skool Operator Lab instead of the older first-customer launch copy.
