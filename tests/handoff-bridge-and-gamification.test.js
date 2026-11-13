'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { AgentIdeHandoffBridge } = require('../src/agent-ide-handoff-bridge');
const { HarnessGamificationEngine } = require('../src/harness-gamification-engine');

test('AgentIdeHandoffBridge exports and loads session handoffs with IDE deep-links', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
  const bridge = new AgentIdeHandoffBridge({ handoffDir: tmpDir });

  const exportResult = bridge.exportSessionHandoff({
    sessionId: 'sess_test_123',
    taskTitle: 'Implement Scatter Query Linter',
    agentName: 'poolside',
    repoPath: '/tmp/repo',
    checklist: [
      { title: 'Detect missing shard key', done: true },
      { title: 'Integrate with CI pipeline', done: false },
    ],
    decisions: [{ title: 'Partition key', reason: 'Use channel_id' }],
    remainingBlockers: ['Test with SQLite in-memory driver'],
  });

  assert.equal(exportResult.ok, true);
  assert.equal(exportResult.sessionId, 'sess_test_123');
  assert.ok(fs.existsSync(exportResult.handoffPath));
  assert.ok(fs.existsSync(exportResult.promptPath));

  const loaded = bridge.loadSessionHandoff('sess_test_123');
  assert.equal(loaded.taskTitle, 'Implement Scatter Query Linter');
  assert.equal(loaded.agent.name, 'poolside');
  assert.equal(loaded.checklist.length, 2);
  assert.equal(loaded.ideLinks.cursor, 'cursor://file/tmp/repo');

  const promptContent = fs.readFileSync(exportResult.promptPath, 'utf8');
  assert.ok(promptContent.includes('# 🚀 Resume Task'));
  assert.ok(promptContent.includes('cursor://file/tmp/repo'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('HarnessGamificationEngine scores 10 gates and emits SVG badge', () => {
  const engine = new HarnessGamificationEngine();

  // Test full 10-gate pass
  const eval10 = engine.evaluateHarness({});
  assert.equal(eval10.score, 10);
  assert.equal(eval10.isCertified, true);
  assert.equal(eval10.tier, 'AUTONOMOUS_PRODUCTION_READY');

  const svg = engine.generateBadgeSvg(eval10.score, eval10.maxScore, eval10.tier);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('10/10 VERIFIED'));

  // Test partial pass
  const evalPartial = engine.evaluateHarness({ gate_1: false, gate_2: false, gate_3: false });
  assert.equal(evalPartial.score, 7);
  assert.equal(evalPartial.isCertified, false);
  assert.equal(evalPartial.tier, 'HARDENED_HARNESS');
});
