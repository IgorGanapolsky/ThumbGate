# ThumbGate Launch Posts

## Post 1: Reddit r/ClaudeAI

**Title:** I spent 3 weeks watching Claude Code repeat the same mistakes. So I built a tool to stop it.

---

The Problem:

Every time I'd use Claude Code to scaffold a new project, I'd hit the same wall: it would grab the wrong import, or set up the same broken config. Thumbs down. Next session? Same mistake. And again the next session.

I realized Claude isn't *forgetting* the context—it's just that no one's giving the agent a way to *learn* from that feedback at the system level. So I built **ThumbGate**.

**How it works:**

1. You're coding. Claude does something wrong—bad import, incorrect config, whatever.
2. You give it a thumbs down in Claude Code (via MCP).
3. ThumbGate captures that feedback, extracts what went wrong, and generates a **prevention rule**.
4. Next session, the agent *can't* make that mistake again. The rule blocks it at the PreToolUse hook level.

It's not training—it's enforcement. The agent still sees all its tools, but it can't execute the broken patterns you've already reported.

**Why I built this:**

- Claude Code is incredible, but it has no memory between sessions.
- Every agent—Claude, Cursor, Codex—repeats mistakes if you don't catch them every single time.
- There's no mechanism to say "don't do that again" at the system level.

**Free to use locally.** No cloud account required. Local-first SQLite + lesson state in your `.thumbgate/` folder. Pro tier is $19/mo if you want a personal local dashboard, DPO export, and a gate debugger.

**Install it:**
```bash
npx thumbgate init --agent claude-code
```

Then give your agent a thumbs down next time it messes up. ThumbGate will do the rest.

I've been using this for 2 weeks—Claude Code hasn't repeated a single mistake I've marked down. Would love to hear if it works the same way for you.

Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=claudeai_post&community=ClaudeAI&campaign_variant=founder_story&offer_code=REDDIT-EARLY

---

## Post 2: Reddit r/cursor

**Title:** [Show r/cursor] Stop Cursor from repeating the same mistakes—with ThumbGate

---

**The pain:**

How many times have you hit this?
- Cursor generates the same broken config file.
- You fix it. Next session, it generates the exact same broken version again.
- You try to communicate the fix in context—but context windows are finite, and the agent still doesn't *learn*.

There's no enforcement layer. Cursor is doing what it was trained to do, and if no one's blocking it, it keeps going.

**The solution:**

I built **ThumbGate**—an MCP server that turns your feedback into *enforced prevention rules* that Cursor can't bypass.

**Workflow:**

1. Cursor makes a mistake → you give a thumbs down.
2. ThumbGate captures the exact context and failure reason.
3. ThumbGate generates a rule: "When the user asks for X config, never output Y pattern."
4. Next time Cursor tries to output that pattern, the rule blocks it at the tool-use level.

It sits between Cursor and its tools as a **PreToolUse hook**. The agent still has full access to all its capabilities—but it can't execute the patterns you've already reported as broken.

**Why this matters for Cursor users:**

- **Vibe coding** is powerful but risky. One bad pattern repeated across 10 sessions costs you hours.
- **Prevention is cheaper than context.** You can't write enough context to override training. But you *can* enforce a rule.
- **Local-first and free.** Feedback state lives in your repo's `.thumbgate/` folder while the hook runs inside Cursor's MCP/tool config.

**Pro tier** ($19/mo, 7-day free trial) adds a personal dashboard to see all your rules, export DPO pairs for fine-tuning, and a gate debugger to trace why a rule fired.

**Install it:**
```bash
npx thumbgate init --agent cursor
```

Then hit thumbs down next time Cursor repeats a mistake. It won't happen again.

Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=cursor_post&community=cursor&campaign_variant=workflow_pain&offer_code=REDDIT-EARLY

---

## Post 3: Hacker News (Show HN)

**Title:** Show HN: ThumbGate – PreToolUse gates for AI agents powered by feedback + Thompson Sampling

---

**The Problem:**

AI coding agents (Claude Code, Cursor, Codex) are stateless across sessions. When they repeat a mistake, there's no system-level mechanism to enforce "don't do that again." You can write more context, but you can't override learned patterns—you can only hope the agent randomly avoids them next time.

**The Solution:**

ThumbGate is an MCP server that turns agent feedback into **enforced prevention rules** via PreToolUse hooks. Architecture:

