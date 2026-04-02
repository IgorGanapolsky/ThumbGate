#!/usr/bin/env node
'use strict';

/**
 * Hallucination Detector — claim verification, confidence-weighted gates,
 * retrieval-grounded verification.
 *
 * Turns ThumbGate from "block known-bad patterns" into "detect and block
 * hallucinated claims" using 3 techniques from hallucination detection research.
 */

const { constructContextPack } = require('./contextfs');
const { matchSkillPacks } = require('./skill-packs');

// ---------------------------------------------------------------------------
// 1. Claim Decomposition & Verification
// ---------------------------------------------------------------------------

const CLAIM_PATTERNS = [
  { pattern: /\b(?:deployed|shipped|live|released)\b/i, type: 'deployment', verifyWith: ['health_check', 'version_match'] },
  { pattern: /\b(?:tests?\s+pass|all\s+tests?\s+(?:pass|green))\b/i, type: 'test_result', verifyWith: ['test_output', 'exit_code'] },
  { pattern: /\b(?:merged|PR\s+merged)\b/i, type: 'pr_merge', verifyWith: ['pr_state', 'ci_status'] },
  { pattern: /\b(?:fixed|resolved|bug\s+fix)\b/i, type: 'fix_claim', verifyWith: ['test_evidence', 'reproduction_check'] },
  { pattern: /\b(?:published|npm\s+publish)\b/i, type: 'publish', verifyWith: ['registry_check', 'version_match'] },
  { pattern: /\b(?:no\s+(?:errors?|failures?|issues?))\b/i, type: 'clean_state', verifyWith: ['log_check', 'status_check'] },
];

/**
 * Decompose agent output into verifiable sub-claims.
 * Returns array of { claim, type, verifyWith, text }.
 */
function decomposeClaims(agentOutput) {
  const text = String(agentOutput || '');
  if (!text.trim()) return [];

  const claims = [];
  for (const cp of CLAIM_PATTERNS) {
    cp.pattern.lastIndex = 0;
    const matches = text.match(cp.pattern);
    if (matches) {
      for (const match of matches) {
        // Extract surrounding sentence for context
        const idx = text.indexOf(match);
        const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
        const end = text.indexOf('.', idx + match.length);
        const sentence = text.slice(start, end > idx ? end + 1 : undefined).trim().slice(0, 200);

        claims.push({
          claim: match,
          type: cp.type,
          verifyWith: cp.verifyWith,
          context: sentence,
        });
      }
    }
  }

  return claims;
}

/**
 * Check a decomposed claim against available evidence.
 * Evidence is a map of { evidence_type: boolean_or_string }.
 */
function verifyClaim(claim, evidence) {
  const missing = [];
  const verified = [];

  for (const req of claim.verifyWith) {
    if (evidence[req] === true || (typeof evidence[req] === 'string' && evidence[req].length > 0)) {
      verified.push(req);
    } else {
      missing.push(req);
    }
  }

  const isVerified = missing.length === 0;
  return {
    claim: claim.claim,
    type: claim.type,
    verified: isVerified,
    verifiedEvidence: verified,
    missingEvidence: missing,
    confidence: claim.verifyWith.length > 0 ? Math.round((verified.length / claim.verifyWith.length) * 100) : 0,
    verdict: isVerified ? 'grounded' : missing.length === claim.verifyWith.length ? 'hallucination' : 'partial',
  };
}

// ---------------------------------------------------------------------------
// 2. Confidence-Weighted Gate Decisions
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLDS = {
  none: { action: 'block', minSamples: 0, maxSamples: 0 },
  low: { action: 'block', minSamples: 1, maxSamples: 4 },
  medium: { action: 'warn', minSamples: 5, maxSamples: 19 },
  high: { action: 'allow', minSamples: 20, maxSamples: Infinity },
};

/**
 * Determine gate action based on Thompson Sampling confidence tier.
 * Low confidence = stricter (block), high confidence = lenient (allow).
 */
