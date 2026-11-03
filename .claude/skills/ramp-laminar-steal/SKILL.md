# Ramp/Laminar: Harness-Level Model Routing (64% Cost Cut)

## Steal Source
The New Stack: "Ramp built an AI agent harness in six weeks" (Oct 2026)

## Problem
Generic LLM gateways route based on prompt size or token count. They don't know what the agent is actually doing — so they can't make optimal model choices.

## Pattern Stolen
Ramp's Laminar places model routing **inside the agent harness** because the harness already knows which prompts, tools, and domain context are involved. Across 973 agent threads, this cut median LLM cost from $2.61 to $0.94 (64% drop) without performance loss.

## How ThumbGate Applies It
Each verifier check carries a `modelHint` (`local` or `cloud`):

- **Local tier**: `unit_tests`, `coverage_threshold`, `perf_budgets`, `self_heal`, `proof_pack_integrity` — all run on-device with zero cloud cost
- **Cloud tier**: semantic checks that require heavy reasoning (only when fast-track doesn't trigger)

```json
{
  "id": "unit_tests",
  "command": ["npm", "test"],
  "modelHint": "local"
}
```

## Implementation
- `config/verifier-criteria.json` — `modelRouting` section with `hints`, `default`, and `personalityBench`
- `scripts/isolated-verifier.js` — fast-track uses local model for `goal_alignment` only

## Pro Value
ThumbGate Pro extends model routing to 127 additional checks, including provider-specific routing (Claude Code, Cursor, Codex, Git, AWS). The open verifier only routes local/cloud; Pro adds per-provider tier selection.

**Steal command**: `npx thumbgate init` → select "model-routing-pack"
