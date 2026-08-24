'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeComplianceCoverage,
  getTrustCenterPack,
  renderTrustCenterHtml,
} = require('../src/trust-center');

test('compliance coverage counts tagged gates without inventing attestation', () => {
  const coverage = summarizeComplianceCoverage([
    { id: 'a', compliance: ['SOC2-CC6.1', 'NIST-AC-3'] },
    { id: 'b', compliance: ['OWASP-A01'] },
    { id: 'c', compliance: [] },
    { id: 'd' },
  ]);
  assert.equal(coverage.totalGates, 4);
  assert.equal(coverage.taggedGates, 2);
  assert.equal(coverage.untaggedGates, 2);
  const soc2 = coverage.frameworks.find((f) => f.id === 'SOC2');
  assert.equal(soc2.taggedGateCount, 1);
  assert.equal(soc2.coveragePctOfShippedGates, 25);
  assert.equal(soc2.attestation, false);
  assert.match(soc2.note, /Not audit readiness/i);
});

test('trust pack refuses certification theater and exposes questionnaire + evidence', () => {
  const pack = getTrustCenterPack({
    gates: [
      { id: 'secret', compliance: ['SOC2-CC6.1', 'CWE-798'] },
      { id: 'egress', compliance: ['NIST-SC-7', 'OWASP-A10'] },
      { id: 'plain' },
    ],
  });
  assert.equal(pack.certification, false);
  assert.equal(pack.theater, false);
  assert.equal(pack.certifications.soc2, false);
  assert.equal(pack.certifications.iso27001, false);
  assert.ok(pack.questionnaire.itemCount >= 12);
  assert.equal(pack.urls.json, 'https://thumbgate.ai/trust.json');
  assert.ok(pack.evidence.some((e) => e.id === 'security-questionnaire'));
  assert.ok(pack.evidence.some((e) => e.id === 'production-health'));
  assert.equal(pack.controlCoverage.totalGates, 3);
  assert.equal(pack.controlCoverage.taggedGates, 2);
});

test('trust HTML is a distinct hub from the questionnaire page', () => {
  const html = renderTrustCenterHtml(getTrustCenterPack({
    gates: [{ id: 'g', compliance: ['SOC2-CC8.1'] }],
  }));
  assert.match(html, /Trust Center/i);
  assert.match(html, /No compliance theater/i);
  assert.match(html, /Cross-framework control-tag coverage/i);
  assert.match(html, /\/trust\.json/);
  assert.match(html, /\/security\.json/);
  assert.match(html, /not a SOC 2/i);
  assert.match(html, /Attestation\?/);
  assert.doesNotMatch(html, /Vendor questionnaire/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.match(html, /WebPage/);
});
