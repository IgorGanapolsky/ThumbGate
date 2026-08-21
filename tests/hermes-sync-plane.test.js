'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HermesSyncPlane } = require('../src/hermes-sync-plane.js');

function authorizedPlane() {
  const plane = new HermesSyncPlane();
  plane.authorizeShape({ userId: 'igor', threadId: 'thr_1', recordId: 'rec-1' });
  return plane;
}

test('poll without cursor fails closed cursor_required', () => {
  const plane = authorizedPlane();
  const poll = plane.pollControlPlane({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    offset: 0,
  });
  assert.equal(poll.ok, false);
  assert.equal(poll.reason, 'cursor_required');
});

test('status client without offset fails closed cursor_required', () => {
  const plane = authorizedPlane();
  const read = plane.readStatus({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    cursor: 'c-1',
  });
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'cursor_required');
});

test('reactive read-path with offset+cursor and auth succeeds', () => {
  const plane = authorizedPlane();
  plane.appendEvent({ threadId: 'thr_1', recordId: 'rec-1', type: 'run', txnId: 'txn-1' });
  const read = plane.readStatus({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
    mode: 'product',
    offset: 0,
    cursor: 'c-1',
  });
  assert.equal(read.ok, true);
  assert.equal(read.cursor, 'c-1');
  assert.ok(read.events.length >= 1);
});

