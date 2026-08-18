# One-line discovery posts (tom_doerr format)

Format study (2026-08-18): @tom_doerr's repo-discovery posts are a single plain
sentence stating what a repo does, plus the link — no hype, no thread, no emoji.
A post in that format about an RL trading repo drew ~5,200 views with 35 bookmarks
from one sentence. The format works because it reads like a bookmark, not an ad.

Rules for using these drafts:
- One sentence. No adjectives like "amazing". No hashtags on Bluesky/Threads.
- Post at most one per channel per week; never repeat a draft on the same channel.
- These are DRAFTS for human review before posting — not wired to any auto-poster.

## Drafts

1. Runs in your coding agent's PreToolUse hook and evaluates every proposed tool
   call against your own recorded failures before it executes.
   https://github.com/IgorGanapolsky/ThumbGate

2. Turns your thumbs-down feedback into local prevention rules that stop an AI
   coding agent from repeating the same command that broke things last week.
   https://github.com/IgorGanapolsky/ThumbGate

3. Local-first firewall for AI coding agents — secret-leak attempts are blocked
   before the tool call runs, and everything is logged to a local dashboard.
   https://github.com/IgorGanapolsky/ThumbGate

4. Five-phase guide to building a completely local, self-improving pre-action
   firewall for Claude Code, Cursor, or Codex — each phase ends with a verify step.
   https://github.com/IgorGanapolsky/ThumbGate/blob/main/GUIDE.md

5. Captures agent mistakes as SQLite lessons, then promotes repeated failures into
   blocking gates — context engineering plus enforcement, no model retraining.
   https://github.com/IgorGanapolsky/ThumbGate

6. MCP server that gives any MCP-capable agent a pre-action gate-check tool plus a
   feedback-capture loop that persists across sessions.
   https://github.com/IgorGanapolsky/ThumbGate
