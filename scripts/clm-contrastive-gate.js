#!/usr/bin/env node
'use strict';

/**
 * Contrastive Language Model (CLM) System One Gate
 * 
 * IDEA STOLEN FROM: https://github.com/Contrastive-LM/CLM
 * 
 * CLM proposes that System One decision-making (fast, low-latency, generalized) 
 * can be achieved by:
 * 1. Disaggregating states (the current context) and actions (the choices).
 * 2. Caching action embeddings independently so they are computed only once.
 * 3. Passing state embeddings through a `State Head` and action embeddings through 
 *    an `Action Head`.
 * 4. Computing choice probabilities via `softmax(scale * cosine(state_proj, action_proj))`.
 * 
 * ThumbGate Integration:
 * We apply this to `thumbgate_gate_check`. Instead of a slow LLM call to evaluate 
 * safety, we project the incoming `toolInput` (State) and our deterministic safety 
 * policies (Actions) into a shared contrastive space.
 */

const crypto = require('node:crypto');
const fs = require('fs');

const RAW_SCALE = 100.0; // CLM-raw scaling factor

// Simulated lightweight projection matrices (would be learned via contrastive fine-tuning)
// For now, we use identity projections to demonstrate the architectural shift.
function projectState(embedding) {
  // CLM state head
  return embedding; // TODO: Load trained State Head weights
}

function projectAction(embedding) {
  // CLM action head
  return embedding; // TODO: Load trained Action Head weights
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

class SystemOneContrastiveGate {
  constructor(embedder) {
    this.embedder = embedder;
    this.actionCache = new Map(); // Implements CLM's disaggregated action caching
  }

  /**
   * Pre-computes and caches action embeddings (ThumbGate Prevention Rules).
   * CLM Insight: Action spaces are finite and static during a session.
   */
  async warmup(choices) {
    for (const [id, description] of Object.entries(choices)) {
      if (!this.actionCache.has(id)) {
        const rawEmbedding = await this.embedder.embed(description);
        const projAction = projectAction(rawEmbedding);
        this.actionCache.set(id, projAction);
      }
    }
  }

  /**
   * Evaluates a tool call (State) against cached policies (Actions).
   * CLM Insight: 9x lower latency because options are already embedded.
   */
  async evaluate(stateText, choices) {
    // 1. Ensure action cache is warm
    await this.warmup(choices);

    // 2. Embed the incoming state (tool call context)
    const rawStateEmbedding = await this.embedder.embed(stateText);
    const projState = projectState(rawStateEmbedding);

    // 3. Compute logits: scale * cosine
    const candidateIds = Object.keys(choices);
    const logits = candidateIds.map(id => {
      const projAction = this.actionCache.get(id);
      return RAW_SCALE * cosineSimilarity(projState, projAction);
    });

    // 4. Softmax distribution
    const probabilities = softmax(logits);
    const result = candidateIds.map((id, index) => ({
      candidate: id,
      prob: probabilities[index]
    }));

    result.sort((a, b) => b.prob - a.prob);
    return result;
  }
}

module.exports = { SystemOneContrastiveGate };
