/**
 * Tests for Agent SDLC Tsunami Defense Engine
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ModularSkillRegistry,
  Type1DecisionOrchestrator,
  LazyPrCiManager,
  DatabaseDeepTrustGuard,
  AutomatedCveRemediationDiode
} = require('../src/agent-sdlc-tsunami-engine');

test('ModularSkillRegistry - register and resolve versioned skill modules with template substitution', () => {
  const registry = new ModularSkillRegistry();

  const regResult = registry.registerSkillModule({
    id: 'git-review-gate',
    version: '1.2.0',
    systemPromptTemplate: 'Review PR for security and style. Target branch: {{targetBranch}}.',
    parametersSchema: {
      targetBranch: { required: true, type: 'string' }
    }
  });

  assert.equal(regResult.status, 'REGISTERED');
  assert.ok(regResult.contentHash);

  const resolved = registry.resolveSkillTrigger({
    id: 'git-review-gate',
    requestedVersion: '1.2.0',
    inputs: { targetBranch: 'main' }
  });

  assert.equal(resolved.version, '1.2.0');
  assert.equal(resolved.renderedPrompt, 'Review PR for security and style. Target branch: main.');
});

test('Type1DecisionOrchestrator - fast boolean path and red/blue arbitration', () => {
  const orchestrator = new Type1DecisionOrchestrator({ confidenceThreshold: 0.85 });

  // Fast boolean rule match (< 15ms)
  const fastDecision = orchestrator.evaluateFastPath({
    intent: 'ping-health',
    rules: [{ pattern: 'ping-health', action: 'ALLOW', id: 'rule_health_01' }]
  });

  assert.equal(fastDecision.allowed, true);
  assert.equal(fastDecision.decisionType, 'FAST_BOOLEAN_MATCH');
  assert.equal(fastDecision.escalateToFrontier, false);

  // Red/Blue referee rejects when red team finds critical defects
  const redBlueResult = orchestrator.adjudicateRedBlueArbitration({
    proposal: 'Deploy auth bypass',
    blueClaim: { passed: true },
    redCritique: {
      defects: [{ severity: 'CRITICAL', description: 'Unauthenticated token generation' }]
    }
  });

  assert.equal(redBlueResult.passed, false);
  assert.equal(redBlueResult.winner, 'RED_TEAM');
  assert.equal(redBlueResult.verdict, 'REJECTED_BY_RED_TEAM');
});

test('LazyPrCiManager - superseding PR cancellation and critical-diff priority', () => {
  const ciManager = new LazyPrCiManager();

  // Commit 1 on PR 42 starts building
  const run1 = ciManager.registerPipeline({
    prNumber: 42,
    commitSha: 'commit_111',
    changedFiles: ['README.md']
  });
  assert.equal(run1.status, 'RUNNING');
  assert.equal(run1.evaluationPriority, 'LAZY_DEFERRED');

  // Commit 2 on PR 42 arrives, touching critical security firewall
  const run2 = ciManager.registerPipeline({
    prNumber: 42,
    commitSha: 'commit_222',
    changedFiles: ['src/cloud-token-firewall.js']
  });

  assert.equal(run2.status, 'RUNNING');
  assert.equal(run2.evaluationPriority, 'IMMEDIATE_CRITICAL');
  assert.ok(run2.cancelledPrevious, 'Previous build should be cancelled');
  assert.equal(run2.cancelledPrevious.cancelledCommitSha, 'commit_111');
});

test('DatabaseDeepTrustGuard - enforces immutable constraints at DB layer', () => {
  // Reject excessive spending exceeding schema constraint
  const spendCheck = DatabaseDeepTrustGuard.validateTransactionAgainstSchemaConstraints({
    table: 'agent_spend',
    record: { amountUsd: 1200.0 },
    context: { maxSpendLimitUsd: 500.0 }
  });
  assert.equal(spendCheck.allowed, false);
  assert.equal(spendCheck.violation, 'DB_CONSTRAINT_SPEND_LIMIT_EXCEEDED');

  // Reject unredacted PII in persistent storage
  const piiCheck = DatabaseDeepTrustGuard.validateTransactionAgainstSchemaConstraints({
    table: 'user_audit',
    record: { email: 'john.doe@example.com' }
  });
  assert.equal(piiCheck.allowed, false);
  assert.equal(piiCheck.violation, 'DB_CONSTRAINT_PII_CLEAR_TEXT_DETECTED');
});

test('AutomatedCveRemediationDiode - analyzes vulnerability and generates atomic fix', () => {
  const cveResult = AutomatedCveRemediationDiode.analyzeVulnerability({
    cveId: 'CVE-2026-9999',
    dependency: 'fast-xml-parser',
    currentVersion: '4.2.0',
    fixedVersion: '4.2.5',
    advisoryDescription: 'Remote Code Execution in XML attribute parsing'
  });

  assert.equal(cveResult.isVulnerable, true);
  assert.equal(cveResult.riskLevel, 'CRITICAL');
  assert.equal(cveResult.automatedFixAvailable, true);
  assert.equal(cveResult.remediationPatch.npmCommand, 'npm install fast-xml-parser@4.2.5');
});
