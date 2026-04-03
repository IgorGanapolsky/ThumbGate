#!/usr/bin/env node
'use strict';

/**
 * Synthetic DPO Pair Augmentation — expands real feedback into larger training datasets.
 *
 * Takes existing DPO pairs (from export-dpo-pairs.js) and generates synthetic
 * variations to increase dataset size for fine-tuning:
 *
 * 1. Principle extraction: generalize specific errors into abstract rules
 * 2. Contrastive pairing: match unpaired errors/learnings by domain similarity
 * 3. Scenario variation: rephrase prompts for the same chosen/rejected pair
 *
 * Inspired by Chroma Context-1's scalable synthetic task generation.
 * Pro-only feature — gated via requirePro('dpo-synthesis').
 *
 * @module synthetic-dpo
 */

const { requirePro } = require('./pro-features');
const { extractDomainKeys, domainOverlap, inferPrompt, buildRubricDelta } = require('./export-dpo-pairs');

/**
 * Extract an abstract principle from an error+learning pair.
 * Turns "never run DROP on production tables" into a generalized rule.
 */
function extractPrinciple(pair) {
  const rejected = pair.rejected || '';
  const chosen = pair.chosen || '';
  const matchedKeys = pair.metadata?.matchedKeys || [];

  // Build principle from the domain keys and the contrast
  const domain = matchedKeys.length > 0
    ? matchedKeys.join(', ')
    : 'general';

  // Extract the "don't do X, do Y instead" pattern
  const dontDo = rejected.length > 120
    ? rejected.slice(0, 120).trim() + '...'
    : rejected;
  const doInstead = chosen.length > 120
    ? chosen.slice(0, 120).trim() + '...'
    : chosen;

  return {
    domain,
    anti_pattern: dontDo,
    correct_pattern: doInstead,
    principle: `In ${domain} tasks: avoid "${truncate(dontDo, 60)}" — instead "${truncate(doInstead, 60)}"`,
  };
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Generate scenario variations for a DPO pair by rephrasing the prompt.
 * Creates 1-2 synthetic pairs with different prompt framings.
 */
function generateScenarioVariations(pair) {
  const variations = [];
  const matchedKeys = pair.metadata?.matchedKeys || [];
  const domain = matchedKeys.join(', ') || 'this domain';

  // Variation 1: "What should be avoided?" framing
  variations.push({
    prompt: `In ${domain}: what is the wrong approach and what should be done instead?`,
    chosen: pair.chosen,
    rejected: pair.rejected,
    metadata: {
      ...pair.metadata,
      synthetic: true,
      syntheticType: 'scenario_variation',
      syntheticVariant: 'avoidance_framing',
      sourceId: pair.metadata?.errorId,
    },
  });

  // Variation 2: "Best practice" framing (only if we have enough context)
  if (matchedKeys.length > 0) {
    variations.push({
      prompt: `What is the best practice for ${domain}? Compare the correct approach with a common mistake.`,
      chosen: pair.chosen,
      rejected: pair.rejected,
      metadata: {
        ...pair.metadata,
        synthetic: true,
        syntheticType: 'scenario_variation',
        syntheticVariant: 'best_practice_framing',
        sourceId: pair.metadata?.errorId,
      },
    });
  }

  return variations;
}

/**
 * Build contrastive pairs from unpaired errors and learnings.
 * Uses softer domain matching (single key overlap) to find weak matches
 * that wouldn't qualify for primary pairing but are useful for training.
 */
function buildContrastivePairs(unpairedErrors, unpairedLearnings) {
  const pairs = [];
  const usedErrors = new Set();
  const usedLearnings = new Set();

  const errorKeys = unpairedErrors.map((e) => ({ memory: e, keys: extractDomainKeys(e) }));
  const learningKeys = unpairedLearnings.map((l) => ({ memory: l, keys: extractDomainKeys(l) }));

  // Relaxed matching: 1+ key overlap (primary pairing requires higher scores)
  for (const err of errorKeys) {
    if (usedErrors.has(err.memory.id)) continue;

    let best = null;
    let bestOverlap = 0;

    for (const learn of learningKeys) {
      if (usedLearnings.has(learn.memory.id)) continue;
      const overlap = domainOverlap(err.keys, learn.keys);
      if (overlap > bestOverlap) {
        best = learn;
        bestOverlap = overlap;
      }
    }

    if (best && bestOverlap >= 1) {
      const rubric = buildRubricDelta(err.memory, best.memory);
      pairs.push({
        prompt: inferPrompt(err.memory, best.memory),
        chosen: best.memory.content,
        rejected: err.memory.content,
        metadata: {
          errorId: err.memory.id,
          learningId: best.memory.id,
          matchScore: bestOverlap,
          overlapScore: bestOverlap,
          matchedKeys: err.keys.filter((k) => best.keys.includes(k)),
          errorTitle: err.memory.title,
          learningTitle: best.memory.title,
          rubric,
          synthetic: true,
          syntheticType: 'contrastive_pair',
        },
      });
      usedErrors.add(err.memory.id);
      usedLearnings.add(best.memory.id);
    }
  }

  return pairs;
}

/**
 * Augment an existing DPO export with synthetic pairs.
 *
 * @param {object} dpoExport - Output from exportDpoFromMemories()
 * @param {object} [options]
 * @param {boolean} [options.scenarioVariations=true] - Generate prompt variations
 * @param {boolean} [options.contrastivePairing=true] - Pair unmatched errors/learnings
 * @param {boolean} [options.principleExtraction=true] - Extract abstract principles
 * @param {boolean} [options.skipProCheck=false] - Skip Pro check (for testing)
 * @returns {{ originalPairs: number, syntheticPairs: number, totalPairs: number, pairs: object[], principles: object[] }}
 */
function augmentDpoExport(dpoExport, options = {}) {
  const {
    scenarioVariations = true,
    contrastivePairing = true,
    principleExtraction = true,
    skipProCheck = false,
  } = options;

  // Pro gate (unless testing)
  if (!skipProCheck && !requirePro('dpo-synthesis')) {
    return {
      originalPairs: dpoExport.pairs?.length || 0,
      syntheticPairs: 0,
      totalPairs: dpoExport.pairs?.length || 0,
      pairs: dpoExport.pairs || [],
      principles: [],
      proRequired: true,
    };
  }

  const originalPairs = dpoExport.pairs || [];
  const syntheticPairs = [];
  const principles = [];

  // 1. Scenario variations from existing pairs
  if (scenarioVariations) {
    for (const pair of originalPairs) {
      const variations = generateScenarioVariations(pair);
      syntheticPairs.push(...variations);
    }
  }

  // 2. Contrastive pairing from unpaired errors/learnings
  if (contrastivePairing) {
    const contrastive = buildContrastivePairs(
      dpoExport.unpairedErrors || [],
      dpoExport.unpairedLearnings || [],
    );
    syntheticPairs.push(...contrastive);
  }

  // 3. Principle extraction
  if (principleExtraction) {
    for (const pair of originalPairs) {
      principles.push(extractPrinciple(pair));
    }
  }

  const allPairs = [...originalPairs, ...syntheticPairs];

  return {
    originalPairs: originalPairs.length,
    syntheticPairs: syntheticPairs.length,
    totalPairs: allPairs.length,
    pairs: allPairs,
    principles,
  };
}

module.exports = {
  augmentDpoExport,
  extractPrinciple,
  generateScenarioVariations,
  buildContrastivePairs,
  truncate,
};
