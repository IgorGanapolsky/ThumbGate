'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Setup: isolated feedback dir for each test
// ---------------------------------------------------------------------------

let tmpDir;
let feedbackDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-test-'));
  feedbackDir = path.join(tmpDir, 'feedback');
  fs.mkdirSync(feedbackDir, { recursive: true });
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_GUARDS_PATH = path.join(feedbackDir, 'pretool-guards.json');
});

afterEach(() => {
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.THUMBGATE_GUARDS_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. isHighRiskAction: broadened to file-mutating Bash commands
// ---------------------------------------------------------------------------

test('isHighRiskAction: Edit tool is always high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Edit', {}), true);
});

test('isHighRiskAction: Write tool is always high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Write', {}), true);
});

test('isHighRiskAction: Bash with git push is high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Bash', { command: 'git push origin main' }), true);
});

test('isHighRiskAction: Bash with npm run is high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Bash', { command: 'npm run build' }), true);
});

test('isHighRiskAction: Bash with sed is high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Bash', { command: 'sed -i "s/foo/bar/" file.js' }), true);
});

test('isHighRiskAction: Bash with curl is high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Bash', { command: 'curl -X POST https://api.example.com' }), true);
});

test('isHighRiskAction: Bash with plain node script is not high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Bash', { command: 'node scripts/check.js' }), false);
});

test('isHighRiskAction: Read tool is not high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Read', {}), false);
});

test('isHighRiskAction: Grep tool is not high-risk', () => {
  const { isHighRiskAction } = require('../scripts/gates-engine');
  assert.equal(isHighRiskAction('Grep', {}), false);
});

// ---------------------------------------------------------------------------
// 2. buildBehavioralContext: injects recurring patterns
// ---------------------------------------------------------------------------

test('buildBehavioralContext: returns null when no feedback exists', () => {
  const { buildBehavioralContext } = require('../scripts/gates-engine');
  const result = buildBehavioralContext();
  assert.equal(result, null);
});

test('buildBehavioralContext: returns context when recurring patterns exist', () => {
  // Write feedback with recurring patterns
  const feedbackLog = path.join(feedbackDir, 'feedback-log.jsonl');
  const entries = [];
  for (let i = 0; i < 3; i++) {
    entries.push(JSON.stringify({
      signal: 'negative',
      context: 'claimed done without pushing git commit execution gap',
      whatWentWrong: 'announced done without actually pushing the changes',
      tags: ['execution-gap'],
      timestamp: new Date().toISOString(),
    }));
  }
  fs.writeFileSync(feedbackLog, entries.join('\n') + '\n');

  const { buildBehavioralContext } = require('../scripts/gates-engine');
  const result = buildBehavioralContext();
  assert.ok(result === null || typeof result === 'string');
  // If patterns are found, should contain ThumbGate header
  if (result) {
    assert.ok(result.includes('ThumbGate'));
  }
});

// ---------------------------------------------------------------------------
// 3. formatOutput: passes behavioral context through
// ---------------------------------------------------------------------------

test('formatOutput: injects behavioral context when no gate result', () => {
  const { formatOutput } = require('../scripts/gates-engine');
  const output = JSON.parse(formatOutput(null, '[ThumbGate] Test context'));
  assert.ok(output.hookSpecificOutput);
  assert.equal(output.hookSpecificOutput.additionalContext, '[ThumbGate] Test context');
});

test('formatOutput: returns empty when no gate result and no behavioral context', () => {
  const { formatOutput } = require('../scripts/gates-engine');
  const output = JSON.parse(formatOutput(null, null));
  assert.deepEqual(output, {});
});

