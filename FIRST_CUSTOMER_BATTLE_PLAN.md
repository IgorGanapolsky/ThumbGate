# First Customer Battle Plan — ThumbGate (Historical)

**Historical goal:** Get the first paying customer.
**Date:** 2026-04-06

This file is preserved as the original first-dollar push reference.
Current operator execution lives in [LAUNCH_NOW.md](LAUNCH_NOW.md) and [docs/marketing/operator-priority-handoff.md](docs/marketing/operator-priority-handoff.md), which track the live hosted revenue summary and the current send order.

---

## Your Assets (Already Live)

| Asset | Link |
|-------|------|
| Landing Page | https://thumbgate-production.up.railway.app |
| Pro Checkout Bootstrap | https://thumbgate-production.up.railway.app/checkout/pro?plan_id=pro&billing_cycle=monthly&utm_source=direct&utm_medium=manual_link&utm_campaign=first_customer_push&utm_content=direct_checkout |
| GitHub Repo | https://github.com/IgorGanapolsky/ThumbGate |
| Install Command | `npx thumbgate init --agent claude-code` |

---

## STEP 1: Post These (Do This First — 30 min)

### 1A. Reddit r/ClaudeAI

**Title:** I spent 3 weeks watching Claude Code repeat the same mistakes. So I built a tool to stop it.

The Problem:

Every time I'd use Claude Code to scaffold a new project, I'd hit the same wall: it would grab the wrong import, or set up the same broken config. Thumbs down. Next session? Same mistake. And again the next session.

I realized Claude isn't *forgetting* the context — it's just that no one's giving the agent a way to *learn* from that feedback at the system level. So I built **ThumbGate**.

**How it works:**

1. You're coding. Claude does something wrong — bad import, incorrect config, whatever.
2. You give it a thumbs down in Claude Code (via MCP).
3. ThumbGate captures that feedback, extracts what went wrong, and generates a **prevention rule**.
4. Next session, the agent *can't* make that mistake again. The rule blocks it at the PreToolUse hook level.

It's not training — it's enforcement. The agent still sees all its tools, but it can't execute the broken patterns you've already reported.

**Free to use locally.** No cloud account required. Local-first SQLite + lesson state in your `.thumbgate/` folder. Pro tier is $19/mo if you want a personal local dashboard, DPO export, and a gate debugger.

```bash
npx thumbgate init --agent claude-code
```

Then give your agent a thumbs down next time it messes up. ThumbGate will do the rest.

I've been using this for 2 weeks — Claude Code hasn't repeated a single mistake I've marked down. Would love to hear if it works the same way for you.

Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=claudeai_post&community=ClaudeAI&campaign_variant=founder_story&offer_code=REDDIT-EARLY

---

### 1B. Reddit r/cursor

**Title:** [Show r/cursor] Stop Cursor from repeating the same mistakes — with ThumbGate

How many times have you hit this?
- Cursor generates the same broken config file.
- You fix it. Next session, it generates the exact same broken version again.
- You try to communicate the fix in context — but context windows are finite, and the agent still doesn't *learn*.

I built **ThumbGate** — an MCP server that turns your feedback into *enforced prevention rules* that Cursor can't bypass.

1. Cursor makes a mistake → you give a thumbs down.
2. ThumbGate captures the exact context and failure reason.
3. ThumbGate generates a rule that blocks that pattern at the tool-use level.

It sits between Cursor and its tools as a **PreToolUse hook**. Local-first and free. Feedback state lives in your repo's `.thumbgate/` folder while the hook runs inside Cursor's MCP/tool config.

Pro tier ($19/mo, 7-day free trial) adds a personal dashboard, DPO export, and gate debugger.

```bash
npx thumbgate init --agent cursor
```

Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=cursor_post&community=cursor&campaign_variant=workflow_pain&offer_code=REDDIT-EARLY

---

### 1C. Hacker News (Show HN)

**Title:** Show HN: ThumbGate – PreToolUse gates for AI agents powered by feedback + Thompson Sampling

AI coding agents (Claude Code, Cursor, Codex) are stateless across sessions. When they repeat a mistake, there's no system-level mechanism to enforce "don't do that again."

ThumbGate is an MCP server that turns agent feedback into enforced prevention rules via PreToolUse hooks.

- Feedback Capture: thumbs down records the exact context — what the agent tried, why it failed, what should have happened.
- SQLite+FTS5 stores lessons. Thompson Sampling picks highest-confidence prevention rules.
- Rules are consulted at PreToolUse time. If a tool call matches a prevention pattern, it's blocked before execution.
- No weight training. Context engineering + enforcement. Rules are human-readable Markdown.

Stack: Node.js ≥18.18.0, SQLite+FTS5, LanceDB vectors, ContextFS for rule assembly.

