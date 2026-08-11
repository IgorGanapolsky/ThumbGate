# Temporal Decay Weighting for Lesson Retrieval

Inspired by Super Data Science episode #1017 — "The RAG Mistake Almost Every Team Is
Making". The core insight: vector similarity alone is insufficient for lesson
retrieval. Outdated lessons pollute results when relevance decays over time.

## What this module adds

- `applyTemporalDecay(rawScore, lessonTimestamp, halfLifeMs, activeMode)` — halves
  a similarity score after `halfLifeMs` (default 30 days).
- Configurable TTL for lesson relevance.
- Active-mode flag: slower decay while an incident is being investigated vs.
  maintenance mode.

## Usage

```js
const { applyTemporalDecay } = require('./scripts/temporal-decay-weighting');

const score = applyTemporalDecay(0.87, '2026-07-01T00:00:00Z', 30 * 24 * 3600 * 1000, true);
```

## Why it matters for ThumbGate

The Infrastructure Firewall enforces lessons learned from past mistakes. If a
prevention rule is six months old, it should not carry the same weight as one
recorded this week. Temporal decay keeps the enforcement layer honest and current.

## Integration points

- Retrieval scoring pipeline (RAG).
- Feedback-to-enforcement loop: thumbs → lessons → prevention rules.
- Any agent-memory search that orders by embedding similarity only.

See `RAG_IMPROVEMENTS_REPORT.md` for the full improvement list.
