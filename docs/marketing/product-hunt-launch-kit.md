# ThumbGate — Product Hunt Launch Kit

**Status:** Ready to submit  
**Recommended launch day:** Saturday (dev tools consistently see higher engagement on weekends)  
**Live listing:** https://www.producthunt.com/products/thumbgate

---

## 1. Tagline (60 chars max)

```
Thumbs down a mistake. Your AI agent never repeats it.
```

54 characters. Problem-first, outcome-clear, memorable.

**Alternates (if primary is taken):**
- `Pre-action checks that stop AI agents from repeating mistakes` (62 chars — trim to fit)
- `Your AI agent's immune system. One thumbs down at a time.` (57 chars)

---

## 2. Description (260 chars max)

```
ThumbGate turns thumbs-up/down feedback into enforcement for AI coding agents. 👎 auto-generates prevention rules and pre-action checks that physically block repeat mistakes. 👍 reinforces wins. Works with Claude Code, Cursor, Codex, Gemini, Amp, and any MCP agent.
```

265 characters — trim one phrase to stay under 260:

```
ThumbGate turns feedback into enforcement. 👎 auto-generates prevention rules and gates that physically block AI agents from repeating mistakes. 👍 reinforces wins. Works with Claude Code, Cursor, Codex, Gemini, Amp, and any MCP-compatible agent.
```

247 characters. Clear, agent-specific, differentiates from memory tools.

---

## 3. Maker Comment (~200 words)

Hey Product Hunt! Igor here — founder of ThumbGate.

I spent three weeks watching Claude Code repeat the same mistakes across sessions. Wrong import. Broken config. Force-push without checking PR threads. Correct it. Next session: same mistake. Every agent tool I tried helped agents *remember* — but none of them actually *prevented* the mistake from happening.

So I built ThumbGate. The concept is almost embarrassingly simple: give your AI agent a thumbs down when it screws up. That one signal travels through a pipeline — feedback capture, lesson extraction, prevention rule generation — and lands as a PreToolUse gate that physically blocks the agent from executing that pattern again. Not a suggestion. A hard block. The agent cannot run `git push --force` if a gate exists for it.

The other half matters too: thumbs up reinforces what worked, so safe patterns become easier to repeat and good habits compound over time.

What surprised me most after shipping: developers stopped re-explaining the same correction across sessions. The cognitive overhead of agent babysitting dropped noticeably. That's what ThumbGate is really about — not feedback collection, but enforcement.

724 weekly npm installs. 200+ GitHub stars. Featured on Awesome MCP Servers.

Free to install in 30 seconds: `npx thumbgate init`

I'm here all day — ask me anything.

---

## 4. First Comment (~100 words, casual)

Happy launch day! A few things to know before you try it:

The free tier gives you the local loop: 3 feedback captures total, 1 auto-promoted prevention rule, and local enforcement via PreToolUse hooks. No cloud account, no credit card.

Pro ($19/mo) adds the personal local dashboard, DPO export pairs for downstream fine-tuning, and a check debugger to trace exactly why a rule fired.

Team anchors at $49/seat/mo if you want shared lesson libraries, org visibility, and approval boundaries across an engineering team.

The quickest way to see it work: install it, give your agent a thumbs down on the next mistake, and watch the gate appear.

`npx thumbgate init --agent claude-code`

What agent are you running on? Happy to share setup tips for your specific stack.

---

## 5. Topics / Tags (5 Product Hunt topics)

1. **Developer Tools** — primary category, highest traffic for this audience
2. **Artificial Intelligence** — broad reach, trending
3. **Open Source** — free tier is MIT licensed, attracts dev community
4. **Productivity** — reducing repeated agent mistakes is a productivity story
5. **DevOps** — gate enforcement, hook-based automation, CI/CD adjacent

---

## 6. Screenshot List (capture these 5 assets)

### Screenshot 1: Hero — Problem/Solution Split
**What to capture:** Split screen composition.  
Left panel: Terminal showing an AI agent force-pushing to main (red output, no gate).  
Right panel: ThumbGate blocking the same command — `[gate] BLOCKED: git push --force (rule: no-force-push, confidence: 0.94)`.  
Overlay text: "Thumbs down a mistake. It never happens again."  
**Purpose:** Instant visual proof of the core value prop. This is the thumbnail — make it high contrast.

