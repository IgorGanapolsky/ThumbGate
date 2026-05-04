# ThumbGate Community + Course Promo Operator Handoff

Generated: 2026-05-04

## Live Assets

- Skool group: `https://www.skool.com/thumbgate-operator-lab-6000`
- Production landing page: `https://thumbgate-production.up.railway.app/`
- Workflow sprint intake: linked from the production landing page

## Skool Status

The group exists and the Hobby trial path is active. During setup, Skool showed the first owner charge as May 18, 2026 for `$9`.

Completed in Skool:

- Public group visibility selected.
- Discovery keywords filled.
- Sidebar description filled.
- Audience size answered as `Under 10k`.
- About page description saved publicly.

Current blockers:

- Cover/icon uploads are blocked by the in-app browser file-picker surface, but local assets are ready.
- The first post and invite steps require action-time confirmation before publication/sending.

Approval-ready drafts:

- Skool media upload checklist: `reports/gtm/2026-05-04-community-course-promo/skool-media-upload-steps.md`
- Skool first post options: `reports/gtm/2026-05-04-community-course-promo/skool-first-post.md`
- Skool invite/DM templates: `reports/gtm/2026-05-04-community-course-promo/skool-invite-dm-templates.md`
- Operator approval queue: `reports/gtm/2026-05-04-community-course-promo/operator-approval-queue.md`

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

- Skool official help confirms group pricing can be free for members and supports subscription, freemium, tiered, and one-time pricing.
- Skool official payment terms say owner plans are recurring subscriptions after the trial.
- Skool official category help says groups can have up to 10 categories, which matches the 10-category setup above.
- Skool official cover/photo help says group logo and cover photo are configured from Settings > General.
- Skool official Discovery help says eligibility requires the group description, About page description/images, a cover image, and enough real posts/activity. It also says high-quality artwork, a strong about page, authentic engagement, and active owner/admin behavior are ranking boosts.

## Zernio Status

GitHub Actions can authenticate to Zernio through repository secrets and found 7 connected accounts: Bluesky, Instagram, LinkedIn, Reddit, Threads, Twitter/X, and YouTube.

Zernio analytics polling is blocked by the Analytics add-on paywall. Treat Zernio as the publishing pipe and use UTM/Plausible/PostHog plus native dashboards for readback.

## Automation Update

The `thumbgate-creator-platform-promo.yml` workflow now passes `--offer=operator-lab`, so previews/schedules/publishes from that workflow promote the free Skool Operator Lab instead of the older first-customer launch copy.
