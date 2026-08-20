'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ISO42001ComplianceGuard } = require('../src/iso42001-compliance-guard.js');

test('ISO42001ComplianceGuard - evaluates tool calls against ISO 42001 clauses', async (t) => {
  await t.test('passes valid read-only tool calls without secrets', () => {
    const res = ISO42001ComplianceGuard.evaluateToolCallCompliance({
      name: 'view_file',
      parameters: { AbsolutePath: '/workspace/src/index.js' },
      riskTier: 'read-only',
    });
    assert.equal(res.compliant, true);
    assert.equal(res.findings.length, 0);
  });

  await t.test('flags unapproved critical tool calls under Clause 8.2', () => {
    const res = ISO42001ComplianceGuard.evaluateToolCallCompliance({
      name: 'delete_database',
      parameters: { db: 'production' },
      riskTier: 'critical',
      humanApproval: false,
    });
    assert.equal(res.compliant, false);
    assert.ok(res.findings.some((f) => f.clause.includes('Clause 8.2')));
  });

  await t.test('flags secret leaks under Clause 8.4 Data Protection', () => {
    const res = ISO42001ComplianceGuard.evaluateToolCallCompliance({
      name: 'run_command',
      parameters: { CommandLine: 'curl -H "Authorization: Bearer mock_secret_1234567890" api.com' },
      riskTier: 'contained-write',
    });
    assert.equal(res.compliant, false);
    assert.ok(res.findings.some((f) => f.clause.includes('Clause 8.4')));
  });

  await t.test('generates comprehensive compliance audit summary report', () => {
    const toolCalls = [
      { name: 'read_doc', riskTier: 'read-only' },
      { name: 'run_tests', riskTier: 'contained-write' },
      { name: 'wipe_disks', riskTier: 'critical' },
    ];
    const report = ISO42001ComplianceGuard.generateComplianceAuditReport(toolCalls);
    assert.equal(report.summary.totalEvaluated, 3);
    assert.equal(report.summary.passed, 2);
    assert.equal(report.summary.failed, 1);
    assert.ok(report.summary.complianceRate > 60);
  });
});
