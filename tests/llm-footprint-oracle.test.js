'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateJournalistPitch,
  harmonizeDigitalFootprint,
  handleDoctor,
  mainCli,
} = require('../scripts/llm-footprint-oracle.js');

test('Journalist Pitch Oracle - passes crisp empirical pitch', () => {
  const pitch = `Report: New benchmark audit of 51,000 AI agent tool executions reveals a 128% surge in application-layer ShadowLeak attacks. ThumbGate's deterministic PreToolUse firewall interdicts data exfiltration in sub-millisecond (<1ms) latency without cloud LLM token spend.`;
  const result = evaluateJournalistPitch(pitch);
  assert.equal(result.passed, true);
  assert.equal(result.verdict, 'COMPELLING_STORY');
  assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
  assert.equal(result.flaggedJargon.length, 0);
  assert.match(result.receipt, /journalist_pitch_oracle_score=\d+:verdict=allow/);
});

test('Journalist Pitch Oracle - rejects fluffy commodity marketing jargon', () => {
  const pitch = `We are excited to announce our groundbreaking, revolutionary, game-changing AI paradigm shift that seamlessly delivers state-of-the-art cutting-edge agentic workflows. Hope you are doing well!`;
  const result = evaluateJournalistPitch(pitch);
  assert.equal(result.passed, false);
  assert.equal(result.verdict, 'REJECT_AS_FLUFF');
  assert.ok(result.score < 50, `Expected score < 50, got ${result.score}`);
  assert.ok(result.flaggedJargon.length >= 3, `Expected >= 3 flagged jargon words, got ${result.flaggedJargon.length}`);
  assert.ok(result.recommendations.length > 0);
});

test('Cross-Silo Footprint Harmonizer - validates congruent multi-channel entity definitions', () => {
  const surfaces = [
    { channel: 'LandingPage', entity: 'ThumbGate', definition: 'Deterministic pre-action firewall for AI agents' },
    { channel: 'SchemaOrg', entity: 'ThumbGate', definition: 'Deterministic pre-action firewall for AI agents' },
    { channel: 'Docs', entity: 'ThumbGate', definition: 'Deterministic pre-action firewall for AI agents' },
  ];
  const audit = harmonizeDigitalFootprint(surfaces);
  assert.equal(audit.congruent, true);
  assert.equal(audit.verdict, 'HARMONIZED');
  assert.equal(audit.inconsistencies.length, 0);
});

test('Cross-Silo Footprint Harmonizer - detects entity definition drift across channels', () => {
  const surfaces = [
    { channel: 'LandingPage', entity: 'ReliabilityGateway', definition: 'Local SQLite feedback memory engine' },
    { channel: 'Docs', entity: 'ReliabilityGateway', definition: 'Cloud-hosted Kubernetes vector database' },
  ];
  const audit = harmonizeDigitalFootprint(surfaces);
  assert.equal(audit.congruent, false);
  assert.equal(audit.verdict, 'FOOTPRINT_DRIFT_DETECTED');
  assert.equal(audit.inconsistencies.length, 1);
  assert.match(audit.inconsistencies[0].divergence, /LandingPage.*Docs/);
});

test('LLM Footprint Oracle - doctor check passes cleanly', () => {
  let output = '';
  const mockStdout = {
    write: (msg) => { output += msg; },
  };
  const exitCode = handleDoctor(mockStdout);
  assert.equal(exitCode, 0);
  assert.match(output, /Journalist Cold-Pitch Oracle/);
  assert.match(output, /Cross-Silo Footprint Harmonizer/);
});

test('LLM Footprint Oracle - CLI pitch evaluation', () => {
  let output = '';
  const mockStdout = {
    write: (msg) => { output += msg; },
  };
  const pitch = 'Study: "42.5% of AI coding agents repeat past errors without deterministic memory", observed across 10,000 benchmark runs.';
  const exitCode = mainCli(['--pitch', pitch], mockStdout);
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.passed, true);
  assert.equal(parsed.verdict, 'COMPELLING_STORY');
});

test('LLM Footprint Gate Config - valid JSON with critical pre-action gates', () => {
  const gatePath = path.join(__dirname, '..', 'config', 'gates', 'llm-footprint-governance.json');
  assert.ok(fs.existsSync(gatePath), 'Gate config must exist');
  const config = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(config.version, 1);
  assert.ok(Array.isArray(config.gates));
  assert.equal(config.gates.length, 2);
  const gateIds = config.gates.map((g) => g.id);
  assert.ok(gateIds.includes('journalist-cold-pitch-quality-gate'));
  assert.ok(gateIds.includes('cross-silo-llm-footprint-drift-gate'));
});
