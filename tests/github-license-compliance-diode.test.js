'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSpdxExpression,
  evaluatePackageLicenseCompliance,
  buildLicensePolicyAuditEvent,
  auditRepositoryDependencyLicenses,
} = require('../scripts/github-license-compliance-diode');

test('evaluateSpdxExpression: handles single SPDX IDs, compound AND/OR expressions, and WITH clauses', () => {
  assert.equal(evaluateSpdxExpression('MIT'), true);
  assert.equal(evaluateSpdxExpression('Apache-2.0'), true);
  assert.equal(evaluateSpdxExpression('AGPL-3.0-only'), false);
  assert.equal(evaluateSpdxExpression('UNLICENSED'), false);

  // Disjunction (OR) succeeds when at least one license is permitted
  assert.equal(evaluateSpdxExpression('(MIT OR GPL-3.0-only)'), true);
  assert.equal(evaluateSpdxExpression('(GPL-2.0-only OR BSD-3-Clause)'), true);

  // Conjunction (AND) fails when any required license is noncompliant
  assert.equal(evaluateSpdxExpression('(MIT AND AGPL-3.0-only)'), false);
  assert.equal(evaluateSpdxExpression('(MIT AND Apache-2.0)'), true);

  // WITH exception clause checks base license
  assert.equal(evaluateSpdxExpression('Apache-2.0 WITH LLVM-exception'), true);
});

test('evaluatePackageLicenseCompliance: enforces active vs evaluate rollout modes, conversation resolution, and Enterprise Open-Source License Manager exceptions', () => {
  const candidatePackages = [
    { name: 'apache-arrow', version: '18.1.0', license: 'Apache-2.0' },
    { name: 'copyleft- viral-pkg', version: '1.0.0', license: 'AGPL-3.0-only', transitive: true },
  ];

  // 1. Active mode blocks noncompliant transitive dependency
  const activeRes = evaluatePackageLicenseCompliance({
    packages: candidatePackages,
    rolloutMode: 'active',
  });
  assert.equal(activeRes.allowed, false);
  assert.equal(activeRes.decision, 'block');
  assert.equal(activeRes.gateId, 'gate:supply_chain:oss_license_noncompliant');
  assert.equal(activeRes.violations.length, 1);

  // 2. Evaluate mode annotates without blocking when conversation resolution is not required
  const evalRes = evaluatePackageLicenseCompliance({
    packages: candidatePackages,
    rolloutMode: 'evaluate',
    requireConversationResolution: false,
  });
  assert.equal(evalRes.allowed, true);
  assert.equal(evalRes.decision, 'annotate');
  assert.equal(evalRes.annotations.length, 1);

  // 3. Evaluate mode + required conversation resolution blocks until annotation is resolved
  const evalStrictRes = evaluatePackageLicenseCompliance({
    packages: candidatePackages,
    rolloutMode: 'evaluate',
    requireConversationResolution: true,
  });
  assert.equal(evalStrictRes.allowed, false);
  assert.equal(evalStrictRes.decision, 'block');

  // 4. Enterprise Open-Source License Manager scoped package exception unblocks
  const exceptionRes = evaluatePackageLicenseCompliance({
    packages: candidatePackages,
    rolloutMode: 'active',
    targetRepo: 'IgorGanapolsky/ThumbGate',
    exceptions: [
      {
        type: 'package',
        package: 'copyleft- viral-pkg',
        version: '1.0.0',
        scope: 'repository',
        repository: 'IgorGanapolsky/ThumbGate',
        approvedByRole: 'Enterprise Open-Source License Manager',
      },
    ],
  });
  assert.equal(exceptionRes.allowed, true);
  assert.equal(exceptionRes.appliedExceptions.length, 1);
});

test('auditRepositoryDependencyLicenses & buildLicensePolicyAuditEvent: verifies ThumbGate production dependencies and emits policy audit event', () => {
  const repoAudit = auditRepositoryDependencyLicenses();
  assert.equal(repoAudit.allowed, true);
  assert.equal(repoAudit.violations.length, 0);

  const event = buildLicensePolicyAuditEvent({ action: 'modify' });
  assert.equal(event.category, 'Policy Management');
  assert.equal(event.eventType, 'license_compliance_policy.modify');
  assert.match(event.policyDigest, /^sha256:[a-f0-9]{64}$/);
});
