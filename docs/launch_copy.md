# ThumbGate — Complete Launch Copy

> Ready-to-post copy for Show HN, Product Hunt, Reddit, and Twitter/X.
> All copy is written for tomorrow's launch.

---

## 1. SHOW HN POST

**Submit at:** https://news.ycombinator.com/submit
**URL field:** https://github.com/IgorGanapolsky/ThumbGate

---

### Title (56 chars — well under the 80-char limit)

```
Show HN: ThumbGate – thumbs-up/down feedback that enforces gates on AI agents
```

*(78 chars — right at the sweet spot)*

---

### Body (paste into the text field)

```
Every AI coding agent I've worked with has the same flaw: it repeats mistakes
across sessions. You correct a force-push to main in session 1. Session 2: same
thing. You write it into the system prompt. Session 3: same thing again. Prompts
are suggestions. There's no enforcement layer.

ThumbGate is an npm package + MCP server that turns 👍/👎 reactions into
enforced pre-action gates. The flow: you give a thumbs-down on a bad agent
action → ThumbGate distills a lesson from that failure (with context from up to
8 prior entries) → repeated failures auto-promote to a prevention rule → a
PreToolUse hook physically blocks matching tool calls before they execute. Not a
suggestion. A block.

It works with Claude Code, Cursor, Codex, Gemini CLI, and Amp. Install:

    npm install thumbgate
    npx thumbgate init

Auto-detects your agent and wires the MCP config. All state lives in
.thumbgate/ — local SQLite + FTS5, no cloud required. Thompson Sampling adapts
gate sensitivity per failure domain over time.

The piece that surprised me most: the 👍 side. Reinforcing good patterns turns
out to be just as useful as blocking bad ones — the agent starts preferring your
approved flows without you having to spell them out every session.

Free tier: 3 feedback captures/day, 5 lesson searches/day, unlimited recall and
enforcement. Pro is $19/mo (personal dashboard + DPO export). Team is $99/seat
for shared lesson DB and org-wide enforcement.

About 6 weeks of nights and weekends. ~2K cloners on npm so far, 0 paid users.
Sharing here for honest feedback on the approach.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/thumbgate
Landing: https://thumbgate-production.up.railway.app
```

---

## 2. PRODUCT HUNT LAUNCH COPY

---

### Name
ThumbGate

### Tagline (49 chars)
```
Turn 👍/👎 feedback into enforced AI agent gates
```

### Short Description (258 chars)
```
ThumbGate is an npm package + MCP server that turns thumbs-up/down reactions
into enforced pre-action gates for AI coding agents. Repeated failures become
prevention rules that physically block matching tool calls. Works with Claude
Code, Cursor, Codex, Gemini CLI, and Amp.
```

### Topics
Developer Tools · Artificial Intelligence · Open Source

### Links
- Website: https://thumbgate-production.up.railway.app
- GitHub: https://github.com/IgorGanapolsky/ThumbGate
- npm: https://www.npmjs.com/package/thumbgate

---

### First Comment / Maker's Note (post this as your first comment after launch)

Hey Product Hunt — Igor here. I built ThumbGate over about six weeks of nights
and weekends, and I want to be honest about where it is today and why I built it.

**The problem I kept hitting**

I use Claude Code and Cursor constantly. Every session, I'd correct the same
mistakes — the agent would try to force-push to main, skip tests, or edit a file
outside the allowed directory. I'd fix it. Next session: same thing. I wrote
rules into the system prompt. Same thing. Prompts are suggestions. The agent
doesn't have to cooperate.

What I wanted was a gate — something that sits between the agent and its tools
and physically blocks known-bad actions before they execute.

**What ThumbGate actually does**

The flow is three steps:

1. **Feedback.** You give a tool call a 👎 (or 👍). ThumbGate captures the
   context — what the agent tried, why you rejected it, what the right action
   would have been. It also pulls from up to 8 prior related entries so lessons
   are history-aware, not isolated.

