# ThumbGate Email Nurture Sequence — 5 Emails Over 14 Days

**Audience:** Developers who installed `thumbgate` or signed up at thumbgate.dev
**Goal:** Convert free users to engaged power users, then to Pro
**Tone:** Peer-to-peer developer voice. No marketing speak. Short and direct.

---

## Email 1 — Day 0: Welcome + First Check in 2 Minutes

**Subject:** Your first check takes 2 minutes

**Preview text:** Here's the one command you need right now.

**Body:**

Hey,

You just installed ThumbGate. Here's the fastest path to value.

Run this in your project:

```
npx thumbgate init
```

That installs the PreToolUse hook into your Claude Code settings. From this point, any feedback you capture gets turned into a check that blocks the same mistake in every future session.

Your first thumbs-down:

```
npx thumbgate feedback --down \
  "agent overwrote my .env without checking it existed"
```

That's it. Check is live. The mistake won't happen again.

When you're ready to see what's been blocked:

```
npx thumbgate dashboard
```

Questions? Reply to this email — it goes directly to the team.

**CTA button:** Open the Quick Start Guide
**URL:** https://thumbgate.dev/docs/quickstart

---

## Email 2 — Day 2: "Your agent just made the same mistake twice"

**Subject:** Your agent doesn't remember. ThumbGate fixes that.

**Preview text:** Every session starts from zero — unless you change this.

**Body:**

Here's the thing about AI coding agents: they have no memory between sessions.

That bug your agent caused on Monday? It will cause it again on Friday. Same pattern, same failure, different day.

ThumbGate breaks the cycle.

When an agent makes a mistake, you capture it once:

```
npx thumbgate feedback --down \
  "agent added a React route without an error boundary"
```

ThumbGate distills it into a prevention rule. The PreToolUse hook intercepts the pattern before it executes — in every session, forever.

One thumbs-down. Permanent fix.

The lesson DB is local SQLite. Nothing leaves your machine. No cloud sync, no telemetry — your codebase stays private.

If you haven't captured your first piece of feedback yet, now's the time. Think about the last mistake your agent made.

**CTA button:** Capture Your First Feedback
**URL:** https://thumbgate.dev/docs/feedback

---

## Email 3 — Day 5: Power User Tips

**Subject:** Three ThumbGate features most developers miss

**Preview text:** Feedback sessions, custom checks, and MCP integration.

**Body:**

If you're past the basics, here are three features worth knowing.

**1. Feedback sessions**
Group related feedback from a single coding session:

```
npx thumbgate session start "refactor auth module"
# ... work, capture feedback as you go ...
npx thumbgate session end
```

Sessions let ThumbGate see patterns across a sequence of actions, not just individual mistakes.

**2. Custom checks**
You can write checks directly without going through feedback capture:

```
npx thumbgate check add \
  --pattern "Write+path:*.env" \
  --action block \
  --reason "never overwrite env files"
```

**3. MCP integration**
If you use MCP-compatible tools (Claude Code, Cursor with MCP, Amp), ThumbGate exposes a full MCP server. Add it to your profile and the check engine runs natively inside your IDE toolchain.

Config: `config/mcp-allowlists.json`

All three features are in the free tier.

**CTA button:** Read the Power User Guide
**URL:** https://thumbgate.dev/docs/power-users

---

## Email 4 — Day 10: Social Proof + Community

**Subject:** 724 developers blocked 1,800+ mistakes this week

**Preview text:** Here's what the community is saying.

**Body:**

Some numbers from this week:

- 724 npm installs
- 200+ GitHub stars
- 1,800+ checks triggered across the community

What developers are saying:

> "First tool that actually made my Claude Code sessions feel consistent across days. The check that stops it from touching my migration files alone was worth the install."

> "Took 3 minutes to set up. Blocked the same React pattern error I'd fixed twice already. Done."

> "Local-first was the deciding factor for me. I don't want my codebase context leaving the machine."

ThumbGate works with Claude Code, Cursor, Codex, Gemini, Amp, and OpenCode. If your agent supports PreToolUse hooks or MCP, it's compatible.

If ThumbGate has saved you from a repeated mistake, we'd genuinely love to hear about it. Reply to this email or open an issue on GitHub.

**CTA button:** Star on GitHub
**URL:** https://github.com/IgorGanapolsky/ThumbGate

---

## Email 5 — Day 14: Pro Upgrade

**Subject:** You've hit the free lesson search limit

**Preview text:** Unlock unlimited searches, team sync, and advanced analytics.

**Body:**

You've been using ThumbGate for two weeks. By now you likely have lessons accumulating in your local DB.

Free tier gives you 5 lesson searches per day. If you're hitting that limit, it means the system is working — your agents are learning, your checks are active, and you're catching real mistakes.

ThumbGate Pro removes the limit and adds:

- Unlimited lesson searches (FTS5 full-text across your entire history)
- Export DPO training pairs for fine-tuning your own models
- Advanced dashboard with confidence trend graphs
- Priority support (direct reply to the core team)
- Early access to new check adapters

Current price: $9/month. No seat limits on a single machine.

If ThumbGate has saved you from one repeated agent mistake, it's already paid for itself in debugging time.

Upgrade takes 60 seconds.

**CTA button:** Upgrade to Pro
**URL:** https://thumbgate.dev/pro

---

## Sequence Summary

| # | Day | Subject | Goal |
|---|-----|---------|------|
| 1 | 0 | Your first check takes 2 minutes | Activation — get the hook installed |
| 2 | 2 | Your agent doesn't remember. ThumbGate fixes that. | Pain-point resonance + first feedback |
| 3 | 5 | Three features most developers miss | Depth + engagement with power features |
| 4 | 10 | 724 developers blocked 1,800+ mistakes this week | Social proof + community belonging |
| 5 | 14 | You've hit the free lesson search limit | Pro conversion |

**Sending platform notes:**
- Plain text format preferred. Developer audience has high spam filter sensitivity to HTML-heavy emails.
- Send from a real address (e.g., igor@thumbgate.dev), not a no-reply.
- UTM-tag all CTA links for attribution: `?utm_source=email&utm_campaign=nurture&utm_content=email{N}`
