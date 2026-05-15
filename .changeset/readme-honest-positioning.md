---
"thumbgate": patch
---

README + LAUNCH_POSTS docs honesty pass triggered by [r/ClaudeCode comment thread](https://www.reddit.com/r/ClaudeCode/comments/1tc2k1z/comment/oll1dua/). Three corrections:

1. **"No LLM in enforcement" needs the qualifier.** Layer 2 description now distinguishes the deterministic runtime gate decision (literal pattern + AST + scoped lookup, zero LLM) from offline retrieval (local CPU-only `bge-small` embeddings via LanceDB — a model, but no external API call and no inference cost beyond CPU).
2. **Thompson Sampling does NOT select rules.** Old framing said "Thompson Sampling for adaptive rule selection" / "multi-armed bandit rule selection" which implied the bandit decides whether a rule fires. Corrected: TS tunes per-rule confidence weights for soft-gating rules. Hard rules ("block force-push to main") always fire deterministically — bandit exploration would be terrifying for hard rules.
3. **Cross-agent propagation + learning loop is the lead differentiator vs hand-rolled hooks.** Layer 4 description now explicitly answers "why ThumbGate over Claude Code's `permissions.deny` or a custom `PreToolUse` script": (a) checks propagate cross-agent over MCP — thumbs-down on Cursor blocks the same pattern on Claude Code, Codex, Gemini in the next session; (b) every feedback event becomes a fresh rule and tunes existing ones, so the corpus sharpens without an operator hand-writing patterns for every new mistake shape.
