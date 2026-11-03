# AA Personality Bench: Trait-Based Model Routing

## Steal Source
"Why AI Companies Are Betting Personality Beats Intelligence" (Ep 97)

## Problem
Routing models by raw accuracy ignores that two models can give equally correct answers while feeling completely different. Tasks requiring objective pushback fail with overly friendly models.

## Pattern Stolen
The **AA Personality Bench** scores models across 8 indices:

| Index | Use Case |
|-------|----------|
| **Expressiveness** | Creative writing, narrative generation |
| **Organization** | Structured output, code structure, test generation |
| **Informativeness** | Technical docs, edge case analysis |
| **Transparency** | Reasoning chain exposure, audit logs |
| **Warmth** | Customer-facing responses (AVOID for security reviews) |
| **Conviction** | Security pushback, regression detection (AVOID sycophancy) |
| **Imagination** | Strategic brainstorming, architecture exploration |
| **Slop** | FILTER OUT — filler/generic phrasing in concise outputs |

**Key insight**: Route semantic checks by personality, not just capability. `goal_alignment` needs high Transparency + Conviction (objective pushback). `edge_case_coverage` needs high Organization + Informativeness (thoroughness).

## How ThumbGate Applies It
`config/verifier-criteria.json` — `modelRouting.personalityBench.semanticCheckRouting`:

```json
{
  "goal_alignment": { "need": ["transparency", "conviction"], "avoid": ["warmth", "slop"] },
  "edge_case_coverage": { "need": ["organization", "informativeness"], "avoid": ["slop"] },
  "regression_check": { "need": ["conviction", "organization"], "avoid": ["warmth", "slop"] },
  "design_compliance": { "need": ["transparency", "conviction"], "avoid": ["warmth", "slop"] }
}
```

## Implementation
- `config/verifier-criteria.json` — `modelRouting.personalityBench` section
- `scripts/isolated-verifier.js` — fast-track path runs only `goal_alignment` (transparency + conviction check)

## Pro Value
Pro adds:
- 64 additional personality indices (beyond 8)
- Real-time model personality scoring against your codebase
- Personality-matched feedback routing (warmth for customer msgs, conviction for security review)
- Per-check personality override for custom workflows

**Steal command**: `npx thumbgate init` → select "personality-routing-pack"