2. **Distill + Rules.** That feedback gets distilled into a lesson and stored in
   a local SQLite + FTS5 database. Repeated failures auto-promote to prevention
   rules. Thompson Sampling adapts gate sensitivity per failure domain — gates
   get tighter or looser based on observed error rates.

3. **Gates.** A PreToolUse hook checks every incoming tool call against your
   lesson DB. If it matches a prevention rule above the confidence threshold, the
   call is blocked before execution. Not a warning. A hard stop.

**The part I didn't expect to matter**

The 👍 side. I built it because symmetry seemed right, but reinforcing good
patterns turns out to be genuinely useful. The agent starts preferring your
approved flows — safe git patterns, correct import paths, approved file scopes —
without you re-explaining them every session.

**Where it is today**

Roughly 2,000 cloners on npm, 12 stars on GitHub, zero paid users. I shipped it
openly because I want real feedback on the approach before I over-invest in
distribution. The core is working — I've been running it personally for weeks and
my agents stopped repeating every mistake I've marked.

Free tier is generous: 3 feedback captures/day, 5 lesson searches/day, unlimited
recall and enforcement. Pro ($19/mo) adds a visual gate debugger, personal
dashboard, and DPO export for anyone who wants to fine-tune on their feedback
history. Team ($99/seat/mo, 3-seat minimum) adds shared lesson DB and org-wide
enforcement — that's the tier I think has real legs for consulting shops and
AI-native dev teams.

**What's next**

Shared gate libraries (import a curated ruleset without building one from
scratch), tighter Cursor marketplace integration, and a Workflow Sentinel that
predicts blast radius before an agent acts — not just reacts after.

If you use Claude Code, Cursor, Codex, Gemini CLI, or Amp and you're tired of
the same mistakes repeating — give it a try:

```
npx thumbgate init
```

I'll be here all day to answer questions, especially on the PreToolUse hook
architecture, Thompson Sampling for gate sensitivity, or the DPO export format.

---

### Gallery Image Captions (3)

**Image 1 — The core problem/solution**
Caption: `Session 1: agent force-pushes to main. You 👎 it. Session 2: ⛔ gate
blocks the push before it executes. That's ThumbGate.`

**Image 2 — Three-step flow**
Caption: `Feedback → Distill + Rules → Gate. Your reaction becomes a lesson,
the lesson becomes a rule, the rule becomes enforcement.`

**Image 3 — Terminal output**
Caption: `npx thumbgate init auto-detects your agent. Gates show the matched
rule, confidence score, and exactly why a tool call was blocked.`

---

## 3. REDDIT r/ClaudeAI POST

---

### Title
```
I built a tool that physically blocks Claude Code from repeating mistakes you've
already flagged — thumbs down once, never see it again
```

---

### Body

I got fed up with the same pattern: correct Claude Code in session 1, it does
the exact same thing in session 2. Prompts, CLAUDE.md rules, system prompt
additions — none of it is enforced. The agent is free to ignore all of it.

So I built **ThumbGate** — an MCP server that turns 👍/👎 reactions into
pre-action gates.

**Here's the concrete before/after:**

*Before ThumbGate:*
```
Session 1: Claude tries `git push --force`. You stop it, explain why.
Session 2: Claude tries `git push --force`. You stop it again.
Session 3: Same thing.
```

*After ThumbGate:*
```
Session 1: Claude tries `git push --force`. You give it a 👎 with context.
Session 2: ThumbGate's PreToolUse hook fires.
           ⛔ Blocked: "no-force-push" (confidence: 0.94)
Session 3+: Never comes up again.
```

The block isn't a suggestion — it fires before the tool call executes. Claude
doesn't get to decide whether to cooperate.

**How to install:**

```bash
npm install thumbgate
npx thumbgate init --agent claude-code
```

Takes about 30 seconds. Auto-wires the MCP config and PreToolUse hooks into your
Claude Code setup.

**What it stores:** A local SQLite + FTS5 lesson database in `.thumbgate/`. No
cloud required. The free tier gives you 3 feedback captures/day, 5 lesson
searches/day, and unlimited recall + enforcement.

