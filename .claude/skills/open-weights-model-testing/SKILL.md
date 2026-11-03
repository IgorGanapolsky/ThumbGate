# Open-Weights Model Testing Steal

## Steal Source
YouTube: "How to Pick the Right AI Model in 2026" (FSX5FJS9PQ)

## Problem
Teams overpay for frontier models when open-weights alternatives (Kimi K3, DeepSeek, GLM 5.3) match quality at fraction of cost. No systematic way to test alternatives.

## Pattern Stolen

### 1. Test Off-the-Shelf First
Before reaching for frontier API, test 3-5 open-weights models locally. Kimi K3 and DeepSeek often match frontier quality at 0 cost (local inference).

### 2. Use Benchmarks as a Testing Rubric, Not a Leaderboard
- Don't search for "best overall" — search for "best for THIS task"
- Re-test discarded models with task-specific prompts
- Use trait indices as rubric: route based on what the model needs to be good at

### 3. Separate Creative from Analytical Routing
- Creative brainstorming → high Imagination index (Opus 5.5 tops here)
- Business strategy pushback → high Conviction, avoid Warmth
- Legal/compliance → pragmatic directness

### 4. Watch the Slop Index
- Filter out models scoring high on filler/generic phrasing
- Gemini 4 Argon example: high Warmth = high Slop in concise contexts
- When output must be tight, route to low-Slop models

## How ThumbGate Applies It

`scripts/test-open-models.js`:
- Tests 5 open-weights models (DeepSeek-7B, Kimi-VL, GLM-4-9B, Qwen3, Llama-3.3)
- Runs them through 12 representative tasks (code gen, reasoning, security review)
- Scores each model on all 8 personality indices
- Generates a routing recommendation table

```bash
node scripts/test-open-models.js --format compact
# Output: 542 bytes (vs 2,918 bytes JSON) = 81% savings with OpenUI Lang format
```

## Implementation

```javascript
// Personality indices for each model
const MODEL_PERSONALITY = {
  'deepseek-7b': {
    expressiveness: 4, organization: 9, informativeness: 8,
    transparency: 7, warmth: 3, conviction: 8,
    imagination: 5, slop: 2,
  },
  'kimi-k3': {
    expressiveness: 7, organization: 8, informativeness: 9,
    transparency: 6, warmth: 4, conviction: 7,
    imagination: 8, slop: 3,
  },
  'glm-4-9b': {
    expressiveness: 9, organization: 7, informativeness: 7,
    transparency: 8, warmth: 6, conviction: 5,
    imagination: 8, slop: 4,
  },
  'qwen3-4b': {
    expressiveness: 3, organization: 8, informativeness: 8,
    transparency: 9, conviction: 8, imagination: 4,
    slop: 1,
  },
  'llama-3.3-70b': {
    expressiveness: 6, organization: 9, informativeness: 8,
    transparency: 7, warmth: 5, conviction: 7,
    imagination: 6, slop: 3,
  },
};
```

## Pro Value
Pro adds:
- Real-time local model inference testing (no API calls)
- Automated cost comparison (local compute vs API dollars)
- Continuous personality profiling (models drift over time)
- Multi-variant A/B testing framework

**Steal command**: `npx thumbgate init` → select "open-weights-testing-pack"
