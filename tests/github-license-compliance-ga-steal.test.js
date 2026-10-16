'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ENTERPRISE_LICENSE_POLICY,
  classifySpdxLicense,
  evaluateAgentPackageLicenseCompliance,
} = require('../scripts/github-license-compliance-ga-steal');

test('classifySpdxLicense: allows permissive and dual-OR permissive licenses, blocks AGPL/SSPL/missing, and flags MPL for review', () => {
  assert.equal(classifySpdxLicense('MIT').allowed, true);
  assert.equal(classifySpdxLicense('(MIT OR GPL-3.0-only)').allowed, true);
  assert.equal(classifySpdxLicense('(MIT AND AGPL-3.0-only)').allowed, false);
  assert.equal(classifySpdxLicense('SSPL-1.0').status, 'denied');
  assert.equal(classifySpdxLicense('MPL-2.0').status, 'review_required');
  assert.equal(classifySpdxLicense('').status, 'denied');
});

test('evaluateAgentPackageLicenseCompliance: blocks coding agents from installing noncompliant dependencies and emits PR annotations + audit log event', () => {
  const res = evaluateAgentPackageLicenseCompliance({
    toolName: 'Bash',
    command: 'npm install mit-pkg agpl-pkg',
    proposedPackages: [
      { name: 'mit-pkg', version: '1.2.0', license: 'MIT' },
      { name: 'agpl-pkg', version: '2.0.0', license: 'AGPL-3.0-only' },
    ],
  });

  assert.equal(res.allowed, false);
  assert.equal(res.gateId, 'gate:license:noncompliant_dependency_blocked');
  assert.equal(res.violations.length, 1);
  assert.equal(res.prAnnotations.length, 1);
  assert.equal(res.auditLogEvent.action, 'dependency_license_compliance.evaluated');
  assert.ok(res.latencyMs < 5);

  // Exception approved by Enterprise Open-Source License Manager passes
  const policyWithException = {
    ...DEFAULT_ENTERPRISE_LICENSE_POLICY,
    packageExceptions: {
      'agpl-pkg': {
        approvedByRole: 'Enterprise Open-Source License Manager',
        approvedBy: 'igor-ganapolsky',
      },
    },
  };
  const allowedWithExc = evaluateAgentPackageLicenseCompliance({
    toolName: 'Bash',
    command: 'npm install agpl-pkg',
    proposedPackages: [{ name: 'agpl-pkg', version: '2.0.0', license: 'AGPL-3.0-only' }],
    policy: policyWithException,
  });
  assert.equal(allowedWithExc.allowed, true);
});
