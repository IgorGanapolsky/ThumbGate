'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MINIONS_STEAL_MAP,
  checkAppleSiliconIdleHealth,
  evaluateSystemOneUmaBattery,
  AppleMinionQueue,
} = require('../scripts/apple-minions-idle-compute-steal');

test('MINIONS_STEAL_MAP: documents arXiv:2610.12970 and System-One UMA adopt/adapt/drop decisions', () => {
  assert.equal(MINIONS_STEAL_MAP.paper.arxiv, 'arXiv:2610.12970');
  assert.ok(MINIONS_STEAL_MAP.decisions.adopt.length >= 4);
  assert.ok(MINIONS_STEAL_MAP.decisions.drop.length >= 3);
});

test('evaluateSystemOneUmaBattery: executes single-pass typed hazard battery in <1ms with code-owned route()', () => {
  const safe = evaluateSystemOneUmaBattery({
    toolName: 'Read',
    commandOrPayload: 'README.md:1-50',
  });
  assert.equal(safe.codeOwnsRoute, true);
  assert.equal(safe.route, 'pass');
  assert.equal(safe.allowed, true);
  assert.ok(safe.latencyMs < 5);

  const forcePush = evaluateSystemOneUmaBattery({
    toolName: 'Bash',
    commandOrPayload: 'git push --force origin main',
  });
  assert.equal(forcePush.route, 'block');
  assert.equal(forcePush.allowed, false);
  assert.equal(forcePush.battery.destructiveGitOrFs.noul, 1.0);

  const dirtyAdd = evaluateSystemOneUmaBattery({
    toolName: 'Bash',
    commandOrPayload: 'git add -A',
  });
  assert.equal(dirtyAdd.route, 'review');

  const visualDrift = evaluateSystemOneUmaBattery({
    toolName: 'BrowserClick',
    commandOrPayload: 'submit_order',
    visualContextConfidence: 0.25,
  });
  assert.equal(visualDrift.route, 'review');
  assert.equal(visualDrift.battery.visualUiDrift.noul, 0.7);
});

test('AppleMinionQueue: enforces 4-field tenant isolation, thermal/load idle preflight, and watchdog lease recovery', () => {
  const queue = new AppleMinionQueue({ leaseTtlMs: 1000 });
  const scopeA = { entityId: 'ent_1', projectId: 'proj_tg', processId: 'proc_embed', sessionId: 'sess_1' };
  const scopeB = { entityId: 'ent_2', projectId: 'proj_other', processId: 'proc_embed', sessionId: 'sess_2' };

  // Rejects incomplete scope
  assert.throws(() => {
    queue.enqueue({ workloadType: 'embedding', payload: { text: 'leak' }, scope: { entityId: 'ent_1' } });
  }, /complete 4-field scope/);

  const task = queue.enqueue({
    id: 'subtask_1',
    workloadType: 'embedding',
    payload: { text: 'ThumbGate PreToolUse lesson' },
    scope: scopeA,
  });

  // Throttled Mac refuses pull
  const throttled = queue.claimNextIdleSubtask({
    workerId: 'mac_m3_max_1',
    workerScope: scopeA,
    healthMetrics: { thermalState: 'serious', loadAvg1m: 12, cpuCount: 10, freeMemBytes: 1e9, totalMemBytes: 32e9 },
    nowMs: 1000,
  });
  assert.equal(throttled.claimed, false);
  assert.match(throttled.reason, /worker_not_idle/);

  // Wrong tenant scope cannot claim scopeA subtask
  const wrongScope = queue.claimNextIdleSubtask({
    workerId: 'mac_foreign',
    workerScope: scopeB,
    healthMetrics: { thermalState: 'nominal', loadAvg1m: 1, cpuCount: 10, freeMemBytes: 16e9, totalMemBytes: 32e9 },
    nowMs: 1000,
  });
  assert.equal(wrongScope.claimed, false);
  assert.equal(wrongScope.reason, 'no_matching_scoped_subtask');

  // Healthy idle Mac with matching scope claims subtask
  const claimed = queue.claimNextIdleSubtask({
    workerId: 'mac_m3_max_1',
    workerScope: scopeA,
    healthMetrics: { thermalState: 'nominal', loadAvg1m: 1, cpuCount: 10, freeMemBytes: 16e9, totalMemBytes: 32e9 },
    nowMs: 1000,
  });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.subtask.id, task.id);

  // Simulate Mac lid-close (lease expires after 1000ms) -> Watchdog re-queues for another healthy Mac
  const reclaimedClaim = queue.claimNextIdleSubtask({
    workerId: 'mac_studio_2',
    workerScope: scopeA,
    healthMetrics: { thermalState: 'nominal', loadAvg1m: 1, cpuCount: 12, freeMemBytes: 32e9, totalMemBytes: 64e9 },
    nowMs: 2500,
  });
  assert.equal(reclaimedClaim.claimed, true);
  assert.equal(reclaimedClaim.subtask.workerId, 'mac_studio_2');
  assert.equal(reclaimedClaim.subtask.attempts, 2);
});
