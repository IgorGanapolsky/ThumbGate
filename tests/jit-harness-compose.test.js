'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  MODULES,
  classifyTask,
  detectTrainOrCloneAttempt,
  buildJitHarnessComposeReport,
  formatJitHarnessComposeReport,
} = require('../scripts/jit-harness-compose');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'jit-harness-compose.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('MODULES is the JIT four-module protocol', () => {
  assert.deepEqual([...MODULES], ['memory', 'planning', 'action', 'capability']);
});

test('classifyTask maps deploy vocabulary', () => {
  const c = classifyTask('railway deploy production after npm publish');
  assert.equal(c.taskClass, 'deploy');
  assert.ok(c.confidence >= 0.8);
});

test('classifyTask maps review vocabulary', () => {
  const c = classifyTask('read-only code review and risk analysis for this PR');
  assert.equal(c.taskClass, 'review');
});

test('classifyTask maps research vocabulary', () => {
  const c = classifyTask('deep search the arxiv literature on harness intelligence');
  assert.equal(c.taskClass, 'research');
});

test('classifyTask maps code-edit vocabulary', () => {
  const c = classifyTask('implement a fix and refactor the Edit patch in session-lease.js');
  assert.equal(c.taskClass, 'code_edit');
});

test('detectTrainOrCloneAttempt refuses JIT model paths', () => {
  const hits = detectTrainOrCloneAttempt('serve_meta_model.sh JIT-Agent-27B from huggingface.co/JIT-Agent');
  assert.ok(hits.includes('jit_model_serve') || hits.includes('jit_model_download'));
});

test('report refuses clone attempts with status=fail', () => {
  const report = buildJitHarnessComposeReport({
    task: 'clone HarnessFactory and emit free-form harness code',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'jit_clone_refused'));
  assert.match(formatJitHarnessComposeReport(report), /Refusing JIT/);
});

test('compose report maps four modules onto existing rails', () => {
  const report = buildJitHarnessComposeReport({
    task: 'implement PreToolUse gate fix for session-lease path',
  });
  assert.equal(report.name, 'thumbgate-jit-harness-compose');
  assert.ok(['ready', 'ready_with_warnings'].includes(report.status));
  assert.equal(report.taskClass, 'code_edit');
  assert.ok(report.modules.memory.rails.length >= 1);
  assert.ok(report.modules.planning.rails.some((r) => /agent-loop|GSD/i.test(r)));
  assert.ok(report.modules.action.rails.some((r) => /gates|PreToolUse/i.test(r)));
  assert.ok(report.modules.capability.subagentProfile);
  assert.equal(report.compareNotClone, true);
  assert.match(report.disclaimer, /Not affiliated/);
});

test('explicit --class overrides classifier', () => {
  const report = buildJitHarnessComposeReport({
    task: 'implement a fix',
    taskClass: 'secure',
  });
  assert.equal(report.taskClass, 'secure');
  assert.equal(report.confidence, 1);
  assert.equal(report.modules.capability.subagentProfile, 'secure_runtime');
});

test('map-only includes module catalog and task classes', () => {
  const report = buildJitHarnessComposeReport({ map: true, task: '' });
  assert.equal(report.map.length, 4);
  assert.ok(report.taskClasses.includes('code_edit'));
});

test('script CLI --json exits 0 for code-edit compose', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--task=implement a patch for gates-engine.js',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.taskClass, 'code_edit');
  assert.ok(payload.modules.action);
});

test('thumbgate CLI jit-harness-compose is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'jit-harness-compose',
    '--task=review this PR for risk',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-jit-harness-compose');
  assert.equal(payload.taskClass, 'review');
});

test('docs mention FORMAT steal without claiming a JIT SKU', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'jit-harness-compose.md'),
    'utf8'
  );
  assert.match(doc, /jit-harness-compose|memory|planning|action|capability/i);
  assert.match(doc, /not affiliated|compare-not-clone|do not train/i);
  assert.doesNotMatch(doc, /npm install jit-agent|pip install jit-agent/i);
});
