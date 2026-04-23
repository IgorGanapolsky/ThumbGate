# Stop paying for the same AI mistake twice

> ThumbGate's mission, in plain English. Long-form for the blog, dev.to, the company landing page, the GitHub README hero, and the SEO article we want to rank on "save Claude tokens" / "reduce LLM cost" / "AI agent token waste."

---

**TL;DR** — Frontier-model coding agents are powerful, but they have no memory across sessions. So they re-discover the same mistakes — week after week — and you pay for every retry, every hallucination, every regenerated plan. ThumbGate is a local-first enforcement layer that turns one thumbs-down into a permanent Pre-Action Check. The next time the agent tries the same wrong tool call, the hook intercepts it *before* it reaches the model. **Zero input tokens. Zero output tokens. Zero retry loop.** The dashboard surfaces a live "tokens saved this week" counter so you can see the dollar value of every prevention rule.

---

## The bill nobody talks about

Here's a fact that doesn't show up in any AI-coding tool's marketing page:

| Model | Input ($/1M) | Output ($/1M) |
|---|---|---|
| Claude Sonnet 4.5 | $3 | $15 |
| Claude Opus 4.6 | $15 | $75 |
| GPT-4o | $2.50 | $10 |
| Claude Haiku 4.5 | $0.80 | $4 |

Output is 4–5× the cost of input across every frontier model. And the way agents work — tools loop, plans regenerate, context compounds — output costs *dominate* the bill. Anthropic's own dashboard shows the same pattern: a single eight-hour Claude Code session can easily burn 200,000 output tokens. At Sonnet rates that's $3 per session. At Opus rates that's $15. Per developer. Per day. Multiply.

Now factor in the part nobody tells you about: **agents have no memory between sessions.**

The agent that learned today not to run `git push --force` to main? Forgets by Monday. The agent you spent 1,200 tokens explaining "the test runner here is `npm run test:integration`, not `npm test`"? Forgets next week. The agent you corrected when it tried to call `getUsersById` (the function is `getUserById`, no plural)? Forgets next session.

Each of those re-discoveries is a round-trip you're paying for, plus the retry the agent does when its first attempt fails, plus your re-prompt to correct it, plus the apology paragraph the model generates. Conservatively: **2,000 input tokens + 600 output tokens per repeated mistake.** At Sonnet pricing that's $0.015. Sounds like nothing. Multiply by 50 mistakes a day, 8 developers, 250 working days a year — that's **~$15,000 a year** in tokens spent on mistakes the team has *already corrected at least once*.

That's the bill nobody talks about.

## The reframe — reliability as billing

Most "AI agent reliability" tools approach repeat mistakes as a **quality** problem. Better prompts, better context, better evals. Those are real, but the buyer feels them as *annoyance.* Annoyance doesn't unlock budget.

ThumbGate approaches the same problem as a **billing** problem. Every blocked tool call is a line item the CFO doesn't see. The buyer feels it as *receipts.* Receipts unlock budget.

The mission, in one line:

> **Stop paying for the same AI mistake twice.**

## How the checks actually save you tokens

ThumbGate ships a `PreToolUse` hook (Claude Code, Cursor, Codex, Gemini, Amp, OpenCode, MCP — anything that supports tool-call interception). The hook runs *before* the agent's tool call is dispatched to the model API.

```text
┌─────────────────┐    ┌────────────────────────────┐    ┌──────────────┐
│  Agent decides  │ →  │  ThumbGate PreToolUse hook │ →  │  Model API   │
│  to run a tool  │    │  Match against check rules  │    │ (charges $)  │
└─────────────────┘    └────────────────────────────┘    └──────────────┘
                                  │
                              MATCH? │  yes
                                  ▼
                         ┌──────────────────────┐
                         │  ⛔ BLOCKED           │
                         │  Zero round-trip.    │
                         │  Zero retry loop.    │
                         │  Zero tokens spent.  │
                         └──────────────────────┘
```

When the check matches, the agent gets a structured "blocked, here's why" response *locally*. No API call. No tokens billed. The agent reasons about the block in its existing context — usually correctly — and picks a different path.

**That is the entire savings story.** Every check is a request that didn't happen. The dashboard counter is just integration:

```
Tokens saved this week = (blocked_calls + bot_deflections) × (avg_input + avg_output)
Dollars saved = tokens × blended_per_million(model_mix)
```

Conservative defaults: 2,000 input + 600 output per blocked call, Sonnet-blended pricing. You can swap in your team's actual model mix; the math stays honest.

## Three concrete examples

### 1. The repeat-import hallucination
Agent keeps writing `import { useFetch } from 'react'`. There is no such hook in React core. Each retry: ~1,800 input + 500 output tokens. You correct it. Next session, fresh context, same hallucination, same tokens.

**With ThumbGate:** one thumbs-down captures the lesson. Check pattern: `import.*useFetch.*from ['"]react['"]`. Verdict: BLOCK. Next 50 sessions: 0 tokens spent on the same hallucination. **At Sonnet rates, that's ~$0.40 saved per developer over a quarter** — for *one* check.

### 2. The destructive-command repeat
Agent suggests `DROP TABLE users` to "clean up" before a migration. You stop it. Without a check, the next session might suggest the same thing. Each suggestion costs you the round-trip + your re-prompt + the apology + the alternative plan. Conservative: 4,000 tokens per recurrence.

**With ThumbGate:** check pattern `DROP\s+TABLE.*users`. Verdict: BLOCK with explanation: "destructive on production-shaped table." Now the agent never spends a token even *thinking* about that path again. Recurrence-savings compound across the entire team.

### 3. The bot-inflated checkout flow (real story)
This blog's own product had 100+ Stripe checkout sessions opened in a week, zero completions. The funnel looked dead. Investigation: every Googlebot, GPTBot, ClaudeBot, Slackbot, and Twitterbot hitting `/checkout/pro` was creating a live Stripe session. Each one also fired a `checkout_bootstrap` event that downstream agents would investigate, costing tokens to triage "why is the funnel broken?"

**With ThumbGate's bot-deflection check:** bots get an HTML interstitial. Zero Stripe sessions. Zero downstream agent triage tokens. Funnel signal becomes honest, and the meter stops running on the false alarm.

(That's the real fix that shipped in [PR #869](https://github.com/IgorGanapolsky/ThumbGate/pull/869).)

## What this doesn't replace

ThumbGate is a token-waste reducer, not a model-quality booster. It will not:

- make your agent smarter on novel problems (that's the model's job),
- prevent the *first* occurrence of a mistake (you have to see it once to check it),
- replace tests, evals, or code review (it complements them).

What it *will* do is make sure you only pay for any given lesson **once**. That's the floor. Everything else is gravy.

## Try it

```bash
npx thumbgate init       # auto-detects your agent, wires PreToolUse hooks
npx thumbgate capture "Never run --force push to main"
```

That single command creates a check. Next time any agent tries `git push --force` against main, the hook fires and zero tokens get spent on the model's attempt.

Dashboard with live tokens-saved counter: <https://thumbgate-production.up.railway.app/dashboard>

Repo (MIT, open source): <https://github.com/IgorGanapolsky/ThumbGate>

---

*If you spend more than $50/month on Claude or GPT for coding work, ThumbGate's free tier almost certainly pays for itself in saved tokens within a week. If it doesn't, the dashboard will tell you that too — the math is yours, not ours.*
