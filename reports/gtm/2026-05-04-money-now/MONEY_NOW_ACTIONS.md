# Money Now Actions

Updated: 2026-05-05

Use this as the operator cockpit for the current run. Full copy, follow-ups, CTAs, and logging commands live in `operator-send-now.md`; the pipeline truth table lives in `sales-pipeline.md`.

## Current Revenue State (verification required)

This file must not carry unverified live metrics, PR numbers, or “today/30d/lifetime” aggregates. Refresh before acting:

1. Hosted config + checkout URLs: `npm run hosted:config` (or `node scripts/hosted-config.js`)
2. Revenue status snapshot: `npm run revenue:status`
3. Revenue plan output: `npm run revenue:plan`

When you paste metrics into any report, include the exact command + timestamp and keep the raw output in the operator log (not in this file).

## Do First
1. Refresh truth via `npm run revenue:status` + `npm run revenue:plan` (operator-run; do not invent numbers).
2. If there is a ready release that fixes `/pro`, publish it before sending any Pro outreach (avoid sending users to a broken surface).
3. Send the 4 warm Reddit Workflow Hardening Sprint DMs.
4. Send the 3 self-serve Pro guide-first messages.
5. Send the 5 strongest production-rollout sprint messages.
6. After each verified send, run that row's `Log after send` command from `operator-send-now.md`.
7. Only send proof links after the buyer confirms pain.
8. Use `revenue-close-room.md` for follow-up scripts once there is a reply.

## Skool Operator Lab — Approval-Required Checklist

These steps require explicit confirmation before executing (no autopost, no invites, no uploads in this automation run).

Note: Use `https://thumbgate-production.up.railway.app` as the canonical CTA base unless `thumbgate.ai` redirect behavior has been verified.

Skool discovery minimum threshold typically requires: cover image, group description, completed About page, at least 1 post, and inviting members. Verify details in `reports/gtm/2026-05-04-community-course-promo/platform-requirements-refresh.md` before executing.

1. Upload Skool cover image: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`.
2. Upload Skool icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`.
3. Add About media (optional): follow `reports/gtm/2026-05-04-community-course-promo/skool-media-upload-steps.md`.
4. Publish the first post: pick a draft in `reports/gtm/2026-05-04-community-course-promo/skool-first-post.md`.
5. Invite the first 10–20 people: populate `docs/OUTREACH_TARGETS.md` first, then invite.
   - Optional: use the Skool-specific invite queue template: `reports/gtm/2026-05-04-community-course-promo/skool-invite-target-queue.md`.
6. Keep the approval queue current in `reports/gtm/2026-05-04-community-course-promo/operator-approval-queue.md`.

## Top Send Queue

### 1. reddit_deep_ad1959_r_cursor
- Contact: https://www.reddit.com/user/Deep_Ad1959/
- Offer: Workflow Hardening Sprint.
- Send: Your question about rollback rates when context changes is exactly the right one. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have one workflow where context drift or rollback risk keeps showing up, I can harden that workflow for you. Worth a 15-minute diagnostic?

### 2. reddit_game_of_kton_r_cursor
- Contact: https://www.reddit.com/user/game-of-kton/
- Offer: Workflow Hardening Sprint.
- Send: Your ACT-R engram work is fascinating, especially the conflict resolution for opposing facts and the decay model. I am looking for one serious AI-agent workflow to harden end-to-end this week. If your memory system has one recurring failure mode such as stale context, opposing facts, bad handoffs, or unsafe tool calls, I can turn that into a prevention rule and proof run. Open to a 15-minute diagnostic?

### 3. reddit_leogodin217_r_claudecode
- Contact: https://www.reddit.com/user/leogodin217/
- Offer: Workflow Hardening Sprint.
- Send: Your arch-create to sprint workflow is one of the most mature agent processes I have seen anyone describe. I am looking for one AI-agent workflow to harden end-to-end this week. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeating failure and I will help turn it into an enforceable Pre-Action Check plus proof run. Worth 15 minutes?

### 4. reddit_enthu_cutlet_1337_r_claudecode
- Contact: https://www.reddit.com/user/Enthu-Cutlet-1337/
- Offer: Workflow Hardening Sprint.
- Send: Appreciate the kind words on the Thompson Sampling approach. You nailed the core insight: most guardrails are brittle prompt hacks that break when context shifts. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have a workflow where brittle guardrails keep failing, I can harden that workflow with you. Open to a 15-minute diagnostic?

### 5. github_agynio_gh_pr_review
- Contact: https://agyn.io/
- Offer: Pro at $19/mo or $149/yr.
- Send: Hey @agynio, saw you're building around `gh-pr-review`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

### 6. github_levnikolaevich_claude_code_skills
- Contact: https://levnikolaevich.com/
- Offer: Pro at $19/mo or $149/yr.
- Send: Hey @levnikolaevich, saw you're building around `claude-code-skills`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

### 7. github_greenpolo_cc_multi_cli_plugin
- Contact: https://github.com/greenpolo
- Offer: Pro at $19/mo or $149/yr.
- Send: Hey @greenpolo, saw you're building around `cc-multi-cli-plugin`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.

### 8. github_montenegronyc_backporcher
- Contact: https://numberfortyeight.co/
- Offer: Workflow Hardening Sprint.
- Send: Hey @montenegronyc, saw you're shipping `backporcher`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

### 9. github_adqui9608_ai_code_review_agent
- Contact: https://github.com/Adqui9608
- Offer: Workflow Hardening Sprint.
- Send: Hey @Adqui9608, saw you're shipping `ai-code-review-agent`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

### 10. github_kamaldhingra_ai_agents_qa_automation
- Contact: https://github.com/kamaldhingra
- Offer: Workflow Hardening Sprint.
- Send: Hey @kamaldhingra, saw you're shipping `AI-Agents-QA-Automation`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

### 11. github_abhi268170_stagix
- Contact: https://github.com/Abhi268170
- Offer: Workflow Hardening Sprint.
- Send: Hey @Abhi268170, saw you're shipping `Stagix`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

### 12. github_dolutech_engine_context
- Contact: https://dolutech.com/
- Offer: Workflow Hardening Sprint.
- Send: Hey @dolutech, saw you're shipping `engine_context`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## Exact Tracking Commands
Use the matching `Log after send`, `Log after pain-confirmed reply`, `Log after checkout started`, and `Log after paid` commands from `operator-send-now.md`. Do not advance a lead unless the external action actually happened.