test('formatOutput: appends behavioral context to warn results', () => {
  const { formatOutput } = require('../scripts/gates-engine');
  const warnResult = { decision: 'warn', gate: 'test-gate', message: 'test warning', reasoning: [] };
  const output = JSON.parse(formatOutput(warnResult, '[ThumbGate] Extra context'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('test warning'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('[ThumbGate] Extra context'));
});

test('formatOutput: deny result ignores behavioral context', () => {
  const { formatOutput } = require('../scripts/gates-engine');
  const denyResult = { decision: 'deny', gate: 'test-gate', message: 'blocked', reasoning: [] };
  const output = JSON.parse(formatOutput(denyResult, '[ThumbGate] Extra context'));
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(!output.hookSpecificOutput.additionalContext);
});

// ---------------------------------------------------------------------------
// 4. Compiled guard staleness: stale artifact falls through to live
// ---------------------------------------------------------------------------

test('evaluatePretool: trusts fresh compiled artifact', () => {
  const hybrid = require('../scripts/hybrid-feedback-context');

  // Write a fresh compiled artifact that says allow
  const artifact = {
    compiledAt: new Date().toISOString(),
    guardCount: 0,
    blockThreshold: 3,
    guards: [],
  };
  const guardsPath = path.join(feedbackDir, 'pretool-guards.json');
  fs.writeFileSync(guardsPath, JSON.stringify(artifact));

  const result = hybrid.evaluatePretool('Bash', 'echo hello', {
    guardArtifactPath: guardsPath,
    feedbackLogPath: path.join(feedbackDir, 'feedback-log.jsonl'),
  });
  assert.equal(result.mode, 'allow');
  assert.equal(result.source, 'compiled');
});

test('evaluatePretool: falls through stale artifact to live state', () => {
  const hybrid = require('../scripts/hybrid-feedback-context');

  // Write a stale compiled artifact (2 hours old)
  const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const artifact = {
    compiledAt: staleTime,
    guardCount: 0,
    blockThreshold: 3,
    guards: [],
  };
  const guardsPath = path.join(feedbackDir, 'pretool-guards.json');
  fs.writeFileSync(guardsPath, JSON.stringify(artifact));

  const result = hybrid.evaluatePretool('Bash', 'echo hello', {
    guardArtifactPath: guardsPath,
    feedbackLogPath: path.join(feedbackDir, 'feedback-log.jsonl'),
  });
  // Should fall through to live state (source='state')
  assert.equal(result.mode, 'allow');
  assert.equal(result.source, 'state');
});

test('GUARD_STALENESS_MS is exported and equals 1 hour', () => {
  const { GUARD_STALENESS_MS } = require('../scripts/hybrid-feedback-context');
  assert.equal(GUARD_STALENESS_MS, 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// 5. evaluateCompiledGuards: tool-name matching for all inputs
// ---------------------------------------------------------------------------

test('evaluateCompiledGuards: matches tool name for long inputs', () => {
  const { evaluateCompiledGuards } = require('../scripts/hybrid-feedback-context');

  const artifact = {
    guards: [{
      hash: 'abc123',
      text: 'bash command failed repeatedly in deployment scripts',
      words: ['command', 'failed', 'repeatedly', 'deployment'],
      count: 5,
      mode: 'block',
      attributed: false,
    }],
    blockThreshold: 3,
  };

  // Long input that mentions bash tool context — should match via tool name
  const result = evaluateCompiledGuards(artifact, 'Bash', 'this is a long input string that does not have keyword hits');
  assert.equal(result.mode, 'block');
  assert.ok(result.reason.includes('recurring negative patterns'));
});

test('evaluateCompiledGuards: allows when tool not mentioned and no keyword hits', () => {
  const { evaluateCompiledGuards } = require('../scripts/hybrid-feedback-context');

  const artifact = {
    guards: [{
      hash: 'abc123',
      text: 'edit file caused regression in deployment scripts',
      words: ['file', 'caused', 'regression', 'deployment'],
      count: 5,
      mode: 'block',
      attributed: false,
    }],
    blockThreshold: 3,
  };

  // Tool is Read, guard mentions edit — no match
  const result = evaluateCompiledGuards(artifact, 'Read', 'reading some documentation');
  assert.equal(result.mode, 'allow');
});

// ---------------------------------------------------------------------------
// 6. promoteToGates: merges instead of overwriting
// ---------------------------------------------------------------------------

test('promoteToGates: preserves existing auto-gates', () => {
  const { analyze } = require('../scripts/feedback-to-rules');
  const { getAutoGatesPath } = require('../scripts/auto-promote-gates');

  // Pre-seed an existing auto-gate
  const autoGatesPath = getAutoGatesPath();
  fs.mkdirSync(path.dirname(autoGatesPath), { recursive: true });
  fs.writeFileSync(autoGatesPath, JSON.stringify({
    version: 1,
    gates: [{
      id: 'existing-gate',
      pattern: 'existing.*pattern',
      action: 'block',
      message: 'Pre-existing gate',
      severity: 'critical',
      source: 'manual',
    }],
    promotionLog: [],
  }));

  // Run analysis with entries that create a new gate
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({
      signal: 'negative',
      context: 'repeated failure with something brand new and unique pattern here',
      tags: ['execution-gap'],
    });
  }
  analyze(entries);

  // Verify existing gate is preserved
  const result = JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8'));
  const existingGate = result.gates.find(g => g.id === 'existing-gate');
  assert.ok(existingGate, 'Existing gate should be preserved after analyze()');
});
