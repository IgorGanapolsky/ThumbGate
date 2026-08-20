'use strict';

/**
 * Hermes sync plane — hosted Hermes ($10) only, in-app.
 *
 * Steal from James Arthur / QCon / InfoQ "Why Fetch When You Can Sync?"
 * (Electric + TanStack DB patterns) WITHOUT those dependencies:
 *   - Reactive read-path with offset+cursor (poll-without-cursor fails closed).
 *   - Authorized shape is the outer boundary; product reads need a subset.
 *   - Server-authoritative writes; optimistic only for non-consequential fields.
 *   - Match txnId on the read-path before dropping optimistic.
 *   - VPS + thumbgate.app are the source of truth; laptop sleep is the wedge.
 *
 * Source: https://www.infoq.com/presentations/local-first-sync-engine/
 *
 * Refuse: ElectricSQL, TanStack DB, Convex, Instant, Jazz, PowerSync, Zero,
 * CRDTs, Yjs, Automerge, WebSocket stateful protocol, Continuity, Mac-pair,
 * local-first as the public offer, Workers Paid.
 */

const CONSEQUENTIAL_FIELDS = Object.freeze(['send', 'spend', 'prod', 'legal']);
const FORBIDDEN_TRUTH_HOSTS = Object.freeze([
  'mac',
  'laptop',
  'continuity',
  'mac-pair',
  'local-first',
]);
const VALID_TRUTH_HOSTS = Object.freeze(['vps', 'thumbgate.app']);

function fail(reason, extra) {
  return extra ? { ok: false, reason, ...extra } : { ok: false, reason };
}

function ok(extra) {
  return extra ? { ok: true, ...extra } : { ok: true };
}

class HermesSyncPlane {
  constructor() {
    this.shapes = new Map();
    this.events = [];
    this.optimistic = new Map();
    this.sourceOfTruth = 'vps';
    this._offset = 0;
  }

  authorizeShape({ userId, threadId, recordId } = {}) {
    if (!userId || !threadId) {
      return fail('shape_unauthorized');
    }
    const key = `${userId}:${threadId}`;
    this.shapes.set(key, { userId, threadId, recordId: recordId || null });
    return ok({ userId, threadId, recordId: recordId || null });
  }

  _shapeFor(auth, threadId) {
    if (!auth || !auth.userId) return null;
    if (!threadId) return null;
    return this.shapes.get(`${auth.userId}:${threadId}`) || null;
  }

  /**
   * Reactive read-path. A status client MUST carry offset+cursor.
   * hermes-control-plane poll-without-cursor is the Workers 90% leak anti-pattern.
   */
  readStatus({
    offset,
    cursor,
    auth,
    threadId,
    recordId,
    mode,
    dumpAll,
    turnOpen,
    trustedPathTurningOn,
    status,
    verdict,
  } = {}) {
    if (cursor == null || cursor === '' || offset == null || offset === '') {
      return fail('cursor_required');
    }
    if (!auth || !auth.userId) {
      return fail('shape_unauthorized');
    }
    const shape = this._shapeFor(auth, threadId);
    if (!shape) {
      return fail('shape_unauthorized');
    }
    if (dumpAll === true) {
      return fail('subset_required');
    }
    if (mode === 'product' && !recordId && !threadId) {
      return fail('subset_required');
    }
    if (mode === 'product' && !recordId && !shape.recordId) {
      return fail('subset_required');
    }
    if (status === 'live' || verdict === 'fully_satisfactory') {
      if (turnOpen === true || trustedPathTurningOn === true) {
        return fail('claim_blocked', { turnOpen: Boolean(turnOpen), trustedPathTurningOn: Boolean(trustedPathTurningOn) });
      }
    }
    const from = Number(offset) || 0;
    const events = this.events.filter((ev) => {
      if (ev.offset < from) return false;
      if (threadId && ev.threadId !== threadId) return false;
      if (recordId && ev.recordId && ev.recordId !== recordId) return false;
      return true;
    });
    return ok({
      offset: from,
      cursor,
      events,
      nextOffset: this._offset,
    });
  }

