---
name: activesaddler-curriculum-honesty
description: ActiveSaddler (arXiv:2610.00906) non-stationary bandit curriculum steal. Dynamically abstracts agent mistake patterns into failure-pattern arms, reorders pre-tool evaluation for fail-fast execution (<0.5ms), and detects regression drift without external RL/PyTorch dependencies.
---

# ActiveSaddler Dynamic Curriculum Honesty (FORMAT Steal)

Stolen from ActiveSaddler (*Automated Curriculum Learning for Agent Harness Optimization*, arXiv:2610.00906).

## Core Posture

- **Verdict**: `COMPARE_NOT_CLONE`.
- **Anti-Clone Boundary**: NEVER install PyTorch, Ray, Stable-Baselines, or heavy RL packages. Keep all bandit math CPU-local and sub-millisecond.
- **Fail-Fast Rule Reordering**: Evaluate rules with highest discounted failure risk first to terminate invalid actions in <0.5ms before secondary rules run.

## Key Invariants

1. **Failure-Pattern Arms**: Track pulls, violations, and discounted statistics per mistake pattern.
2. **Discounted UCB Policy**: Apply decay factor $\gamma = 0.92$ to discount historical observations while exploring uncertain arms.
3. **Drift Detection**: When a single failure pattern exceeds 60% of recent violations, elevate its interdiction priority and notify the reliability gateway.

## Verification Commands

```bash
node scripts/activesaddler-curriculum-doctor.js
node scripts/activesaddler-curriculum-doctor.js --json
node scripts/activesaddler-curriculum-doctor.js --map-only
node --test tests/activesaddler-curriculum-doctor.test.js
```
