# LinkedIn draft — "From git init to v1.17.0 in 70 days"

Three drafts, ranked. Pick one and paste. Each one leads with a hook that survives LinkedIn's "...see more" cutoff (~140 chars).

---

## Draft A — The honest one (recommended)

70 days. 112 commits. 17 releases. 6,000 npm downloads. $0 in customer revenue.

I shipped ThumbGate from `chore: initialize repository` to live production in 70 days, solo. The product works. The funnel doesn't yet.

Here's the unedited build log, including the part where I had to admit that "deployed" and "selling" are not the same thing:

→ https://thumbgate.ai/learn/from-prototype-to-production

Five lessons that cost me real CI minutes to learn:

• A deployment-verification gate beats a memory note. Until "deployed" was blocked by two grep checks against /health, I was lying to myself about ship status.

• Behavioral rules only work at ZERO/ALWAYS thresholds. "1 in 5 posts should mention the product" silently degrades to "every post mentions the product" because the LLM can't count across sessions.

• Memory and instructions decay together. Change a rule in CLAUDE.md? Update the lesson DB row that contradicts it, or the agent will follow stale memory over the new instruction. Memory wins ties.

• Fix-on-fix commits are a systemic-failure signal. If a bug takes 3+ attempts to land, stop pushing and read the platform docs.

• "Production" was running in week 2. "Production-ready for paying customers" took until week 10. The first ships in a weekend. The second is the actual job.

If you're building anything with Claude Code, Cursor, Codex, or Cline — the gate pattern is free and MIT: `npx thumbgate init`.

What's the most expensive AI-agent mistake you've watched on repeat?

---

## Draft B — The hook-led one

I wrote the words "deployed" 3 times in a row about a build that never deployed.

So I built a gate that physically blocks me from saying it again. 70 days later, ThumbGate is live, MIT, on npm, and has caught those exact false-positive ship claims 14 times in the agent's own logs.

The full build log — including what I'd do differently — is up:

→ https://thumbgate.ai/learn/from-prototype-to-production

70 days, 17 minor releases, ~6k installs, one solo founder, $0 in cold-traffic revenue (yet). The honest version.

Stack: Claude Code as autonomous CTO + a strict CLAUDE.md contract + Railway + Stripe + SQLite+FTS5 + LanceDB. Two-repo split: public npm shell, private intelligence core.

What's the last thing your AI agent told you was "done" that wasn't?

---

## Draft C — The category-defining one

"AI guardrails" is the new "blockchain for X" — every tool claims them, almost none enforce them.

ThumbGate enforces. Pre-action gates that block the tool call before it fires, not a linter after, not a chat warning before. 70 days from `git init` to a live production stack at thumbgate.ai. Build log, with numbers:

→ https://thumbgate.ai/learn/from-prototype-to-production

What's in it:
• How I shipped 17 minor versions in 70 days, solo, with Claude Code as the engineer
• Five lessons I'd give my March-3 self (including the one that cost me a 5-commit CSS chase)
• The part where I admit cold-traffic conversion is still zero — and what I'm doing about it next
• Stack details: SQLite+FTS5 lesson DB, LanceDB vectors, Thompson Sampling, ContextFS

Free version is `npx thumbgate init`. Pro is $19/mo. The product is MIT. The dashboard, recall, and lesson search are gated to Pro.

Where are you running into "the agent did the same thing wrong again"?

---

## Posting checklist

- Post from Igor Ganapolsky personal account (not a company page — solo-founder narrative reads more authentic from a person)
- Add as the first comment, not the body: a follow-up with a one-line install (`npx thumbgate init`) and the GitHub link
- Tag 0 people initially. Tag specific friends only if the post starts to move (>5 reactions in first hour)
- Best post window: Tue–Thu 7–9am US Eastern (when AI/dev LinkedIn is active)
- DO NOT use ThumbGate's automated post-everywhere pipeline for this — handwritten posts outperform templated ones on LinkedIn by ~3x for engineering audiences. Use only Reddit/Bluesky for the templated reach.

## Engagement playbook (first 4 hours after posting)

1. Reply to every comment within 30 min for the first 2 hours (LinkedIn's algorithm heavily weights early-reply velocity).
2. If anyone asks "does this work with X" — answer with the specific install command, not a "yes."
3. Pin the post to your profile for 7 days.
4. After 24h, repost it as a comment thread on r/ClaudeAI or r/cursor with the same hook (different platform tone).
