'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runProof,
  proveGatePatternsBlock,
  proveGatePatternsAllow,
  proveModelCandidates,
  proveAdapterFiles,
  proveGateTemplateContract,
  patternMatches,
  getVltTemplate,
} = require('../scripts/prove-vlt');

test('vlt gate template patterns match dangerous vlt commands', () => {
  const results = proveGatePatternsBlock();
  assert.equal(results.every((r) => r.passed), true, 'all block patterns should match their commands');
});

test('vlt gate template patterns do not match safe pinned-version installs', () => {
  const results = proveGatePatternsAllow();
  const pinned = results.find((r) => r.name.includes('pinned version'));
  assert.ok(pinned, 'should have a pinned-version allow test');
  assert.equal(pinned.passed, true, `pinned version must not match: ${pinned.details?.command}`);
});

test('vlt model candidates are registered for js-package-registry-governance workload', () => {
  const results = proveModelCandidates();
  assert.equal(results.every((r) => r.passed), true, 'all model candidate checks must pass');
});

test('vlt adapter files exist, are valid, and pin the shipped version', () => {
  const results = proveAdapterFiles();
  assert.equal(results.every((r) => r.passed), true, 'all adapter file checks must pass');
});

test('vlt gate templates satisfy the shared rollout metadata contract', () => {
  const results = proveGateTemplateContract();
  assert.equal(results.every((r) => r.passed), true, 'all gate template contract checks must pass');
});

test('patternMatches correctly tests regex patterns', () => {
  assert.equal(patternMatches('vlt.*install', 'vlt install lodash'), true);
  assert.equal(patternMatches('vlt.*install', 'npm install lodash'), false);
  assert.equal(patternMatches(null, 'anything'), false);
});

test('getVltTemplate returns the correct template for a known id', () => {
  const template = getVltTemplate('block-vlt-install-vulnerable-deps');
  assert.ok(template, 'template should exist');
  assert.equal(template.category, 'JavaScript Package Registry Governance');
  assert.equal(template.defaultAction, 'block');
  assert.equal(template.severity, 'critical');
});

test('getVltTemplate returns undefined for an unknown id', () => {
  const template = getVltTemplate('nonexistent-vlt-template');
  assert.equal(template, undefined);
});

test('runProof produces a complete report with all suites', () => {
  const report = runProof({ writeArtifacts: false });
  assert.ok(report.summary.total > 0, 'should have at least one test');
  assert.equal(report.summary.failed, 0, `all proof tests must pass. Failures: ${JSON.stringify(report.results.filter((r) => !r.passed))}`);
  assert.ok(report.summary.suites.gate_patterns_block, 'should have gate_patterns_block suite');
  assert.ok(report.summary.suites.model_candidates, 'should have model_candidates suite');
  assert.ok(report.summary.suites.adapter_files, 'should have adapter_files suite');
  assert.ok(report.summary.suites.gate_template_contract, 'should have gate_template_contract suite');
});
