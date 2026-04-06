const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-halluc-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  CLAIM_PATTERNS, CONFIDENCE_THRESHOLDS,
  decomposeClaims, verifyClaim,
  confidenceWeightedDecision,
  retrievalGroundedCheck, fullHallucinationCheck,
} = require('../scripts/hallucination-detector');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Claim Decomposition ===
test('CLAIM_PATTERNS covers deployment, test, merge, fix, publish, clean', () => {
  const types = CLAIM_PATTERNS.map((p) => p.type);
  assert.ok(types.includes('deployment'));
  assert.ok(types.includes('test_result'));
  assert.ok(types.includes('pr_merge'));
  assert.ok(types.includes('fix_claim'));
  assert.ok(types.includes('publish'));
  assert.ok(types.includes('clean_state'));
});

test('decomposeClaims finds deployment claim', () => {
  const claims = decomposeClaims('The feature has been deployed to production.');
  assert.ok(claims.length >= 1);
  assert.equal(claims[0].type, 'deployment');
  assert.ok(claims[0].verifyWith.includes('health_check'));
});

test('decomposeClaims finds multiple claims', () => {
  const claims = decomposeClaims('All tests pass. PR merged. Deployed to production.');
  assert.ok(claims.length >= 3);
  const types = claims.map((c) => c.type);
  assert.ok(types.includes('test_result'));
  assert.ok(types.includes('pr_merge'));
  assert.ok(types.includes('deployment'));
});

test('decomposeClaims returns empty for no claims', () => {
  assert.equal(decomposeClaims('I will investigate the issue.').length, 0);
});

test('decomposeClaims handles empty/null', () => {
  assert.equal(decomposeClaims(null).length, 0);
  assert.equal(decomposeClaims('').length, 0);
});

test('decomposeClaims includes context sentence', () => {
  const claims = decomposeClaims('After review, the fix was deployed to staging.');
  assert.ok(claims[0].context.length > 0);
});

// === Claim Verification ===
test('verifyClaim passes with all evidence', () => {
  const claim = { claim: 'deployed', type: 'deployment', verifyWith: ['health_check', 'version_match'] };
  const r = verifyClaim(claim, { health_check: true, version_match: '0.9.3' });
  assert.equal(r.verified, true);
  assert.equal(r.verdict, 'grounded');
  assert.equal(r.confidence, 100);
});

test('verifyClaim fails with missing evidence', () => {
  const claim = { claim: 'deployed', type: 'deployment', verifyWith: ['health_check', 'version_match'] };
  const r = verifyClaim(claim, { health_check: true });
  assert.equal(r.verified, false);
  assert.equal(r.verdict, 'partial');
  assert.equal(r.confidence, 50);
  assert.ok(r.missingEvidence.includes('version_match'));
});

test('verifyClaim detects hallucination with no evidence', () => {
  const claim = { claim: 'tests pass', type: 'test_result', verifyWith: ['test_output', 'exit_code'] };
  const r = verifyClaim(claim, {});
  assert.equal(r.verified, false);
  assert.equal(r.verdict, 'hallucination');
  assert.equal(r.confidence, 0);
});

// === Confidence-Weighted Decisions ===
test('CONFIDENCE_THRESHOLDS has all tiers', () => {
  assert.ok(CONFIDENCE_THRESHOLDS.none);
  assert.ok(CONFIDENCE_THRESHOLDS.low);
  assert.ok(CONFIDENCE_THRESHOLDS.medium);
  assert.ok(CONFIDENCE_THRESHOLDS.high);
});

test('confidenceWeightedDecision blocks on zero samples', () => {
  const r = confidenceWeightedDecision({ confidence: 0, reliability: 0.5, samples: 0 });
  assert.equal(r.tier, 'none');
  assert.equal(r.action, 'block');
});

test('confidenceWeightedDecision blocks on low samples', () => {
  const r = confidenceWeightedDecision({ confidence: 0.6, reliability: 0.6, samples: 3 });
  assert.equal(r.tier, 'low');
  assert.equal(r.action, 'block');
});

test('confidenceWeightedDecision warns on medium samples', () => {
  const r = confidenceWeightedDecision({ confidence: 0.7, reliability: 0.7, samples: 10 });
  assert.equal(r.tier, 'medium');
  assert.equal(r.action, 'warn');
});

test('confidenceWeightedDecision allows on high samples', () => {
  const r = confidenceWeightedDecision({ confidence: 0.9, reliability: 0.9, samples: 25 });
  assert.equal(r.tier, 'high');
  assert.equal(r.action, 'allow');
});

test('confidenceWeightedDecision blocks high samples with low reliability', () => {
  const r = confidenceWeightedDecision({ confidence: 0.9, reliability: 0.2, samples: 30 });
  assert.equal(r.tier, 'high');
  assert.equal(r.action, 'block');
});

test('confidenceWeightedDecision warns high samples with medium reliability', () => {
  const r = confidenceWeightedDecision({ confidence: 0.9, reliability: 0.4, samples: 25 });
  assert.equal(r.action, 'warn');
});

test('confidenceWeightedDecision includes reasoning', () => {
  const r = confidenceWeightedDecision({ reliability: 0.8, samples: 15 });
  assert.ok(r.reasoning.includes('medium'));
  assert.ok(r.reasoning.includes('warn'));
});

// === Retrieval-Grounded Verification ===
test('retrievalGroundedCheck returns grounded for safe action', () => {
  const r = retrievalGroundedCheck('add unit tests for the new feature');
  assert.equal(r.grounded, true);
  assert.equal(r.contradictions.length, 0);
  assert.equal(r.groundingScore, 100);
});

test('retrievalGroundedCheck handles empty input', () => {
  assert.equal(retrievalGroundedCheck('').grounded, true);
  assert.equal(retrievalGroundedCheck(null).grounded, true);
});

// === Full Hallucination Check ===
test('fullHallucinationCheck with verified claims', () => {
  const r = fullHallucinationCheck('Tests pass and fix is deployed.', { test_output: true, exit_code: true, health_check: true, version_match: '1.0' });
  assert.ok(r.claims.length >= 2);
  assert.ok(r.summary.verified >= 2);
  assert.equal(r.summary.hallucinated, 0);
  assert.ok(r.summary.claimPassRate > 0);
  assert.ok(r.checkedAt);
});

test('fullHallucinationCheck detects hallucinated claims', () => {
  const r = fullHallucinationCheck('All tests pass. Deployed. PR merged. No errors.', {});
  assert.ok(r.claims.length >= 3);
  assert.ok(r.summary.hallucinated >= 3);
  assert.equal(r.summary.overallVerdict, 'hallucination_detected');
});

test('fullHallucinationCheck with no claims returns clean', () => {
  const r = fullHallucinationCheck('I will look into the issue and report back.');
  assert.equal(r.summary.totalClaims, 0);
  assert.equal(r.summary.claimPassRate, 100);
  assert.equal(r.summary.overallVerdict, 'grounded');
});

test('fullHallucinationCheck includes grounding data', () => {
  const r = fullHallucinationCheck('Deployed to production.');
  assert.ok(typeof r.grounding.groundingScore === 'number');
  assert.ok(Array.isArray(r.grounding.relevantRules));
});
