# Cost Router Skill

## Overview

Stolen FORMAT from Advisor AI Partners AIOS (`advisoraipartners.com/aios`): the
three-tier cost router with budget metering and "privileged stays local"
enforcement.

> "Not every task needs the most expensive AI, and not every document should
> leave your office. Every request goes through a router: routine work runs
> free on your own computer, quick jobs go to a fast model, and only the hard
> thinking goes to the most capable one."

## Three-Tier Routing

| Tier | Cost | Leaves Machine | Use Case | Example |
|---|---|---|---|---|
| `local` | $0.00 | No | Simple/routine/ privileged | Sort emails, summarize notes |
| `fastCloud` | ~$0.15/M tokens | Yes | Medium complexity | PR review, content drafting |
| `capable` | ~$15/M tokens | Yes | Hard thinking, complex reasoning | Architecture design, strategic planning |

## Five-Step Audit (Stolen from AIOS)

1. **Audit** — Map what repeats in your week and score every task on Time/Money/Buildable.
2. **Choose** — Pick the modules (skills) that fit your workflow.
3. **Install** — Connect to your tools, email, calendar, CRM.
4. **First week** — Feel the first automation go live on real work.
5. **Keep building** — Monthly iteration, each task taken off the list.

## What's Slipping Dashboard

Every session opens with one page: **Who needs you, what happened overnight,
what's slipping, and a box to ask anything.**

```bash
npx thumbgate cost-router dashboard
```

## Usage

```bash
# Route a task to the appropriate tier
node scripts/cost-router.js route --task "Review this PR for security issues" --tokens 5000

# Audit a repetitive task for automation priority
node scripts/cost-router.js audit-task --title "Manual PR review" --minutes 30 --cost 10 --complexity 3 --frequency daily

# Check budget status
node scripts/cost-router.js status

# Set monthly budget
node scripts/cost-router.js set-budget --monthly 5000

# Check what's slipping
node scripts/cost-router.js dashboard
```

## Privileged Work Enforcement

Tasks containing privileged keywords (legal, medical, confidential, credentials,
PII, etc.) are **always** routed to `local` tier — never to a cloud model.

## Integration

The cost router integrates with `model-tier-router.js` to add:
- Budget metering (track spend against monthly cap)
- Privileged-work detection (force local tier)
- Task complexity classification (time/money/buildable scoring)
- "What's slipping" operational dashboard

## Files

- `scripts/cost-router.js` — cost router implementation
- `tests/cost-router.test.js` — test suite
- `.thumbgate/cost-router-budget.json` — budget state (local, gitignored)