Free tier: local enforcement, 3 feedback captures/day, 5 lesson searches/day, unlimited recall, and no cloud account required.
Pro ($19/mo, 7-day trial): personal local dashboard, DPO export, gate debugger, and model hardening guidance.

```
npx thumbgate init --agent claude-code
```

Landing: https://thumbgate-production.up.railway.app/?utm_source=hackernews&utm_medium=community_post&utm_campaign=first_customer_push&utm_content=show_hn&community=ShowHN&campaign_variant=technical_launch
GitHub: https://github.com/IgorGanapolsky/ThumbGate

---

### 1D. LinkedIn Founder Post

Most AI coding agents do not fail because they forgot your prompt. They fail because nothing sits between the model and the next risky tool call.

ThumbGate turns structured thumbs-down feedback into PreToolUse enforcement:

1. The agent repeats a known bad pattern.
2. You capture what went wrong and what should change.
3. ThumbGate turns that into a prevention rule.
4. The next matching tool call gets blocked before execution.

That is the difference between memory and enforcement.

The free path stays local-first. Pro is for the personal dashboard, exports, and proof when a workflow owner asks what changed.

If you already have one repeated workflow failure in Claude Code, Cursor, Codex, Gemini, or Amp, start here:
https://thumbgate-production.up.railway.app/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=founder_post&creator=IgorGanapolsky&campaign_variant=workflow_hardening

Repo: https://github.com/IgorGanapolsky/ThumbGate

Optional first comment:
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md

---

## STEP 2: Reply to These Live Threads (Do This Second — 20 min)

People are actively complaining about this exact problem RIGHT NOW. Reply helpfully (not spammy) to these. Do not use X/Twitter for this step; that channel was retired from active distribution on April 20, 2026.

| Platform | Thread | Pain Point |
|----------|--------|------------|
| DEV.to | [Claude Code Memory Fix](https://dev.to/gonewx/i-tried-3-different-ways-to-fix-claude-codes-memory-problem-heres-what-actually-worked-30fk) | Every new session is a blank slate |
| DEV.to | [Claude Keeps Forgetting](https://dev.to/kiwibreaksme/claude-code-keeps-forgetting-your-project-heres-the-fix-2026-3flm) | Claude forgets project architecture |
| DEV.to | [Why Claude's Memory Fails](https://dev.to/nikita_benkovich_eb86e54d/we-investigated-why-claudes-memory-fails-heres-what-we-learned-3pl6) | Context compaction causes amnesia |
| Reddit DM | [Deep_Ad1959](https://www.reddit.com/user/Deep_Ad1959/) | Warm inbound, rollback risk, already in DMs |
| Reddit DM | [game-of-kton](https://www.reddit.com/user/game-of-kton/) | Warm inbound, stale context, conflicting facts |
| Reddit DM | [leogodin217](https://www.reddit.com/user/leogodin217/) | Warm inbound, mature workflow, review boundaries |
| Reddit DM | [Enthu-Cutlet-1337](https://www.reddit.com/user/Enthu-Cutlet-1337/) | Warm inbound, brittle guardrails, adaptive gates |
| HN | [Context Loss Solutions](https://news.ycombinator.com/item?id=46471286) | Context loss forces workarounds |
| HN | [AI Agent Context Rot](https://news.ycombinator.com/item?id=47461861) | Context rot is #1 problem |
| HN | [Context Bottleneck](https://news.ycombinator.com/item?id=45387374) | Large context windows don't help |
| Cursor Forum | [Memory of a Goldfish](https://forum.cursor.com/t/cursor-with-claude-has-memory-of-a-goldfish/118276) | Cursor + Claude loses context constantly |

**Reply template (adapt per thread):**

> This is exactly the problem I was hitting. I built ThumbGate to fix it — it captures your feedback (thumbs up/down) and generates prevention rules that physically block the agent from repeating mistakes via PreToolUse hooks. Free local path: `npx thumbgate init --agent claude-code`. Pro is $19/mo if you want the personal local dashboard and DPO export. [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)

---

## STEP 3: Direct Outreach (If Steps 1-2 Don't Convert — 30 min)

Find 5-10 developers who have starred similar repos (Mem0, SpecLock, context-engineering tools) and DM them directly with a free trial offer.

---

## Priority Order

1. **Post the r/ClaudeAI thread first** — highest concentration of people with this exact pain
2. **Post the HN Show HN** — longest tail, biggest potential reach
3. **Reply to the 10 existing threads** — these people are already hurting
4. **Post the LinkedIn founder post** — current public channel with the best fit for workflow-owner language
5. **Work the warm Reddit DMs** — highest-probability conversations already surfaced in the operator queue
