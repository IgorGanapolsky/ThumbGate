---
name: multi-harness-rl-invariants
description: >
  Cross-harness RL invariant engine stolen from Hugging Face FineEnvs (multi-harness-rl).
  Normalizes tool invocations across Claude Code, Antigravity, Strands, and OpenHands,
  catches catastrophic format failures, and computes cross-harness transfer reward signals.
---

# Multi-Harness RL Invariants — Cross-Harness Generalization

## The Research Finding (FineEnvs / Orchard 2026)

Models trained inside a single agent harness (e.g. OpenHands or Claude Code) experience severe performance drops when deployed to a foreign harness:
- **Catastrophic Format Failure:** Models hallucinate parameters, emit broken JSON, or fail to parse shell tool outputs when moving to another harness.
- **Degraded Resolve Rate:** OpenSWE-32B drops 58.8 points (from 62.4% down to 3.6%) when transferring to Kimi-CLI.
- **Harness Overfitting:** Swapping the harness moves benchmark resolve rates by up to 13 points, while swapping the underlying model moves scores by only 2.5 to 5 points.

## The ThumbGate Architecture

ThumbGate acts as the universal **Canonical Action Normalizer & Invariant Gateway**:

```text
[Claude Code] ──┐
[Antigravity] ──┼─► [Canonical Action Quadruplet] ──► [Cross-Harness Invariant Diode] ──► [Target System]
[Strands]     ──┤    (entity, op, target, params)     (Format, Security, Bounds)
[OpenHands]   ──┘
```

### 1. Canonical Action Quadruplets
Regardless of the model's originating harness, every action is normalized into:
- `harness`: Source harness (`claude_code`, `antigravity`, `strands`, `openhands`, `terminus`)
- `domain`: `shell`, `filesystem`, `network`, `generic`
- `operation`: `exec`, `read`, `write`, `delete`
- `target`: Command line string, file path, or URL
- `payload`: Contextual arguments

### 2. Format & Safety Invariant Gates
- Prevents command injection and forbidden operations (`rm -rf /`, `git push --force origin main`, `gh pr merge --admin`).
- Blocks path traversal (`../../../etc/passwd`).
- Evaluates before any execution occurs.

### 3. Transfer Scorecard & RL Rewards
Calculates multi-harness diversity multipliers and invariant pass rates for RL / DPO model training:
```bash
node scripts/strands-box-doctor.js --json
```
