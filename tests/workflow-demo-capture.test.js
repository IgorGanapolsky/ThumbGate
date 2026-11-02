'use strict';

// Workflow Demo Capture tests — OpenAdapt FORMAT steal.
// Pattern: demonstration-to-program, no model calls per step, save verification,
// agent-ready interface via MCP tool invocation.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set demo dir to temp before requiring module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test-'));
process.env.THUMBGATE_DEMO_DIR = tmpDir;

const demo = require('../scripts/workflow-demo-capture');

test('captureDemo creates a demo record with valid ID', () => {
  const result = demo.captureDemo({
    notebookId: 'test-notebook-1',
    title: 'Test Demo Capture',
    goal: 'Test the capture function',
    tags: ['test', 'demo'],
  });

  assert.ok(result.demoId);
  assert.ok(result.demoId.includes('test-demo-capture'));
  assert.equal(result.demo.title, 'Test Demo Capture');
  assert.equal(result.demo.goal, 'Test the capture function');
  assert.deepEqual(result.demo.tags, ['test', 'demo']);
  assert.equal(result.demo.status, 'captured');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('captureDemo writes demo JSON, index, and files', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test2-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');
  const result = demoFresh.captureDemo({
    notebookId: 'nb-123',
    title: 'Another Demo',
    goal: 'Another test goal',
  });

  assert.ok(fs.existsSync(path.join(testDir, `${result.demoId}.demo.json`)));
  assert.ok(fs.existsSync(path.join(testDir, `${result.demoId}.index.md`)));

  const demoData = JSON.parse(fs.readFileSync(path.join(testDir, `${result.demoId}.demo.json`), 'utf8'));
  assert.equal(demoData.id, result.demoId);
  assert.equal(demoData.notebookId, 'nb-123');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('compileDemo creates zero model calls per step', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test3-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');

  // Create a demo with some demonstrated steps
  const captureResult = demoFresh.captureDemo({
    notebookId: 'nb-compile',
    title: 'Compile Test',
    goal: 'Test compilation',
  });

  // Manually add steps to the demo
  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['npm test', 'git add .', 'git commit -m "test"'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  const compileResult = demoFresh.compileDemo({ demoId: captureResult.demoId });

  assert.equal(compileResult.compiled.modelCallsPerStep, 0);
  assert.equal(compileResult.compiled.totalSteps, 3);
  assert.equal(compileResult.compiled.requiresApproval, true);
  assert.ok(compileResult.compiled.mcpInterface.toolName);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('compileDemo adds save verification checkpoints', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test4-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');

  const captureResult = demoFresh.captureDemo({ title: 'Verify Test', goal: 'test' });

  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['npm test'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  const compileResult = demoFresh.compileDemo({ demoId: captureResult.demoId });

  const step = compileResult.compiled.steps[0];
  assert.ok(step.preAssertion); // save verification BEFORE
  assert.ok(step.postAssertion); // save verification AFTER

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('replayCompiled runs in dryRun mode without executing', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test5-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');

  const captureResult = demoFresh.captureDemo({ title: 'Replay Dry', goal: 'test' });

  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['echo hello', 'ls /tmp'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  const compileResult = demoFresh.compileDemo({ demoId: captureResult.demoId });

  const replay = demoFresh.replayCompiled({ compiledId: compileResult.compiledId, dryRun: true });

  assert.equal(replay.dryRun, true);
  assert.equal(replay.totalSteps, 2);
  assert.equal(replay.allPassed, true);
  assert.ok(replay.results[0].execution.dryRun);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('replayCompiled blocks execution without approval', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test6-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');

  const captureResult = demoFresh.captureDemo({ title: 'Replay No Approval', goal: 'test' });
  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['echo hello'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  const compileResult = demoFresh.compileDemo({ demoId: captureResult.demoId });

  assert.throws(
    () => demoFresh.replayCompiled({ compiledId: compileResult.compiledId, dryRun: false }),
    /requires approval/
  );

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('verifyState checks pre-condition before execution', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test7-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');
  const captureResult = demoFresh.captureDemo({ title: 'Verify Test', goal: 'test' });
  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['echo hello'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  const compileResult = demoFresh.compileDemo({ demoId: captureResult.demoId });

  const verification = demoFresh.verifyState({
    compiledId: compileResult.compiledId,
    checkpoint: { stepIndex: 0, phase: 'pre' },
  });

  assert.ok(verification.assertions);
  assert.equal(verification.allPassed, true);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('getMcpToolDefinitions returns tools for compiled workflows', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-test8-'));
  process.env.THUMBGATE_DEMO_DIR = testDir;
  delete require.cache[require.resolve('../scripts/workflow-demo-capture')];

  const demoFresh = require('../scripts/workflow-demo-capture');

  const captureResult = demoFresh.captureDemo({ title: 'MCP Test', goal: 'test MCP' });
  const demoPath = path.join(testDir, `${captureResult.demoId}.demo.json`);
  const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  demoData.demonstratedSteps = ['echo hello'];
  fs.writeFileSync(demoPath, JSON.stringify(demoData, null, 2));

  demoFresh.compileDemo({ demoId: captureResult.demoId });

  const tools = demoFresh.getMcpToolDefinitions();
  assert.ok(tools.length >= 1);
  assert.ok(tools[0].toolName);
  assert.ok(tools[0].description);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('compileDemo throws for nonexistent demo', () => {
  assert.throws(() => demo.compileDemo({ demoId: 'nonexistent-id-12345' }), /Demo not found/);
});
