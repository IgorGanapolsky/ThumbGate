'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HermesPlatformProtocol,
  FORBIDDEN_IDENTITIES,
} = require('../src/hermes-platform-protocol.js');

function readyProtocol(mode = 'interactive', recordId) {
  const proto = new HermesPlatformProtocol();
  proto.registerManager({ managerId: 'ops-lead', scopes: ['send', 'spend', 'read', 'write'] });
  proto.initialize({ connectionId: 'conn-1' });
  const thread = proto.createThread({ connectionId: 'conn-1', mode, recordId });
  return { proto, thread };
}

test('registerManager rejects shared / anonymous / empty identities', () => {
  const proto = new HermesPlatformProtocol();
  for (const managerId of [...FORBIDDEN_IDENTITIES, '', '  ', null, undefined]) {
    const result = proto.registerManager({ managerId, scopes: ['read'] });
    assert.equal(result.ok, false, `expected reject for ${JSON.stringify(managerId)}`);
    assert.equal(result.reason, 'invalid_identity');
  }
});

test('registerManager accepts a named manager with explicit scopes', () => {
  const proto = new HermesPlatformProtocol();
  const result = proto.registerManager({ managerId: 'desk-manager', scopes: ['read', 'write'] });
  assert.equal(result.ok, true);
  assert.equal(result.managerId, 'desk-manager');
});

test('mintChild fails closed on missing or implicit scopes', () => {
  const proto = new HermesPlatformProtocol();
  proto.registerManager({ managerId: 'desk-manager', scopes: ['read', 'write'] });
  const missing = proto.mintChild({ managerId: 'desk-manager', agentId: 'clerk-1' });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'scope_missing');
  const implicit = proto.mintChild({ managerId: 'desk-manager', agentId: 'clerk-1', scopes: null });
  assert.equal(implicit.ok, false);
  assert.equal(implicit.reason, 'scope_missing');
});

test('mintChild cannot exceed parent scopes and rejects shared child ids', () => {
  const proto = new HermesPlatformProtocol();
  proto.registerManager({ managerId: 'desk-manager', scopes: ['read'] });
  const exceed = proto.mintChild({
    managerId: 'desk-manager',
    agentId: 'clerk-1',
    scopes: ['read', 'send'],
  });
  assert.equal(exceed.ok, false);
  assert.equal(exceed.reason, 'scope_exceeds_parent');
  const shared = proto.mintChild({
    managerId: 'desk-manager',
    agentId: 'foo',
    scopes: ['read'],
  });
  assert.equal(shared.ok, false);
  assert.equal(shared.reason, 'invalid_identity');
});

test('mintChild succeeds when child scopes are a subset', () => {
  const proto = new HermesPlatformProtocol();
  proto.registerManager({ managerId: 'desk-manager', scopes: ['read', 'write'] });
  const child = proto.mintChild({
    managerId: 'desk-manager',
    agentId: 'clerk-1',
    scopes: ['read'],
  });
  assert.equal(child.ok, true);
  assert.deepEqual([...child.scopes], ['read']);
});

test('uninitialized connection fails closed on every other call', () => {
  const proto = new HermesPlatformProtocol();
  const calls = [
    proto.createThread({ connectionId: 'c1', mode: 'exec' }),
    proto.startTurn({ connectionId: 'c1', threadId: 'thr_1' }),
    proto.streamEvent({ connectionId: 'c1', threadId: 'thr_1', event: {} }),
    proto.interruptTurn({ connectionId: 'c1', threadId: 'thr_1' }),
    proto.archiveThread({ connectionId: 'c1', threadId: 'thr_1' }),
    proto.requestApproval({ connectionId: 'c1', action: 'send', surface: 'thumbgate.app' }),
  ];
  for (const result of calls) {
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_initialized');
  }
});