**One thing I didn't expect:** the 👍 side is just as useful. Reinforcing good
patterns means Claude starts preferring your approved flows without you having to
re-explain them each session.

It's early — about 2K cloners, zero paid users, 6 weeks old. I'm sharing here
because r/ClaudeAI is where the real power users are and I want honest feedback
before I push harder on distribution.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/thumbgate
Landing: https://thumbgate-production.up.railway.app

Happy to answer questions on how the hook architecture works with Claude Code's
MCP setup.

---

## 4. REDDIT r/cursor POST

---

### Title
```
Built an MCP layer that makes Cursor's mistakes self-correcting — one thumbs
down and the same pattern can't happen again
```

---

### Body

Cursor is great. But it has a memory problem: every session starts clean. If it
generated a broken config yesterday and you fixed it, it'll generate the exact
same broken config tomorrow. You can put rules in `.cursorrules`, but the agent
isn't required to follow them — they're guidance, not enforcement.

I built **ThumbGate** to solve this. It's an MCP server that hooks into Cursor's
tool execution layer and turns your 👍/👎 reactions into pre-action gates.

**The workflow:**

1. Cursor does something wrong (wrong import, broken config, risky edit)
2. You give it a 👎 with brief context
3. ThumbGate distills a lesson and — after enough similar failures — promotes it
   to a prevention rule
4. Next session, the PreToolUse hook fires before Cursor executes the same
   pattern: **⛔ blocked**

**Install:**

```bash
npm install thumbgate
npx thumbgate init --agent cursor
```

This wires four MCP skills into Cursor: feedback capture, rule management,
lesson search, and session recall. All state lives locally in `.thumbgate/` —
SQLite + FTS5, no external services.

**Real example from my own setup:**

I kept getting a broken `tsconfig.json` — wrong `moduleResolution` setting.
Fixed it twice manually. Third time I gave it a 👎 with the context. ThumbGate
generated a rule. Haven't seen the broken config since — that was three weeks
ago.

**Free tier:** 3 feedback captures/day, 5 lesson searches/day, unlimited recall
and enforcement. Pro is $19/mo if you want the visual gate debugger and
dashboard. 

This is six weeks old with ~2K npm cloners and zero paid users — posting here
because Cursor users are exactly the audience I want real feedback from.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/thumbgate
Landing: https://thumbgate-production.up.railway.app

---

## 5. TWITTER/X LAUNCH THREAD

*(Post as a thread — each block is one tweet)*

---

**Tweet 1 — Hook**
```
Your AI coding agent is going to repeat that mistake again tomorrow.

You corrected it today. Wrote it in the system prompt. Added it to .cursorrules.

None of that enforces anything.

I built something that does. 🧵
```

---

**Tweet 2 — The problem, concretely**
```
Here's the loop everyone who uses Claude Code or Cursor knows:

Session 1: agent force-pushes to main. You stop it.
Session 2: same thing.
Session 3: same thing.

Prompts are suggestions. The agent decides whether to cooperate.
There's no enforcement layer. Until now.
```

---

**Tweet 3 — What ThumbGate is**
```
ThumbGate is an npm package + MCP server.

You give a tool call a 👎 → it captures the context → distills a lesson →
auto-promotes repeated failures to prevention rules → a PreToolUse hook
blocks matching tool calls before they execute.

Not a warning. A hard stop.
```

---

**Tweet 4 — How it actually works technically**
```
Under the hood:

→ Local SQLite + FTS5 lesson DB (sub-ms search, no cloud)
→ Distills from up to 8 prior related entries — history-aware, not isolated
→ Thompson Sampling adapts gate sensitivity per failure domain
→ PreToolUse hook fires before the agent executes — agent can't bypass it

All state lives in .thumbgate/ in your repo.
```

---