- **Feedback Capture:** When you give a tool call a thumbs down (via Claude Code's MCP integrations), ThumbGate records the exact context: what the agent tried, why it failed, and what should have happened instead.
- **Lesson Extraction:** A local language model (you run it yourself) extracts a generalizable lesson from the feedback.
- **Rule Generation:** SQLite+FTS5 stores lessons; Thompson Sampling picks the highest-confidence prevention rules.
- **Enforcement:** Rules and lesson state live in `.thumbgate/` and are consulted at PreToolUse time. If a tool call matches a prevention pattern, it's blocked before execution.

**Tech Stack:**
- Node.js ≥18.18.0
- SQLite + FTS5 for lesson storage and retrieval
- LanceDB for vector similarity (optional, Pro only)
- ContextFS for rule assembly and context packing
- Thompson Sampling for multi-armed bandit rule selection

**No Training Required:** This is not RLHF weight training. It's context engineering + enforcement. Rules are human-readable Markdown files. You can edit them, version them, share them.

**Free Tier:**
- Unlimited feedback capture
- Auto-generated prevention rules with local enforcement
- Local storage on your machine via `.thumbgate/`
- No cloud account required

**Pro Tier ($19/mo, 7-day free trial):**
- Personal dashboard (rules, stats, feedback history)
- DPO export (for fine-tuning your own models)
- Gate debugger (trace why a rule fired)
- Model Hardening Advisor (recommend when local fine-tuning is worth it)

**Install:**
```bash
npx thumbgate init --agent claude-code
```

**Try it:**
Give Claude Code a thumbs down next time it repeats a mistake. ThumbGate will block that pattern in the next session.

Landing: https://thumbgate-production.up.railway.app/?utm_source=hackernews&utm_medium=community_post&utm_campaign=first_customer_push&utm_content=show_hn&community=ShowHN&campaign_variant=technical_launch
GitHub: https://github.com/IgorGanapolsky/ThumbGate

---

## Post 4: Twitter/X Thread

---

**Tweet 1:**
I watched Claude Code repeat the same mistakes for 3 weeks before I realized the problem: there's no system-level enforcement for "don't do that again."

You can give feedback, but the agent doesn't *learn*. You can write more context, but the agent doesn't *enforce* anything.

So I built ThumbGate. A PreToolUse gate that actually works.

**Tweet 2:**
Here's the workflow:

1. Claude (or Cursor, or Codex) tries something broken
2. You give it a thumbs down
3. ThumbGate captures the feedback and generates a prevention rule
4. Next session, that rule blocks the same mistake at the tool-use level

No weight training. No fine-tuning required. Just enforced prevention backed by local lessons and gates in `.thumbgate/`.

**Tweet 3:**
Why this matters:

Vibe coding with agents is *powerful* but risky. One bad pattern repeated across 10 sessions costs you hours. You can't write enough context to override training. But you *can* enforce a rule.

ThumbGate: local-first free tier. $19/mo Pro with a dashboard + DPO export.

**Tweet 4:**
The tech stack is small and lean:

- SQLite + FTS5 for lesson storage
- Thompson Sampling for rule ranking
- PreToolUse hooks for enforcement
- ContextFS for rule assembly

Local-first. Free runs on your machine, and feedback state lives in `.thumbgate/` while hooks run inside your agent config.

**Tweet 5:**
Install it in 30 seconds:

```
npx thumbgate init --agent claude-code
```

Then give Claude a thumbs down next time it breaks something. Watch it never make that mistake again.

Free to use. Pro trial is 7 days.

**Tweet 6:**
Dashboard demo + local walkthrough:

Give Claude Code a thumbs down, watch the prevention rule appear, and see the same pattern get blocked in the next session.

On the workflows I had explicitly marked down, it stopped the repeats that kept wasting my time.

https://thumbgate-production.up.railway.app/?utm_source=x&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=launch_thread&creator=IgorGanapolsky&campaign_variant=founder_story

**Tweet 7:**
Repo: https://github.com/IgorGanapolsky/ThumbGate
Tracked landing: https://thumbgate-production.up.railway.app/?utm_source=x&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=launch_thread_cta&creator=IgorGanapolsky&campaign_variant=founder_story

Built by @IgorGanapolsky. If you're tired of your AI agent making the same mistakes over and over—this is for you.

---

## Key Assets

**Install Command:**
```bash
npx thumbgate init --agent claude-code
```

**Checkout/Pricing Link:**
https://thumbgate-production.up.railway.app/checkout/pro?plan_id=pro&billing_cycle=monthly&utm_source=x&utm_medium=organic_social&utm_campaign=first_customer_push&utm_content=thread_direct_checkout&creator=IgorGanapolsky

**Landing Page:**
https://thumbgate-production.up.railway.app/?utm_source=direct&utm_medium=manual_link&utm_campaign=first_customer_push&utm_content=launch_assets

**GitHub:**
https://github.com/IgorGanapolsky/ThumbGate

**Hashtags (for Twitter/X):**
#ClaudeAI #Cursor #AI #CodingAgents #MCP #DevTools

---

## Notes for Launch

1. **r/ClaudeAI post** — Focus on the personal story. Emphasize the "no memory between sessions" problem. Lead with the frustration, not the product.

2. **r/cursor post** — Tailor everything to Cursor's vibe-coding workflow. Mention that it works as an MCP server. Emphasize prevention over context.

3. **HN post** — Lead with architecture. Use proper terminology (PreToolUse hooks, Thompson Sampling, FTS5). No marketing speak. Just clear technical description.

4. **Twitter thread** — Hook hard with the problem. Build momentum. End with the install link and honest proof from your own repeated-failure workflows.

**Timing:** Post these ~30 minutes apart to avoid clustering. Monitor comments and respond authentically to questions.