test('initialize then createThread accepts exec | interactive | product', () => {
  const proto = new HermesPlatformProtocol();
  assert.equal(proto.initialize({ connectionId: 'c1' }).ok, true);
  for (const mode of ['exec', 'interactive', 'product']) {
    const thread = proto.createThread({
      connectionId: 'c1',
      mode,
      recordId: mode === 'product' ? 'rec-1' : undefined,
    });
    assert.equal(thread.ok, true, mode);
    assert.equal(thread.mode, mode);
  }
  const bad = proto.createThread({ connectionId: 'c1', mode: 'chat' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_mode');
});

test('product mode startTurn without recordId fails record_required', () => {
  const { proto, thread } = readyProtocol('product');
  const result = proto.startTurn({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    input: 'compare recovery',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'record_required');
});

test('product mode startTurn with recordId opens a turn', () => {
  const { proto, thread } = readyProtocol('product');
  const result = proto.startTurn({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    input: 'compare recovery',
    recordId: 'shp-42',
  });
  assert.equal(result.ok, true);
  assert.equal(result.recordId, 'shp-42');
  assert.equal(result.open, true);
});

test('cannot claim live or fully_satisfactory while turn is open', () => {
  const { proto, thread } = readyProtocol('interactive');
  proto.startTurn({ connectionId: 'conn-1', threadId: thread.threadId, input: 'go' });
  const live = proto.claimOutcome({ threadId: thread.threadId, status: 'live' });
  assert.equal(live.ok, false);
  assert.equal(live.reason, 'claim_blocked');
  const verdict = proto.claimOutcome({
    threadId: thread.threadId,
    verdict: 'fully_satisfactory',
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'claim_blocked');
  const streamed = proto.streamEvent({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    event: { status: 'live' },
  });
  assert.equal(streamed.ok, false);
  assert.equal(streamed.reason, 'claim_blocked');
});

test('cannot claim live while trustedPathTurningOn is true', () => {
  const { proto, thread } = readyProtocol('interactive');
  proto.startTurn({ connectionId: 'conn-1', threadId: thread.threadId, input: 'go' });
  proto.endTurn({ threadId: thread.threadId });
  proto.setTrustedPathTurningOn({ threadId: thread.threadId, trustedPathTurningOn: true });
  const live = proto.claimOutcome({
    threadId: thread.threadId,
    status: 'live',
    trustedPathTurningOn: true,
  });
  assert.equal(live.ok, false);
  assert.equal(live.reason, 'claim_blocked');
});

test('failoverRoute keeps the same thread and does not tombstone FAILED', () => {
  const { proto, thread } = readyProtocol('interactive');
  proto.startTurn({ connectionId: 'conn-1', threadId: thread.threadId, input: 'go' });
  const failover = proto.failoverRoute({ threadId: thread.threadId, nextRoute: 'backup-hermes' });
  assert.equal(failover.ok, true);
  assert.equal(failover.threadId, thread.threadId);
  assert.equal(failover.sameThread, true);
  assert.equal(failover.tombstone, null);
  assert.equal(failover.route, 'backup-hermes');
  assert.equal(failover.turnOpen, true);
});

test('archived thread rejects new turns', () => {
  const { proto, thread } = readyProtocol('interactive');
  proto.startTurn({ connectionId: 'conn-1', threadId: thread.threadId, input: 'go' });
  proto.endTurn({ threadId: thread.threadId });
  const archived = proto.archiveThread({ connectionId: 'conn-1', threadId: thread.threadId });
  assert.equal(archived.ok, true);
  const again = proto.startTurn({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    input: 'again',
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'thread_archived');
});

test('consequential send/spend/prod/legal emit approval-request on thumbgate.app', () => {
  const { proto, thread } = readyProtocol('interactive');
  for (const action of ['send', 'spend', 'prod', 'legal']) {
    const req = proto.requestApproval({
      connectionId: 'conn-1',
      threadId: thread.threadId,
      action,
      surface: 'thumbgate.app',
      actorId: 'agent-1',
    });
    assert.equal(req.ok, true, action);
    assert.equal(req.event, 'approval-request');
    assert.equal(req.surface, 'thumbgate.app');
  }
});

test('slack_mention / chat_toast / mobile / phone_leash are not approval handlers', () => {
  const { proto, thread } = readyProtocol('interactive');
  for (const surface of ['slack_mention', 'chat_toast', 'mobile', 'phone_leash']) {
    const req = proto.requestApproval({
      connectionId: 'conn-1',
      threadId: thread.threadId,
      action: 'send',
      surface,
      actorId: 'agent-1',
    });
    assert.equal(req.ok, false, surface);
    assert.equal(req.reason, 'invalid_approval_surface');
  }
});

test('missing approval handler fails closed', () => {
  const { proto, thread } = readyProtocol('interactive');
  const req = proto.requestApproval({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    action: 'spend',
    actorId: 'agent-1',
  });
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'handler_missing');
});

test('actor cannot self-approve', () => {
  const { proto, thread } = readyProtocol('interactive');
  const req = proto.requestApproval({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    action: 'legal',
    handler: 'in_app_approval',
    actorId: 'same-human',
  });
  const approved = proto.approve({ approvalId: req.approvalId, approverId: 'same-human' });
  assert.equal(approved.ok, false);
  assert.equal(approved.reason, 'self_approve_forbidden');
});

test('exec mode cannot auto-approve send/spend/prod', () => {
  const { proto, thread } = readyProtocol('exec');
  for (const action of ['send', 'spend', 'prod']) {
    const req = proto.requestApproval({
      connectionId: 'conn-1',
      threadId: thread.threadId,
      action,
      surface: 'thumbgate.app',
      actorId: 'agent-1',
      autoApprove: true,
    });
    assert.equal(req.ok, false, action);
    assert.equal(req.reason, 'exec_auto_approve_forbidden');
  }
});

test('skip-refresh after approved write fails refresh_required', () => {
  const { proto, thread } = readyProtocol('product', 'rec-9');
  const req = proto.requestApproval({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    action: 'prod',
    surface: 'thumbgate.app',
    actorId: 'agent-1',
  });
  const approved = proto.approve({ approvalId: req.approvalId, approverId: 'human-ops' });
  assert.equal(approved.ok, true);
  const skipped = proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
    skipRefresh: true,
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'refresh_required');
  proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
  });
  const unread = proto.readBusinessView({ threadId: thread.threadId, recordId: 'rec-9' });
  assert.equal(unread.ok, false);
  assert.equal(unread.reason, 'refresh_required');
  const refreshed = proto.refreshBusinessView({ threadId: thread.threadId, recordId: 'rec-9' });
  assert.equal(refreshed.ok, true);
  const view = proto.readBusinessView({ threadId: thread.threadId, recordId: 'rec-9' });
  assert.equal(view.ok, true);
});

test('ingestInbound mention/chat never grants send or spend', () => {
  const proto = new HermesPlatformProtocol();
  for (const kind of ['mention', 'chat']) {
    const inbound = proto.ingestInbound({ kind, text: 'please send and spend $10' });
    assert.equal(inbound.ok, true, kind);
    assert.equal(inbound.send, false);
    assert.equal(inbound.spend, false);
    assert.deepEqual([...inbound.grants], []);
  }
});

test('applyApprovedWrite without a matching approval cannot bypass the gate', () => {
  const { proto, thread } = readyProtocol('product', 'rec-9');

  // A caller holding only a thread id must not be able to write.
  const bare = proto.applyApprovedWrite({ threadId: thread.threadId, recordId: 'rec-9' });
  assert.equal(bare.ok, false);
  assert.equal(bare.reason, 'approval_required');

  // A requested-but-not-yet-approved approval must not be enough either.
  const req = proto.requestApproval({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    action: 'prod',
    surface: 'thumbgate.app',
    actorId: 'agent-1',
  });
  const pending = proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, 'approval_not_granted');

  proto.approve({ approvalId: req.approvalId, approverId: 'human-ops' });
  const applied = proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.approvalId, req.approvalId);

  // One approval authorizes exactly one write — no replay.
  const replay = proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'approval_already_consumed');
});