test('missing auth on run events fails shape_unauthorized', () => {
  const plane = authorizedPlane();
  const missing = plane.readRunEvents({
    threadId: 'thr_1',
    recordId: 'rec-1',
    offset: 0,
    cursor: 'c-1',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'shape_unauthorized');
});

test('auth not mapped to the user thread fails shape_unauthorized', () => {
  const plane = authorizedPlane();
  const other = plane.readRunEvents({
    auth: { userId: 'stranger' },
    threadId: 'thr_1',
    recordId: 'rec-1',
    offset: 0,
    cursor: 'c-1',
  });
  assert.equal(other.ok, false);
  assert.equal(other.reason, 'shape_unauthorized');
});

test('product-mode dump of whole history fails subset_required', () => {
  const plane = authorizedPlane();
  const dump = plane.readRunEvents({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    mode: 'product',
    dumpAll: true,
    offset: 0,
    cursor: 'c-1',
  });
  assert.equal(dump.ok, false);
  assert.equal(dump.reason, 'subset_required');
});

test('product-mode read without recordId/threadId subset fails subset_required', () => {
  const plane = new HermesSyncPlane();
  plane.authorizeShape({ userId: 'igor', threadId: 'thr_orphan' });
  const bare = plane.readStatus({
    auth: { userId: 'igor' },
    threadId: 'thr_orphan',
    mode: 'product',
    offset: 0,
    cursor: 'c-1',
  });
  assert.equal(bare.ok, false);
  assert.equal(bare.reason, 'subset_required');
});

test('consequential send/spend/prod/legal cannot apply locally first', () => {
  const plane = authorizedPlane();
  for (const action of ['send', 'spend', 'prod', 'legal']) {
    const local = plane.applyOptimistic({
      txnId: `txn-${action}`,
      field: action,
      action,
      value: true,
    });
    assert.equal(local.ok, false, action);
    assert.equal(local.reason, 'server_authoritative');
  }
});

test('non-consequential optimistic write is allowed until server confirms', () => {
  const plane = authorizedPlane();
  const local = plane.applyOptimistic({
    txnId: 'txn-note',
    field: 'note',
    value: 'draft',
  });
  assert.equal(local.ok, true);
  assert.equal(local.applied, false);
});

test('server reject rolls back optimistic and cannot claim applied', () => {
  const plane = authorizedPlane();
  plane.applyOptimistic({ txnId: 'txn-note', field: 'note', value: 'draft' });
  const rejected = plane.serverWrite({
    txnId: 'txn-note',
    action: 'note',
    accepted: false,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'server_rejected');
  assert.equal(rejected.applied, false);
  assert.equal(rejected.rolledBack, true);
});

test('skip-match before dropping optimistic fails closed', () => {
  const plane = authorizedPlane();
  plane.applyOptimistic({ txnId: 'txn-ok', field: 'note', value: 'x' });
  plane.serverWrite({
    txnId: 'txn-ok',
    action: 'note',
    accepted: true,
    threadId: 'thr_1',
    recordId: 'rec-1',
  });
  const skipped = plane.confirmReadPath({
    txnId: 'txn-ok',
    observedTxnId: 'txn-ok',
    skipMatch: true,
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'txn_mismatch');
  const mismatch = plane.dropOptimistic({ txnId: 'txn-ok', matchedTxnId: 'other' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'txn_mismatch');
  const matched = plane.confirmReadPath({ txnId: 'txn-ok', observedTxnId: 'txn-ok' });
  assert.equal(matched.ok, true);
});

test('cannot claim live/fully_satisfactory on the read-path while turn open or trusted path turning on', () => {
  const plane = authorizedPlane();
  const open = plane.readStatus({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
    mode: 'product',
    offset: 0,
    cursor: 'c-1',
    turnOpen: true,
    status: 'live',
  });
  assert.equal(open.ok, false);
  assert.equal(open.reason, 'claim_blocked');
  const trusted = plane.readStatus({
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
    mode: 'product',
    offset: 0,
    cursor: 'c-1',
    trustedPathTurningOn: true,
    verdict: 'fully_satisfactory',
  });
  assert.equal(trusted.ok, false);
  assert.equal(trusted.reason, 'claim_blocked');
});

test('Mac / laptop / Continuity cannot be the source of truth', () => {
  const plane = authorizedPlane();
  for (const host of ['mac', 'laptop', 'continuity', 'mac-pair', 'local-first']) {
    const set = plane.setSourceOfTruth({ host });
    assert.equal(set.ok, false, host);
    assert.equal(set.reason, 'host_not_authoritative');
  }
  assert.equal(plane.setSourceOfTruth({ host: 'vps' }).ok, true);
  assert.equal(plane.setSourceOfTruth({ host: 'thumbgate.app' }).ok, true);
});

test('overnight loop stays on VPS + thumbgate.app when the laptop sleeps', () => {
  const plane = authorizedPlane();
  plane.setSourceOfTruth({ host: 'vps' });
  const night = plane.overnightLoop({ laptopAwake: false });
  assert.equal(night.ok, true);
  assert.equal(night.wedge, 'laptop_sleep');
  assert.equal(night.writer, 'vps');
  assert.equal(night.sync, 'thumbgate.app');
});

test('a product read cannot widen past the record the shape authorized', () => {
  const plane = authorizedPlane();
  plane.appendEvent({ threadId: 'thr_1', recordId: 'rec-1', type: 'run' });
  plane.appendEvent({ threadId: 'thr_1', recordId: 'secret', type: 'run' });

  // Asking for a record the shape did not authorize is refused outright.
  const crossed = plane.readStatus({
    offset: 0,
    cursor: 'c1',
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'secret',
    mode: 'product',
  });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.reason, 'record_unauthorized');

  // Omitting the record does not sweep the whole thread — the shape binds it.
  const swept = plane.readStatus({
    offset: 0,
    cursor: 'c1',
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    mode: 'product',
  });
  assert.equal(swept.ok, true);
  assert.equal(swept.recordId, 'rec-1');
  assert.deepEqual(swept.events.map((ev) => ev.recordId), ['rec-1']);
});

test('nextOffset is an exclusive cursor and never replays the last event', () => {
  const plane = authorizedPlane();
  plane.appendEvent({ threadId: 'thr_1', recordId: 'rec-1', type: 'run' });

  const first = plane.readStatus({
    offset: 0,
    cursor: 'c1',
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
  });
  assert.equal(first.ok, true);
  assert.equal(first.events.length, 1);

  // Following the documented contract must not re-deliver the same event.
  const second = plane.readStatus({
    offset: first.nextOffset,
    cursor: first.cursor,
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.events, []);

  // A genuinely new event still arrives at that cursor.
  plane.appendEvent({ threadId: 'thr_1', recordId: 'rec-1', type: 'run' });
  const third = plane.readStatus({
    offset: second.nextOffset,
    cursor: second.cursor,
    auth: { userId: 'igor' },
    threadId: 'thr_1',
    recordId: 'rec-1',
  });
  assert.equal(third.ok, true);
  assert.equal(third.events.length, 1);
});