### Screenshot 2: Feedback-to-Gate Flow Diagram
**What to capture:** Horizontal 5-step flow on a dark background:  
`👎 Feedback → Validate → Extract Lesson → Generate Rule → Gate Blocks`  
Each step has a brief subtitle (1 line). Use green/amber/red color coding. No clutter.  
**Purpose:** Explains the mechanism at a glance for visitors who won't read the description.

### Screenshot 3: Live Dashboard
**What to capture:** Browser screenshot of https://thumbgate-production.up.railway.app/dashboard showing the enforcement matrix, active gate count, and feedback stats panel.  
**Purpose:** Social proof that the product is real and actively running. Shows Pro value.

### Screenshot 4: Terminal Install + Gate Firing
**What to capture:** Real terminal session showing:  
```
$ npx thumbgate init --agent claude-code
[thumbgate] Agent detected: claude-code
[thumbgate] MCP server registered
[thumbgate] 3 prevention rules loaded

$ git push --force
[gate] BLOCKED: no-force-push (confidence: 0.94)
[gate] Rule: "Never force-push. Check PR threads first."
```
**Purpose:** Developers respond to real terminal output over marketing copy. Shows zero-config setup and a gate firing end-to-end.

### Screenshot 5: Pricing Tiers
**What to capture:** Clean pricing comparison — Free vs Pro ($19/mo or $149/yr) vs Team ($49/seat/mo).
Pull from https://thumbgate-production.up.railway.app/#pricing  
Highlight "Free forever" tier prominently to reduce friction on PH visitors.  
**Purpose:** Removes the "how much does this cost?" friction before visitors click through.

---

## 7. Launch Day Checklist (Hour-by-Hour)

Product Hunt resets at **12:01 AM PST**. For maximum ranking, submit just after midnight and drive traffic in the first 6 hours.

### Pre-Launch (Day Before)

- [ ] Submit listing to Product Hunt — set live date to target Saturday
- [ ] Upload all 5 screenshots from Section 6
- [ ] Verify all UTM-tracked links resolve correctly
- [ ] Draft tweets, LinkedIn post, and Reddit posts — save as drafts, do not publish yet
- [ ] Identify 20-30 people in your network who would genuinely upvote (friends, early users, beta testers)
- [ ] Prepare personal DMs (not mass blast — individual messages)
- [ ] Set alarm for 12:01 AM PST

### 12:01 AM PST — Go Live

- [ ] Confirm listing is live on Product Hunt
- [ ] Post the maker comment (Section 3) immediately after going live
- [ ] Post the first comment (Section 4) as a follow-up
- [ ] Send first batch of personal DMs to 5-10 closest contacts

### 6:00 AM PST — Morning Wave

- [ ] Post Twitter/X thread (use existing thread from `twitter-launch-thread.md`)
- [ ] Post to r/ClaudeAI (use existing post from `LAUNCH_POSTS.md`)
- [ ] Post to r/cursor
- [ ] Send second batch of personal DMs

### 9:00 AM PST — Peak Hours Begin

- [ ] Post Show HN (Hacker News) — peak HN traffic is 9-11 AM PST
- [ ] Post LinkedIn article
- [ ] Reply to every comment on the Product Hunt listing personally — PH algorithm rewards engagement velocity
- [ ] Check upvote count and ranking position

### 12:00 PM PST — Midday Push

- [ ] Post to r/vibecoding and r/MachineLearning
- [ ] Reply to the 10 live threads from `FIRST_CUSTOMER_BATTLE_PLAN.md`
- [ ] Re-tweet launch thread with a different angle (gate firing example, not the install story)
- [ ] Send remaining personal DMs to beta users and early GitHub stargazers

### 3:00 PM PST — Afternoon Sustain

- [ ] Post a "just hit X upvotes, here's a demo" tweet with terminal screenshot
- [ ] Respond to any HN comments
- [ ] Check for any press or community mentions, reply to all

### 6:00 PM PST — Evening Summary

- [ ] Post a "thank you" tweet with key stats from the day
- [ ] Respond to any remaining PH comments
- [ ] Note conversion metrics: PH visitors → landing page → installs → Pro signups

### Post-Launch (Next Day)