test('an approval from another thread cannot authorize this thread\'s write', () => {
  const { proto, thread } = readyProtocol('product', 'rec-9');
  const other = proto.createThread({ connectionId: 'conn-1', mode: 'product', recordId: 'rec-8' });
  const req = proto.requestApproval({
    connectionId: 'conn-1',
    threadId: other.threadId,
    action: 'prod',
    surface: 'thumbgate.app',
    actorId: 'agent-1',
  });
  proto.approve({ approvalId: req.approvalId, approverId: 'human-ops' });
  const crossed = proto.applyApprovedWrite({
    threadId: thread.threadId,
    recordId: 'rec-9',
    approvalId: req.approvalId,
  });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.reason, 'approval_thread_mismatch');
});

test('a second startTurn is rejected while the first turn is still open', () => {
  const { proto, thread } = readyProtocol('product', 'rec-9');
  const first = proto.startTurn({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    input: 'one',
  });
  assert.equal(first.ok, true);

  const second = proto.startTurn({
    connectionId: 'conn-1',
    threadId: thread.threadId,
    input: 'two',
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'turn_already_open');
  assert.equal(second.turnId, first.turnId);

  // The original turn is still reachable, so the open-turn guard still bites.
  const blocked = proto.claimOutcome({ threadId: thread.threadId, status: 'live' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'claim_blocked');
  assert.equal(blocked.turnOpen, true);

  assert.equal(proto.endTurn({ threadId: thread.threadId }).ok, true);
  assert.equal(proto.claimOutcome({ threadId: thread.threadId, status: 'live' }).ok, true);
});

test('package entry point exposes the hosted Hermes gates', () => {
  const entry = require('../src/index.js');
  assert.equal(typeof entry.HermesPlatformProtocol, 'function');
  assert.equal(typeof entry.HermesSyncPlane, 'function');
  const proto = new entry.HermesPlatformProtocol();
  assert.equal(proto.initialize({ connectionId: 'conn-entry' }).ok, true);
});