function confidenceWeightedDecision({ confidence, reliability, samples }) {
  let tier = 'none';
  const s = samples || 0;

  if (s === 0) tier = 'none';
  else if (s <= 4) tier = 'low';
  else if (s <= 19) tier = 'medium';
  else tier = 'high';

  const threshold = CONFIDENCE_THRESHOLDS[tier];
  const rel = typeof reliability === 'number' ? reliability : 0.5;

  // Override: even high-confidence, if reliability < 0.3 → block
  let action = threshold.action;
  if (rel < 0.3) action = 'block';
  else if (rel < 0.5 && tier === 'high') action = 'warn';

  return {
    tier,
    action,
    reliability: Math.round(rel * 1000) / 1000,
    samples: s,
    reasoning: `${tier} confidence (${s} samples, ${Math.round(rel * 100)}% reliability) → ${action}`,
  };
}

// ---------------------------------------------------------------------------
// 3. Retrieval-Grounded Verification
// ---------------------------------------------------------------------------

/**
 * Check if a proposed action contradicts recalled prevention rules.
 * Retrieves relevant context and scans for contradictions.
 *
 * Returns { grounded, contradictions, relevantRules, groundingScore }.
 */
function retrievalGroundedCheck(proposedAction, { maxItems = 5, maxChars = 3000 } = {}) {
  const actionText = String(proposedAction || '').toLowerCase();
  if (!actionText.trim()) return { grounded: true, contradictions: [], relevantRules: [], groundingScore: 100 };

  // Retrieve relevant context
  let pack;
  try {
    pack = constructContextPack({ query: proposedAction, maxItems, maxChars, namespaces: ['rules', 'memoryError'] });
  } catch {
    return { grounded: true, contradictions: [], relevantRules: [], groundingScore: 100 };
  }

  const contradictions = [];
  const relevantRules = [];

  for (const item of pack.items) {
    const content = ((item.structuredContext && item.structuredContext.rawContent) || '').toLowerCase();
    const title = (item.title || '').toLowerCase();

    // Check for NEVER/ALWAYS rules that contradict the action
    const neverMatches = content.match(/never\s+(.{10,80})/gi) || [];
    for (const neverRule of neverMatches) {
      const ruleAction = neverRule.replace(/^never\s+/i, '').trim();
      // Check if the proposed action contains what the rule says never to do
      const ruleTokens = ruleAction.split(/\s+/).filter((t) => t.length > 3);
      const matchCount = ruleTokens.filter((t) => actionText.includes(t)).length;
      if (matchCount >= 2) {
        contradictions.push({
          rule: neverRule.trim(),
          source: item.title,
          matchStrength: Math.round((matchCount / ruleTokens.length) * 100),
        });
      }
    }

    // Track all relevant rules
    if (item.score > 0) {
      relevantRules.push({ title: item.title, score: item.score, namespace: item.namespace });
    }
  }

  const groundingScore = contradictions.length === 0 ? 100 : Math.max(0, 100 - contradictions.length * 25);

  return {
    grounded: contradictions.length === 0,
    contradictions,
    relevantRules,
    groundingScore,
    packItemCount: pack.items.length,
  };
}

/**
 * Full hallucination check: decompose claims + verify + ground against rules.
 * Returns comprehensive report.
 */
function fullHallucinationCheck(agentOutput, evidence = {}) {
  const claims = decomposeClaims(agentOutput);
  const claimResults = claims.map((c) => verifyClaim(c, evidence));
  const grounding = retrievalGroundedCheck(agentOutput);

  const verifiedCount = claimResults.filter((r) => r.verified).length;
  const hallucinationCount = claimResults.filter((r) => r.verdict === 'hallucination').length;
  const totalClaims = claimResults.length;

  return {
    claims: claimResults,
    grounding,
    summary: {
      totalClaims,
      verified: verifiedCount,
      hallucinated: hallucinationCount,
      partial: totalClaims - verifiedCount - hallucinationCount,
      claimPassRate: totalClaims > 0 ? Math.round((verifiedCount / totalClaims) * 1000) / 10 : 100,
      groundingScore: grounding.groundingScore,
      overallVerdict: hallucinationCount > 0 ? 'hallucination_detected' : (grounding.grounded ? 'grounded' : 'contradiction_detected'),
    },
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  CLAIM_PATTERNS, CONFIDENCE_THRESHOLDS,
  decomposeClaims, verifyClaim,
  confidenceWeightedDecision,
  retrievalGroundedCheck, fullHallucinationCheck,
};
