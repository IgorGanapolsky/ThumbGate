---
name: show-me
description: >
  Answer architecture / control-flow questions with a compact visual format
  (component tree, call stack, mermaid, annotated diff) instead of prose walls.
  House steal of ExplainX /show-me FORMAT — not affiliated. Slash: /show-me.
---

# /show-me — draw, don't ramble

Inspired by ExplainX trending #9 (score 87): *The /show-me Skill* — the
**format menu is the product**. The model can already draw; the skill makes
format selection deterministic.

## When

Architecture, PreToolUse/gate flow, adapter wiring, "what calls what", PR blast
radius, session lease ownership. Prefer this over a paragraph dump.

## Format menu (pick one)

| Format | When it wins |
|--------|----------------|
| Component / module tree | Who owns which state or gate |
| Call stack | Orchestration order |
| File layout | Directory + one-line responsibility |
| Mermaid sequence | Multi-party over time (agent → hook → API) |
| Mermaid state | Modes + transitions (lease, merge, deploy) |
| Annotated diff | What changed at structure level |
| Pseudocode | Branching logic without language noise |

## ThumbGate vocabulary (house version)

Prefer these labels when drawing: `PreToolUse`, `gate-check`, `session-lease`,
`lesson-retrieval`, `graphify`, `Trunk`, `Railway /health`, `containerTag/scope`.

## Never

- Diagram slop on non-visual questions
- Install `humanlayer/skills` blindly — this file is the house skill
- Claim affiliation with ExplainX or HumanLayer
- Replace `graphify path/query` when `graphify-out/graph.json` exists — fuse both

## Companion

```bash
npm run explainx:trending -- --fixture tests/fixtures/explainx-trending-rsc-snippet.html
.graphify-venv/bin/graphify path "<A>" "<B>"   # when graph exists
```