**Tweet 5 — The thing I didn't expect**
```
I thought the 👎 side would be the whole product.

The 👍 side is equally useful.

Reinforcing good patterns means the agent starts preferring your approved
flows without you re-explaining them every session.

Thumbs up on the right approach once. It sticks.
```

---

**Tweet 6 — Install + CTA**
```
Works with Claude Code, Cursor, Codex, Gemini CLI, and Amp.

npm install thumbgate
npx thumbgate init

30 seconds. Auto-detects your agent. Free tier is unlimited enforcement
(3 feedback captures/day, 5 searches/day).

GitHub ⭐: https://github.com/IgorGanapolsky/ThumbGate
```

---

**Tweet 7 — Honest status**
```
Honest numbers: ~2K npm cloners, 12 GitHub stars, 0 paid users.

Built in ~6 weeks. I've been running it on my own setup for a month —
my agents stopped repeating every mistake I've marked.

Now I want to know if it does the same for other people.
```

---

**Tweet 8 — Follow-up / objection handle**
```
"I just use .cursorrules / CLAUDE.md rules"

Those are read by the model. The model decides whether to follow them.

ThumbGate's gates fire at the tool execution layer — before the model
acts. The agent doesn't get a vote.

Different category.

Landing + Pro: https://thumbgate-production.up.railway.app
```

---

## 6. TIMING RECOMMENDATION

### Recommended launch order and timing

**Day 0 (Sunday night, 9–10 PM ET)**
Post Show HN.

HN traffic peaks Monday through Wednesday, with the highest votes-per-hour for
Show HN posts that go up Sunday night or early Monday morning ET. The algorithm
uses velocity in the first 2 hours — you want readers awake in the US and Europe
simultaneously. Sunday 9–10 PM ET hits both. Respond to every comment within 30
minutes — HN rewards active founders.

---

**Day 1 (Monday, 8–9 AM ET) — same day as HN front page**
Post the Twitter/X thread.

Cross-post the HN link in tweet 6 or 7 to drive bidirectional traffic. If Show
HN is doing well, the "live on HN" social proof converts.

---

**Day 1 (Monday, 10 AM ET)**
Post r/ClaudeAI.

r/ClaudeAI is active during US business hours. Post after the HN thread is
already live so you can link to it as validation. Lead with the personal story —
r/ClaudeAI readers respond to builder posts with a real problem statement.

---

**Day 1 (Monday, 12 PM ET)**
Post r/cursor.

Stagger 2 hours after r/ClaudeAI. Same day but different audience. If you post
them simultaneously, both look like spam even if they aren't. Tailor the opening
line to Cursor users specifically — don't repost the ClaudeAI copy verbatim.

---

**Day 2 (Tuesday, 12:01 AM PT)**
Launch on Product Hunt.

Product Hunt resets at midnight Pacific. Launching at 12:01 AM PT gives you the
full 24-hour voting window. By Tuesday you'll have HN and Reddit traction to
mention in the maker's note, which signals legitimacy. Ask for upvotes from the
HN and Reddit threads before PH closes.

---

### Summary table

| Platform     | Day | Time (ET)  | Notes                                           |
|--------------|-----|------------|-------------------------------------------------|
| Show HN      | Sun | 9–10 PM    | First. Sets the technical credibility baseline. |
| Twitter/X    | Mon | 8–9 AM     | Cross-link to HN thread if it's running well.   |
| r/ClaudeAI   | Mon | 10 AM      | Personal story framing, link HN for proof.      |
| r/cursor     | Mon | 12 PM      | Tailored to Cursor workflow pain, staggered.    |
| Product Hunt | Tue | 12:01 AM PT| Full voting window; reference HN + Reddit traction. |

---

### One tactical note

The Show HN title above uses "enforced gates" — not "persistent memory." The
existing draft uses "persistent memory," which overlaps with Mem0, mem.ai, and a
dozen other tools. "Enforced gates" is more specific, more accurate, and harder
to dismiss. HN readers will ask "how is this different from memory tools?" — the
answer is "it blocks, not just remembers" — lead with that distinction in the
title.
