'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  EvidenceDiagnosticEngine,
  COMPARISON_MAP,
  runDoctor
} = require('../scripts/windbg-evidence-diagnostics');

const SCRIPT_PATH = path.join(__dirname, '../scripts/windbg-evidence-diagnostics.js');

test('windbg-mcp: verify comparison map exposes 4 practices and anti-clone rules', () => {
  assert.equal(COMPARISON_MAP.verdict, 'COMPARE_NOT_CLONE');
  assert.equal(COMPARISON_MAP.stolenPractices.length, 4);
  const practices = COMPARISON_MAP.stolenPractices.map(p => p.practice);
  assert.ok(practices.includes('Empirical Evidence Grounding'));
  assert.ok(practices.includes('Cryptographic Evidence Receipts'));
  assert.ok(practices.includes('Grounded Abstention'));
  assert.ok(practices.includes('Verifiable Evidence Box Protocol'));
  assert.ok(COMPARISON_MAP.antiCloneRules.some(r => r.includes('NEVER install WinDbg')));
});

test('windbg-mcp: executeAndGround returns GROUNDED_TRUE on match', () => {
  const engine = new EvidenceDiagnosticEngine();
  const receipt = engine.executeAndGround({
    command: 'echo "DEPLOY_STAGE_PASS"',
    assertion: 'DEPLOY_STAGE_PASS'
  });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.verdict, 'GROUNDED_TRUE');
  assert.equal(receipt.exitCode, 0);
  assert.ok(/^[a-f0-9]{64}$/i.test(receipt.evidenceSha));
  assert.ok(receipt.outputSnippet.includes('DEPLOY_STAGE_PASS'));
});

test('windbg-mcp: executeAndGround returns GROUNDED_FALSE on mismatch', () => {
  const engine = new EvidenceDiagnosticEngine();
  const receipt = engine.executeAndGround({
    command: 'echo "ACTUAL_OUTPUT"',
    assertion: 'MISSING_TARGET_STRING'
  });

  assert.equal(receipt.ok, false);
  assert.equal(receipt.verdict, 'GROUNDED_FALSE');
  assert.equal(receipt.exitCode, 0);
});

test('windbg-mcp: returns EVIDENCE_INSUFFICIENT on invalid command', () => {
  const engine = new EvidenceDiagnosticEngine();
  const receipt = engine.executeAndGround({ command: '' });

  assert.equal(receipt.ok, false);
  assert.equal(receipt.verdict, 'EVIDENCE_INSUFFICIENT');
  assert.equal(receipt.reason, 'NO_COMMAND_PROVIDED');
});

test('windbg-mcp: formatEvidenceBox renders valid markdown box', () => {
  const engine = new EvidenceDiagnosticEngine();
  const receipt = engine.executeAndGround({
    command: 'echo "TEST_BOX"',
    assertion: 'TEST_BOX'
  });

  const box = engine.formatEvidenceBox(receipt);
  assert.ok(box.startsWith('```text'));
  assert.ok(box.includes('=== VERIFIABLE EVIDENCE BOX (WinDbg MCP Grounded Protocol) ==='));
  assert.ok(box.includes(`Command:     echo "TEST_BOX"`));
  assert.ok(box.includes('Verdict:     GROUNDED_TRUE'));
  assert.ok(box.includes(receipt.evidenceSha));
  assert.ok(box.endsWith('```'));
});

test('windbg-mcp: verifyEvidenceEnvelope detects tampered or invalid fingerprints', () => {
  const engine = new EvidenceDiagnosticEngine();
  const valid = engine.verifyEvidenceEnvelope({
    evidenceSha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    outputSnippet: ''
  });
  assert.equal(valid.ok, true);

  const invalidSha = engine.verifyEvidenceEnvelope({
    evidenceSha: 'not-a-valid-sha',
    outputSnippet: ''
  });
  assert.equal(invalidSha.ok, false);
  assert.equal(invalidSha.reason, 'INVALID_SHA256_FINGERPRINT');

  const tampered = engine.verifyEvidenceEnvelope({
    evidenceSha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    outputSnippet: 'tampered-data-mismatch'
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'EVIDENCE_FINGERPRINT_MISMATCH');
});

test('windbg-mcp: executeAndGround returns EVIDENCE_INSUFFICIENT when output is empty', () => {
  const engine = new EvidenceDiagnosticEngine();
  const receipt = engine.executeAndGround({
    command: 'true'
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.verdict, 'EVIDENCE_INSUFFICIENT');
});

test('windbg-mcp: CLI runs cleanly with --json and --map-only', () => {
  const mapRun = spawnSync('node', [SCRIPT_PATH, '--map-only'], { encoding: 'utf8' });
  assert.equal(mapRun.status, 0);
  const map = JSON.parse(mapRun.stdout);
  assert.equal(map.verdict, 'COMPARE_NOT_CLONE');

  const jsonRun = spawnSync('node', [SCRIPT_PATH, '--json'], { encoding: 'utf8' });
  assert.equal(jsonRun.status, 0);
  const json = JSON.parse(jsonRun.stdout);
  assert.equal(json.status, 'HEALTHY');
  assert.equal(json.passedBudget, true);
});