- [ ] Write a brief launch retrospective (post to r/SideProject or personal blog)
- [ ] DM anyone who left a particularly thoughtful comment on PH
- [ ] Update `primer.md` with launch metrics

---

## 8. Upvote Strategy (Ethical Outreach Plan)

**Principle:** Ask people who would genuinely find this useful. Never ask strangers to upvote something they haven't tried. Product Hunt actively penalizes obvious ring-fencing.

### Tier 1: Personal Network (Target: 30-50 upvotes)

**Who:** Friends, former colleagues, GitHub stargazers, anyone who has used the product.

**How:** Personal DM on Twitter/X or LinkedIn. One message per person. Include a genuine note about why you think they'd find it useful.

**Template:**
> "Hey [name] — I'm launching ThumbGate on Product Hunt today. It's the tool that stops AI coding agents from repeating the same mistakes via pre-action checks. Given that you work with [Claude Code / Cursor / AI agents], I think you'd genuinely find it useful. Would mean a lot if you checked it out: [PH link]"

**Do not:** Send mass blasts, copy-paste identical messages, or ask people who have never used an AI coding agent.

### Tier 2: Developer Communities (Target: 50-150 upvotes)

**Subreddits to post:**
- r/ClaudeAI (~280k members, highest signal for this product)
- r/cursor (~120k members)
- r/vibecoding (~40k members)
- r/SideProject (launch day post)
- r/MachineLearning (technical angle only)

**Discord servers to share in:**
- Claude Code Discord (official Anthropic community)
- Cursor Discord
- MCP Servers community Discord
- Any AI developer communities you're active in

**Rule:** Only post in communities where you are already an active member, or where the post is genuinely on-topic. Link to the Product Hunt listing, not directly to the product.

### Tier 3: Dev Twitter/X (Target: 20-80 upvotes)

Post the launch thread at 6 AM PST (peak dev Twitter engagement).

Tag relevant accounts who cover AI dev tools:
- Indie hackers who cover devtools launches
- AI coding tool reviewers
- Anyone who has previously shared similar tools (Mem0, SpecLock, context-engineering tools)

**Do not** cold-DM random accounts asking for upvotes.

### Tier 4: Email / Newsletter

If you have any email list (even a small one from waitlist signups or early users), send a single launch-day email with:
- What you built and why
- The Product Hunt link
- A discount code for Pro (e.g., `PH2026` for 30% off first month)

UTM link: `https://thumbgate-production.up.railway.app/?utm_source=email&utm_medium=newsletter&utm_campaign=thumbgate-launch`

### What NOT to Do

- Do not use upvote services or rings
- Do not ask people in bulk without personalization
- Do not spam communities where you are not active
- Do not post the PH link in comment sections of unrelated threads

---

## 9. Answers to Expected Product Hunt Questions

### Q1: "How is this different from Mem0, SpecLock, or .cursorrules?"

**Answer:**
Memory tools (Mem0, Zep) help agents *remember* context — they store past information and inject it into future prompts. The agent can still ignore the memory.

.cursorrules is a static prompt file — it tells the agent what to do, but it's advisory.

ThumbGate *enforces* behavior via PreToolUse hooks. When a gate exists, the agent's tool call is intercepted before execution. It cannot run the blocked action. Not a suggestion — a constraint.

ThumbGate also generates rules automatically from your feedback rather than requiring you to write them manually. The feedback → lesson → prevention rule → gate pipeline is automatic.

Short version: memory tools help agents remember. ThumbGate stops agents from being able to forget.

---

### Q2: "Does this work with [my agent]?"

**Answer:**
Yes — if your agent supports the MCP protocol, ThumbGate works with it. Confirmed integrations:

- Claude Code: `npx thumbgate init --agent claude-code`
- Cursor: `npx thumbgate init --agent cursor`
- Codex: `npx thumbgate init --agent codex`
- Gemini: `npx thumbgate init --agent gemini`
- Amp: `npx thumbgate init --agent amp`
- OpenCode: `npx thumbgate init --agent opencode`

For any MCP-compatible agent not listed above: `npx thumbgate init` auto-detects your setup.

If you're running an agent that doesn't support MCP yet, the check engine still works locally — you just trigger feedback capture manually via the CLI instead of from within the agent UI.

---

