# Operator Lab — Week 1 Content Sequence (Prep Only)

Prepared: 2026-05-26

Guardrail: prep only. Do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Skool group: https://www.skool.com/thumbgate-operator-lab-6000

Goal: create momentum for Skool Discovery (member growth + engagement + retention) while routing high-intent pain to the Sprint intake and self-serve intent to the guide → Pro path.

## Day 0 (pin) — Start Here

Use: `reports/gtm/2026-05-04-community-course-promo/skool-post-pack-2026-05-26.md` (Post 1).

## Day 1 — “One mistake → one rule” prompt

“Drop one repeated AI-agent mistake you’re seeing this week.

Format:
1) Agent/tool
2) Repo/workflow
3) What it keeps doing
4) What should happen instead
5) What you’ve tried so far

I’ll reply with the smallest Infrastructure Firewall check that blocks it + what proof artifact to capture.”

## Day 2 — Example teardown (fictional but realistic)

“Example: ‘Agent keeps force-pushing to `main` / deploys without checks.’

Workflow hardening move:
- Add a pre-action gate that blocks tool calls matching `git push --force` to protected branches.
- Require an explicit allowlist for deploy commands + a verification step.

Post your real workflow and we’ll tailor it.”

## Day 3 — “Context drift” clinic

“If your agent’s outputs get worse over time (context drift), reply with:
- what changed in the repo (files/features)
- where the agent started hallucinating / repeating
- your current ‘guardrail’ attempt

We’ll turn that into one enforceable check + a replayable proof run.”

## Day 4 — Ask Me Anything (AMA) thread

“AMA: pre-action gates, DPO exports, Thompson Sampling lesson ranking, and workflow proof packs.

Drop questions. If you’ve got a live workflow, include 1–2 sentences of context and the repeated failure.”

## Day 5 — Wins + leaderboard nudge

“Quick wins count. If you blocked even one repeat this week, post:
- what got blocked
- how you enforced it (rule/gate)
- what changed next run

I’ll compile the best wins into a ‘Workflow Hardening Proof Pack’ recap.”

## Day 6 — Offer routing reminder (no pricing)

“Two paths:
- If you want self-serve: start with the setup guide → Pro when you need the dashboard/exports.
  https://thumbgate-production.up.railway.app/guide
  https://thumbgate-production.up.railway.app/checkout/pro
- If you want hands-on hardening for one workflow: intake is here.
  https://thumbgate-production.up.railway.app/#workflow-sprint-intake”

