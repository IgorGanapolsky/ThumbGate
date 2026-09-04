---
name: jit-harness-compare-not-clone
description: >
  JIT-Agent (arXiv:2608.25593) is a harness-intelligence model, not a ThumbGate
  clone. Steal the four-module FORMAT (memory/planning/action/capability) onto
  existing rails; never train or download JIT-Agent. Slash: /jit-harness-compare-not-clone.
---

# JIT-Agent — compare, do not clone

## When
JIT-Agent, arxiv 2608.25593, Rohan Paul harness intelligence, Model-as-a-Harness,
just-in-time harness evolution, HarnessFactory, four-module agent harness.

## Do
```bash
npx thumbgate jit-harness-compose --task="<what the agent should do>" --json
npx thumbgate jit-harness-compose --map-only
```

Map modules to existing rails:
- **memory** → lesson-retrieval / feedback / contextfs
- **planning** → `bin/agent-loop` Plan + GSD
- **action** → PreToolUse gates + `harness-selector` + `switchyard-router`
- **capability** → `subagent-profiles` + MCP allowlists + skills + model pool

## Never
- Train, serve, or download JIT-Agent-27B / `huggingface.co/JIT-Agent`
- Clone `bingreeky/JIT` HarnessFactory into ThumbGate
- Emit free-form harness programs as a new SKU
- Claim ThumbGate is JIT-Agent

## Source
https://arxiv.org/abs/2608.25593 · https://github.com/bingreeky/JIT — FORMAT only; not affiliated.
