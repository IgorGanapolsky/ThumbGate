'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  GOVERNANCE_STEPS,
  classifyIntent,
  detectOffensiveGrant,
  detectCloneAttempt,
  buildIntentGovernedExecutionReport,
  formatIntentGovernedExecutionReport,
} = require('../scripts/intent-governed-execution');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'intent-governed-execution.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('GOVERNANCE_STEPS is the six-step CyberStrike FORMAT spine', () => {
  assert.deepEqual(
    GOVERNANCE_STEPS.map((s) => s.id),
    ['classify', 'authorize', 'gate', 'hitl', 'execute', 'evidence']
  );
});

test('classifyIntent maps offensive tooling to offensive_cyber', () => {
  const c = classifyIntent('run nuclei and sqlmap against the target');
  assert.equal(c.intentClass, 'offensive_cyber');
  assert.ok(c.confidence >= 0.85);
});

test('classifyIntent maps deploy vocabulary', () => {
  const c = classifyIntent('railway deploy production after npm publish');
  assert.equal(c.intentClass, 'deploy');
});

test('classifyIntent maps review vocabulary', () => {
  const c = classifyIntent('read-only code review and risk analysis');
  assert.equal(c.intentClass, 'review');
});

test('offensive grant is fail-closed by default', () => {
  assert.equal(detectOffensiveGrant({}), false);
  assert.equal(detectOffensiveGrant({ THUMBGATE_ALLOW_OFFENSIVE: '1' }), true);
});

test('detectCloneAttempt refuses CyberStrike / Eino SKU paths', () => {
  const hits = detectCloneAttempt('clone CyberStrikeAI and vendor cloudwego eino');
  assert.ok(hits.includes('cyberstrike_clone') || hits.includes('eino_framework_clone'));
});

test('offensive intent without grant fails closed', () => {
  const report = buildIntentGovernedExecutionReport({
    intent: 'run nmap and metasploit against the host',
    env: {},
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'offensive_ungranted'));
  assert.match(formatIntentGovernedExecutionReport(report), /Offensive grant: no/);
});

test('offensive intent with grant still requires HITL until --approved', () => {
  const report = buildIntentGovernedExecutionReport({
    intent: 'authorized nuclei scan on systems we own',
    env: { THUMBGATE_ALLOW_OFFENSIVE: '1' },
  });
  assert.equal(report.governance.offensiveGrant, true);
  assert.equal(report.governance.hitlRequired, true);
  assert.ok(['checkpoint_required', 'ready'].includes(report.status));
  assert.ok(report.findings.some((f) => f.id === 'hitl_required') || report.status === 'checkpoint_required');
});

test('deploy intent with --approved clears HITL warn path to ready when rails present', () => {
  const report = buildIntentGovernedExecutionReport({
    intent: 'railway deploy production',
    approved: true,
  });
  assert.equal(report.intentClass, 'deploy');
  assert.equal(report.governance.approved, true);
  assert.ok(['ready', 'checkpoint_required'].includes(report.status));
  assert.ok(report.governance.steps.some((s) => s.id === 'hitl' && s.status === 'satisfied'));
});

test('clone attempt fails', () => {
  const report = buildIntentGovernedExecutionReport({
    intent: 'clone CyberStrikeAI into ThumbGate',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'cyberstrike_clone_refused'));
});

test('map-only includes step catalog', () => {
  const report = buildIntentGovernedExecutionReport({ map: true });
  assert.equal(report.map.length, 6);
  assert.ok(report.intentClasses.includes('offensive_cyber'));
  assert.equal(report.compareNotClone, true);
});

test('result governance exposes maxChars from subagent profile', () => {
  const report = buildIntentGovernedExecutionReport({
    intent: 'implement a patch in gates-engine.js',
  });
  assert.ok(report.governance.maxChars > 0);
  assert.ok(report.governance.subagentProfile);
});

test('script CLI --json exits 0 for review intent', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--intent=read-only risk analysis of this PR',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.intentClass, 'review');
});

test('thumbgate CLI intent-governed-execution is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'intent-governed-execution',
    '--intent=implement PreToolUse gate fix',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-intent-governed-execution');
});

test('docs refuse CyberStrike SKU clone language', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'intent-governed-execution.md'),
    'utf8'
  );
  assert.match(doc, /intent-governed-execution|human oversight|evidence/i);
  assert.match(doc, /not affiliated|compare-not-clone|do not clone/i);
  assert.doesNotMatch(doc, /npm install cyberstrike|go install.*CyberStrikeAI/i);
});
