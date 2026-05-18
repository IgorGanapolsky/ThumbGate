---
"thumbgate": patch
---

New article: `/learn/agent-swarms-shared-gates` — explains why multi-agent swarms pay N&times; the token cost on every repeated mistake without shared safety memory, and how a single MCP gate layer makes Opus, GPT, and Gemini fail the same way only once.

Captures real search intent ("agent swarm token cost", "multi-agent shared memory", "agent swarm shared state") and grounds the claim in ThumbGate's actual architecture: one feedback dir, one PreToolUse hook, model-agnostic pattern matching, JSONL append-only feedback log that handles concurrent captures from multiple agents.

Honest framing: explicitly states what a shared gate layer does NOT solve (work routing, model selection, load balancing — that's the swarm framework's job). Linked from the learn index.
