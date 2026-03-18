# I built an MCP server that stops Claude Code from repeating the same mistakes

If you use Claude Code daily, you've hit these:

1. New session, Claude has zero memory of what you established yesterday
2. Claude says "Done, all tests passing" — you check, and nothing passes
3. You fix the same issue for the third time this week because Claude keeps making the same mistake

I got tired of it, so I built [mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) — an MCP server that adds a reliability layer on top of Claude Code.

## How it works

It runs an RLHF-style feedback loop. When Claude does something wrong, you give it a thumbs down with context. When it does something right, thumbs up. The system learns from both.

But the key insight is that memory alone doesn't fix reliability. You need enforcement. So the server exposes four MCP tools:

- `capture_feedback` — structured up/down signals with context about what worked or broke
- `prevention_rules` — automatically generated rules from repeated mistakes. These get injected into Claude's context before it acts.
- `construct_context_pack` — bounded retrieval of relevant history for the current task. No more "who are you, where am I" at session start.
- `satisfy_gate` — pre-action checkpoints. Claude has to prove preconditions are met before proceeding. This is what kills hallucinated completions.

## Concrete example

I kept getting bitten by Claude claiming pricing strings were updated across the codebase when it only changed 3 of 100+ occurrences. After two downvotes, the system generated a prevention rule. Next session, Claude checked every occurrence before claiming done.

Another one: Claude would push code without checking if CI passed. A `satisfy_gate` for "CI green on current commit" stopped that pattern cold.

## Pricing

The whole thing is free and open source. There's a $49 one-time Pro tier if you want the dashboard and advanced analytics, but the core loop works without it.

- Repo: https://github.com/IgorGanapolsky/mcp-memory-gateway
- 466 tests passing, 90% coverage. Happy to answer questions.

**Disclosure:** I'm the creator of this project. The core is free and MIT licensed. The Pro tier ($49 one-time) funds continued development.