### Q3: "What does the free tier actually include?"

**Answer:**
The free tier includes everything that makes the core product work:

- Unlimited feedback capture (thumbs up and thumbs down)
- Auto-generated prevention rules from your feedback
- Pre-action checks that block matching tool calls via PreToolUse hooks
- Local SQLite + FTS5 lesson storage (sub-millisecond search)
- Session recall — relevant past failures injected at session start
- No cloud account required — all state lives in `.thumbgate/` in your repo

What free does NOT include:
- The personal local dashboard (visual gate management, rule browsing, feedback history)
- DPO export pairs (for downstream fine-tuning your own models)
- Gate debugger (trace why a specific rule fired, with confidence scores)

Pro is $19/mo or $149/yr. Team is $49/seat/mo.

---

### Q4: "Isn't this just a CLAUDE.md or system prompt? Why do I need a whole tool?"

**Answer:**
Good question — and honestly, if writing a `.cursorrules` file works for you, you don't need ThumbGate.

Here's the gap: writing prevention rules in a CLAUDE.md requires you to notice the mistake, articulate it correctly, and update the file manually. If you miss it once, or the file gets stale, the agent repeats the mistake.

ThumbGate automates the capture → rule → enforcement pipeline. You give a thumbs down — the lesson is extracted, validated against a rubric (vague signals are rejected), and promoted to an actionable gate automatically. No file editing required.

More importantly: a CLAUDE.md rule is advisory. The agent reads it and decides whether to follow it. A ThumbGate PreToolUse gate intercepts the tool call before the agent has a chance to "decide." That's the enforcement difference.

For teams, shared lesson libraries let everyone's thumbs-down signals build gates for the whole team — not just the person who wrote the `.cursorrules`.

---

### Q5: "724 weekly installs — who are your users and what are they actually using it for?"

**Answer:**
The core users are developers who spend >2 hours/day with AI coding agents and are frustrated by repeated mistakes across sessions. The most common failure patterns I hear about:

1. Force-push to main without checking review threads
2. Wrong import path (agent keeps grabbing the old package name)
3. Config file overwrite (agent regenerates a broken default instead of using the custom one)
4. Skipping test runs before pushing
5. Using the wrong API endpoint (staging vs production)

These are all learnable, preventable patterns. ThumbGate's users are people who want their agent workflow to improve over time instead of starting fresh every session.

Featured on Awesome MCP Servers. The 724 installs/week is 7.4x the closest comparable tool in the feedback + enforcement category.

---

## UTM Tracking Reference

| Channel | Link |
|---------|------|
| Product Hunt listing | `https://thumbgate-production.up.railway.app/?utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch` |
| Twitter/X | `https://thumbgate-production.up.railway.app/?utm_source=twitter&utm_medium=post&utm_campaign=thumbgate-launch` |
| Reddit | `https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=post&utm_campaign=thumbgate-launch` |
| LinkedIn | `https://thumbgate-production.up.railway.app/?utm_source=linkedin&utm_medium=post&utm_campaign=thumbgate-launch` |
| Email / newsletter | `https://thumbgate-production.up.railway.app/?utm_source=email&utm_medium=newsletter&utm_campaign=thumbgate-launch` |
| HN Show HN | `https://thumbgate-production.up.railway.app/?utm_source=hackernews&utm_medium=community_post&utm_campaign=thumbgate-launch` |

---

## Key Assets Quick Reference

| Asset | Link |
|-------|------|
| Landing page | https://thumbgate-production.up.railway.app |
| Live dashboard | https://thumbgate-production.up.railway.app/dashboard |
| Pricing | https://thumbgate-production.up.railway.app/#pricing |
| GitHub | https://github.com/IgorGanapolsky/ThumbGate |
| npm | https://www.npmjs.com/package/thumbgate |
| Pro checkout | https://thumbgate-production.up.railway.app/checkout/pro?plan_id=pro&billing_cycle=monthly&utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch |
| Install command | `npx thumbgate init` |
| Claude Desktop bundle | https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb |

---

*Related files: `docs/marketing/product-hunt-launch.md` (original listing kit), `LAUNCH_POSTS.md` (Reddit/HN/Twitter posts), `FIRST_CUSTOMER_BATTLE_PLAN.md` (community outreach threads)*
