# Multi-Variant Exploration Steal

## Steal Source
YouTube: "How to Build an AI Operating System" (DgX3XqhIhas, timestamps 14:17-20:25)

## Problem
Founders design products for themselves, not users. Teams bet on a single option. Single points of failure in architecture decisions.

## Pattern Stolen

### 1. Build 3-10 Variants Simultaneously
Don't argue over a roadmap choice. Build the founder's vision **plus** 2+ user-centric variants. Test all three against real metrics.

### 2. Founder Vision + User-Centric Variants
Founders see the world through their lens. Always build:
- **V0**: Founders exact vision
- **V1**: Data-driven variant (from user metrics)
- **V2**: Counter-intuitive variant (something the data contradicts)

### 3. Discard Failfast
Set upfront criteria for what "success" looks like. Automatically kill underperforming variants without debate.

## How ThumbGate Applies It

`scripts/multi-variant-explorer.js`:
- Generates N variant implementations from a single prompt
- Runs each variant through the **full Isolated Verifier** (61 checks)
- Scores by quality, performance, security, and cost
- Auto-discards variants that fail >3 checks

```javascript
// Example: 5 variants of a rate limiter
const variants = exploreVariants({
  task: 'Implement a rate limiter with burst capacity',
  count: 5,
  models: ['deepseek-7b', 'glm-4-9b', 'qwen3-4b'], // route per personality bench
  gate: 'strict', // pre-action checks on each variant
});

// Output: ranked list with scores + verification results
// V1: deepseek-7b → 93/100, 61 checks pass, 0.4ms latency
// V2: glm-4-9b → 87/100, 58 checks pass (3 edge case failures)
// V3: qwen3-4b → 96/100, 61 checks pass, 0.3ms latency ← winner
```

### Discard criteria
- Any BLOCK lesson triggered → discard
- >2 check failures → discard
- Latency >2x budget → discard
- Security finding in audit → discard

## Pro Value
Pro adds:
- Cross-model variant synthesis (combine good parts from 5 variants)
- Continuous variant evolution (breed + mutate winning variants)
- Multi-repo variant testing (test against 3 customer repos simultaneously)

**Steal command**: `npx thumbgate init` → select "multi-variant-pack"
