# First Customer Battle Plan — ThumbGate

**Goal:** Get the first paying customer TODAY.
**Date:** 2026-04-06

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

Free tier: local enforcement, unlimited feedback captures, 5 lesson searches/day, unlimited recall, and no cloud account required.
Pro ($19/mo, 7-day trial): personal local dashboard, DPO export, gate debugger, and model hardening guidance.

```
npx thumbgate init --agent claude-code
```

Landing: https://thumbgate-production.up.railway.app/?utm_source=hackernews&utm_medium=community_post&utm_campaign=first_customer_push&utm_content=show_hn&community=ShowHN&campaign_variant=technical_launch
GitHub: https://github.com/IgorGanapolsky/ThumbGate

---

### 1D. Twitter/X Thread (7 tweets)

**Tweet 1:**
I watched Claude Code repeat the same mistakes for 3 weeks before I realized the problem: there's no system-level enforcement for "don't do that again."

You can give feedback, but the agent doesn't *learn*. So I built ThumbGate. A PreToolUse gate that actually works. 🧵

**Tweet 2:**
Here's the workflow:

1. Claude (or Cursor, or Codex) tries something broken
2. You give it a thumbs down
3. ThumbGate captures the feedback and generates a prevention rule
4. Next session, that rule blocks the same mistake at the tool-use level

No weight training. Just enforced prevention in Markdown files.

**Tweet 3:**
Why this matters:

Vibe coding with agents is powerful but risky. One bad pattern repeated across 10 sessions costs you hours. You can't write enough context to override training. But you *can* enforce a rule.

ThumbGate: local-first free tier. $19/mo Pro with dashboard + DPO export.

**Tweet 4:**
The tech stack is lean:

- SQLite + FTS5 for lesson storage
- Thompson Sampling for rule ranking
- PreToolUse hooks for enforcement
- ContextFS for rule assembly

Local-first. Free runs on your machine and stores feedback state in `.thumbgate/` while agent hooks stay in your editor or CLI config.

**Tweet 5:**
Install it in 30 seconds:

```
npx thumbgate init --agent claude-code
```

Then give Claude a thumbs down next time it breaks something. Watch it never make that mistake again.

Free to use. Pro trial is 7 days.

**Tweet 6:**
I've tested it on my own workflows for 2 weeks. Zero repeated mistakes.

https://thumbgate-production.up.railway.app/?utm_source=x&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=launch_thread&creator=IgorGanapolsky&campaign_variant=founder_story

**Tweet 7:**
Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=x&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=launch_thread_cta&creator=IgorGanapolsky&campaign_variant=founder_story

Built by @IgorGanapolsky. If you're tired of your AI agent making the same mistakes over and over — this is for you.

---

## STEP 2: Reply to These Live Threads (Do This Second — 20 min)

People are actively complaining about this exact problem RIGHT NOW. Reply helpfully (not spammy) to these:

| Platform | Thread | Pain Point |
|----------|--------|------------|
| DEV.to | [Claude Code Memory Fix](https://dev.to/gonewx/i-tried-3-different-ways-to-fix-claude-codes-memory-problem-heres-what-actually-worked-30fk) | Every new session is a blank slate |
| DEV.to | [Claude Keeps Forgetting](https://dev.to/kiwibreaksme/claude-code-keeps-forgetting-your-project-heres-the-fix-2026-3flm) | Claude forgets project architecture |
| DEV.to | [Why Claude's Memory Fails](https://dev.to/nikita_benkovich_eb86e54d/we-investigated-why-claudes-memory-fails-heres-what-we-learned-3pl6) | Context compaction causes amnesia |
| Twitter/X | [@Dan_Jeffries1](https://x.com/Dan_Jeffries1/status/1953170619471937584) | "Claude Code getting amnesia after every auto-compact" |
| Twitter/X | [@about_hiroppy](https://x.com/about_hiroppy/status/1950153718248222991) | Context amnesia causing silent code deletion |
| Twitter/X | [@tomcrawshaw01](https://x.com/tomcrawshaw01/status/2029919688713719809) | Need for persistent memory across sessions |
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
4. **Post the Twitter thread** — builds social proof
5. **Post the r/cursor thread** — secondary audience
