# RAG Improvements Report

Improvements driven by Super Data Science episode #1017 ("The RAG Mistake Almost
Every Team Is Making") and dogfooded through the ThumbGate Reliability Gateway.

## 1. Embedding model choice is gated, not guessed

- `require-matryoshka-embedding-dimension` gate enforces Matryoshka-aware
  dimensions (e.g. 384/512/768) instead of arbitrary vector sizes.
- `block-embedding-recall-below-threshold` gate blocks models whose deterministic
  recall fails the 95% floor.
- `require-embedding-baseline-before-tuning` gate demands a golden-case baseline
  before any hyperparameter tuning is accepted.

## 2. Retrieval is dedupe-aware and time-aware

- Dedupe-aware candidate pool: duplicate lessons do not crowd out distinct
  evidence (PR #3376).
- Slot backfill keeps candidate diversity when the pool is overfull.
- Temporal decay weighting (`scripts/temporal-decay-weighting.js`): lessons age
  out of relevance with a configurable half-life instead of polluting retrieval
  forever.

## 3. Memory lifecycle enforced

- Memory compaction CLI removes oversized/transcript blobs (PR #3376).
- Memory retrieval rejects transport transcripts and oversized blobs.
- Cross-user retrieval requires complete entity/project/process/session scope.

## Verification

- Golden-case RAG eval: >= 6 cases, >= 95% deterministic recall, >= 15%
  precision, 100% per-case recall (fail closed).
- Full test suite: see CI run on the merged commit.

## Dogfood evidence

- Memory-compaction case study (#6) in `docs/THUMBGATE-CASE-STUDIES.md`.
- Dynamic email subject generator in `scripts/generate-case-study-outreach.js`.