  pollControlPlane(args = {}) {
    // Named anti-pattern: dashboard poll loop. Fail closed without cursor.
    return this.readStatus(args);
  }

  readRunEvents(args = {}) {
    return this.readStatus(args);
  }

  appendEvent({ threadId, recordId, type, txnId, payload } = {}) {
    this._offset += 1;
    const event = {
      offset: this._offset,
      threadId: threadId || null,
      recordId: recordId || null,
      type: type || 'run',
      txnId: txnId || null,
      payload: payload || null,
    };
    this.events.push(event);
    return ok({ event });
  }

  applyOptimistic({ txnId, field, value, action } = {}) {
    const consequential = CONSEQUENTIAL_FIELDS.includes(action)
      || CONSEQUENTIAL_FIELDS.includes(field);
    if (consequential) {
      return fail('server_authoritative', { action: action || field });
    }
    if (!txnId) return fail('txn_required');
    this.optimistic.set(txnId, {
      txnId,
      field,
      value,
      applied: false,
      local: true,
    });
    return ok({ txnId, field, value, local: true, applied: false });
  }

  serverWrite({ txnId, action, accepted, field, value, threadId, recordId } = {}) {
    if (CONSEQUENTIAL_FIELDS.includes(action) && accepted !== true) {
      const prior = this.optimistic.get(txnId);
      if (prior) {
        this.optimistic.delete(txnId);
      }
      return fail('server_rejected', {
        txnId,
        action,
        applied: false,
        rolledBack: Boolean(prior),
      });
    }
    if (accepted !== true) {
      const prior = this.optimistic.get(txnId);
      if (prior) this.optimistic.delete(txnId);
      return fail('server_rejected', {
        txnId,
        applied: false,
        rolledBack: Boolean(prior),
      });
    }
    this.appendEvent({ threadId, recordId, type: 'write', txnId, payload: { field, value, action } });
    return ok({ txnId, applied: true, server: true });
  }

  dropOptimistic({ txnId, matchedTxnId } = {}) {
    if (!txnId || !matchedTxnId || txnId !== matchedTxnId) {
      return fail('txn_mismatch', { txnId, matchedTxnId });
    }
    const prior = this.optimistic.get(txnId);
    this.optimistic.delete(txnId);
    return ok({ txnId, dropped: Boolean(prior) });
  }

  confirmReadPath({ txnId, observedTxnId, skipMatch } = {}) {
    if (skipMatch === true) {
      return fail('txn_mismatch', { skipMatch: true });
    }
    return this.dropOptimistic({ txnId, matchedTxnId: observedTxnId });
  }

  setSourceOfTruth({ host } = {}) {
    if (!host || FORBIDDEN_TRUTH_HOSTS.includes(host)) {
      return fail('host_not_authoritative', { host: host || '' });
    }
    if (!VALID_TRUTH_HOSTS.includes(host)) {
      return fail('host_not_authoritative', { host });
    }
    this.sourceOfTruth = host;
    return ok({ host, sourceOfTruth: host });
  }

  overnightLoop({ laptopAwake } = {}) {
    if (this.sourceOfTruth !== 'vps' && this.sourceOfTruth !== 'thumbgate.app') {
      return fail('host_not_authoritative', { host: this.sourceOfTruth });
    }
    // Laptop sleep is the wedge; humans stay in loop because VPS writes and
    // thumbgate.app syncs. Mac is never the source of truth.
    return ok({
      laptopAwake: laptopAwake === true,
      wedge: laptopAwake === true ? null : 'laptop_sleep',
      writer: 'vps',
      sync: 'thumbgate.app',
    });
  }
}

module.exports = {
  HermesSyncPlane,
  CONSEQUENTIAL_FIELDS,
  FORBIDDEN_TRUTH_HOSTS,
  VALID_TRUTH_HOSTS,
};
