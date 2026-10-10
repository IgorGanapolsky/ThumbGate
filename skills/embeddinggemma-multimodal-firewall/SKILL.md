---
name: embeddinggemma-multimodal-firewall
description: "Google DeepMind EmbeddingGemma 2 architectural steal: 8K token context window, unified 768d multimodal representation, Matryoshka Representation Learning (MRL 256d fast-gate), and sub-0.5ms PreToolUse invariant gating on local CPU with zero cloud tokens."
---

# EmbeddingGemma 2 Multimodal Firewall (DeepMind Steal)

Replaces brittle, single-modality 512-token embeddings with **8K-context, sub-0.5ms MRL-truncated multimodal pre-action interdiction** that costs **$0 in cloud tokens**.

## Commands

```bash
# Run system doctor diagnostic
npm run embeddinggemma:doctor

# CLI diagnostic (JSON or text)
npx thumbgate embeddinggemma --json

# Run unit test suite
node --test tests/embeddinggemma-adapter.test.js
```

## Architectural Pillars

1. **8K Context Window**: Ingests up to 8,192 tokens (~32KB chars) without chunking, capturing entire multi-file diffs and terminal stack traces.
2. **Matryoshka Representation Learning (MRL)**: Native 768d truncates to 256d fast-gate with unit L2 re-normalization, cutting dot product compute by 66.7% for `<0.5ms` PreToolUse firewall evaluation.
3. **Multimodal State Unification**: Maps visual UI DOM/screenshots (BrowserOS Neo / Playwright) and bash commands into the same vector space.
4. **Fail-Closed RAG Identity Diode**: Blocks cross-model vector distance calculations to prevent embedding pollution.
