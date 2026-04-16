# Show HN: ThumbGate — Stop paying tokens for the same AI coding mistake twice

**Status:** current · updated for token-cost positioning (Apr 2026)

---

## Title (80 chars max, HN strict)

```
Show HN: ThumbGate – stop paying tokens for the same AI coding mistake twice
```

Length: 75 chars. Fits. If moderators rename, fallbacks:

1. `Show HN: ThumbGate – block repeat AI agent mistakes before the next tool call`
2. `Show HN: Pre-action gates for Claude Code, Cursor, Codex, and other MCP agents`

## URL field

```
https://github.com/IgorGanapolsky/ThumbGate
```

Not the landing page. HN readers trust the repo. The README does the selling.

## Post body (paste into the text field at https://news.ycombinator.com/submit)

```
I got tired of watching Claude Code force-push to main, catching it,
thumbs-downing it, and then seeing the exact same mistake next Monday.
Every retry is a billable token. Across one week, across every developer
on a team, the math gets ugly — the same lesson, paid for over and over.

ThumbGate is a local MCP server that turns one thumbs-down into a
Pre-Action Gate. The next time any MCP-compatible agent tries that same
tool call, a PreToolUse hook intercepts it BEFORE the round-trip to the
model. Zero input tokens, zero output tokens, zero retry loop.

A concrete example, same workflow across two sessions:

  Session 1:  Agent force-pushes to main.  I fix it + 👎   +4,200 tokens
  Session 2:  ⛔ Gate blocked the force-push              +0 tokens
  Session 3+: Never happens again                         +0 tokens

How it works under the hood:
  - SQLite + FTS5 lesson DB for text recall
  - LanceDB vectors for semantic recall (MemAlign dual recall)
  - Thompson Sampling promotes high-confidence gates, retires quiet ones
  - PreToolUse hook evaluates every tool call against active gates
  - All data stays on disk — no cloud, no telemetry, no "send prompts to
    our server" pattern

It speaks MCP stdio, so it plugs into Claude Code, Claude Desktop,
Cursor, Codex CLI, Gemini CLI, Amp, OpenCode — anything that speaks the
protocol. One correction in Claude Code also protects your Cursor session.

Free tier: 3 captures/day, 1 rule, 1 agent. Enough to prove one blocked
repeat on a real workflow. Pro is $19/mo for unlimited captures + a
local dashboard showing tokens-saved since install (Sonnet-blended
estimate, conservative). Team is $49/seat/mo for a shared hosted
lesson DB.

Install:
  npx thumbgate init

Honest limitations:
  - It's context engineering + enforcement, not fine-tuning. Model
    weights don't change.
  - Pattern-match + semantic similarity is imperfect. A gate tuned too
    broad false-positives; too narrow misses variants. Thompson
    Sampling helps but doesn't eliminate the tradeoff.
  - Demo video on the landing page is deliberately short — recording a
    longer walkthrough this week.

Would genuinely love feedback on the Pre-Action Gate model vs.
alternatives (CLAUDE.md, .cursorrules, prompt-level constraints). The
core argument is that suggestions the agent can ignore aren't the
same thing as a hook that physically intercepts the call.

Repo: https://github.com/IgorGanapolsky/ThumbGate
npm:  https://www.npmjs.com/package/thumbgate
Live: https://thumbgate-production.up.railway.app/dashboard
```

Word count: ~370. Well under HN's soft 2000-char comfort zone, long enough to actually explain the thing.

## Why this copy and not the old "persistent memory" draft

- **Pain-first, not feature-first.** HN skims. Lead with the force-push scenario, not "MCP server with LanceDB." Architecture lives three paragraphs down where curious readers dig.
- **Concrete token math.** HN respects numbers. "$0.21 for the same mistake three times" is sticky; "gives agents persistent memory" is wallpaper.
- **Honest limitations paragraph.** HN upvotes humility. Preempt "but pattern matching is brittle" — name it first.
- **Explicit contrast with CLAUDE.md / .cursorrules.** That comment thread happens every time. Frame it yourself.
- **Closing question inviting disagreement.** HN rewards posts that welcome pushback over posts that defend.
- **No "launched!" / "proud to share" / "excited to announce".** HN allergic.

## Submission timing

- **Best window:** Tuesday or Wednesday, **8:30–9:30 AM Pacific** (before SF wakes, after East Coast is awake). Avoid Monday (too much noise) and Friday (dead).
- **Worst window:** weekends, holidays, anything after 2 PM Pacific.
- **Don't submit during:** OpenAI event, Anthropic Claude release day, Apple keynote — you'll get buried.
- **One shot per calendar quarter.** Dang (HN moderator) actively de-ranks resubmissions.

## Day-of ops

1. Submit → immediately copy the post URL.
2. First comment from you within 2 minutes: a short meta note like *"Happy to dig into the Pre-Action Gate architecture, the DPO export format, or the tradeoffs vs. agent-side memory. AMA."* This anchors the top comment to you, not to a drive-by criticism.
3. Reply to every substantive comment within 15 minutes for the first 90 minutes. HN front-page placement is a function of *engagement velocity*, not just upvotes.
4. **Do not** ask for upvotes anywhere. Do not post the link in Slack asking people to vote. HN catches vote rings and penalizes.
5. If the post dies on /new (no votes in 30 min), don't panic — it usually takes 2–4 organic upvotes to leave /new.
6. If hellbanned / shadowbanned, email hn@ycombinator.com with the submission URL. Dang reviews manually; it's often a false-positive.

## Expected outcome

- **Best case:** front page for 6–10 hours, 150–400 comments, 20k–50k visits, 300–800 GitHub stars in 48 hours, 30–80 free installs, 2–5 Pro trials.
- **Realistic case:** back-of-front-page for 2–3 hours, 30–80 comments, 3k–8k visits, 40–100 stars, 10–20 installs, 0–1 Pro trial.
- **Worst case:** stalls at 3 upvotes on /new, 500 visits, 5 stars. Still worth it for the archival Google juice — HN pages rank on long-tail queries.

## Pre-submit checklist

- [ ] Repo README is the current token-cost version (not the old "persistent memory" hero)
- [ ] Demo video is visible in hero (not buried in `<details>`)
- [ ] `/dashboard` loads on the hosted Railway URL (no 500s, no stale version)
- [ ] `/health` returns the current `package.json` version
- [ ] `npx thumbgate init` works on a fresh machine — test on a spare laptop or fresh VM before submitting
- [ ] GitHub repo "About" section updated to match the new positioning
- [ ] `npm publish` the latest version so `npx thumbgate` serves the newest code
- [ ] Dashboard has actual demo data (or demo-mode renders) so visitors see receipts, not an empty table

## Don't post until all 8 boxes are checked

A Show HN with broken links is worse than no Show HN. HN remembers. One retry; no second chance.
