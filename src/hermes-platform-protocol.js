'use strict';

/**
 * Hermes platform protocol — hosted Hermes ($10) only.
 *
 * Steals the Codex app-server initialize → thread → turn lifecycle and
 * Slack/NanoClaw named manager/child identity gates. Approvals stay on
 * thumbgate.app / in_app_approval. No second harness, no Slack Marketplace,
 * no Continuity / Mac-pair / phone leash.
 *
 * Sources:
 *   https://developers.openai.com/blog/codex-as-a-platform
 *   https://thenewstack.io/add-to-slack-agents/
 */

const FORBIDDEN_IDENTITIES = Object.freeze(['foo', 'bar', 'shared', 'anonymous']);
const THREAD_MODES = Object.freeze(['exec', 'interactive', 'product']);
const CONSEQUENTIAL_ACTIONS = Object.freeze(['send', 'spend', 'prod', 'legal']);
const VALID_APPROVAL_SURFACES = Object.freeze(['thumbgate.app', 'in_app_approval']);
const INVALID_APPROVAL_SURFACES = Object.freeze([
  'slack_mention',
  'chat_toast',
  'mobile',
  'phone_leash',
]);

function fail(reason, extra) {
  return extra ? { ok: false, reason, ...extra } : { ok: false, reason };
}

function ok(extra) {
  return extra ? { ok: true, ...extra } : { ok: true };
}

function isNamedIdentity(value) {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  if (!id) return false;
  return !FORBIDDEN_IDENTITIES.includes(id);
}

function asScopeList(scopes) {
  if (scopes == null) return null;
  if (!Array.isArray(scopes)) return null;
  return scopes.map((s) => String(s));
}

function isSubset(childScopes, parentScopes) {
  const parent = new Set(parentScopes);
  return childScopes.every((scope) => parent.has(scope));
}

class ProtocolError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

class HermesPlatformProtocol {
  constructor() {
    this.managers = new Map();
    this.children = new Map();
    this.connections = new Map();
    this.threads = new Map();
    this.turns = new Map();
    this.approvals = new Map();
    this._approvalSeq = 0;
    this._threadSeq = 0;
    this._turnSeq = 0;
  }

  registerManager({ managerId, scopes } = {}) {
    if (!isNamedIdentity(managerId)) {
      return fail('invalid_identity', { managerId: managerId || '' });
    }
    const scopeList = asScopeList(scopes);
    if (scopeList == null) {
      return fail('scope_missing');
    }
    const record = {
      managerId,
      scopes: Object.freeze([...scopeList]),
      registeredAt: Date.now(),
    };
    this.managers.set(managerId, record);
    return ok({ managerId, scopes: record.scopes });
  }

  mintChild({ managerId, agentId, scopes } = {}) {
    if (!isNamedIdentity(managerId) || !isNamedIdentity(agentId)) {
      return fail('invalid_identity', { managerId, agentId });
    }
    const manager = this.managers.get(managerId);
    if (!manager) {
      return fail('manager_missing', { managerId });
    }
    const scopeList = asScopeList(scopes);
    if (scopeList == null) {
      return fail('scope_missing');
    }
    if (!isSubset(scopeList, manager.scopes)) {
      return fail('scope_exceeds_parent', { managerId, agentId });
    }
    const record = {
      managerId,
      agentId,
      scopes: Object.freeze([...scopeList]),
      mintedAt: Date.now(),
    };
    this.children.set(agentId, record);
    return ok({ managerId, agentId, scopes: record.scopes });
  }

  initialize({ connectionId } = {}) {
    if (!connectionId || typeof connectionId !== 'string') {
      return fail('connection_required');
    }
    this.connections.set(connectionId, {
      connectionId,
      initialized: true,
      initializedAt: Date.now(),
    });
    return ok({ connectionId, initialized: true });
  }

  _requireConnection(connectionId) {
    if (!connectionId || !this.connections.has(connectionId)) {
      return fail('not_initialized');
    }
    return null;
  }

  _getThread(threadId) {
    return threadId ? this.threads.get(threadId) : undefined;
  }

  createThread({ connectionId, mode, recordId } = {}) {
    const denied = this._requireConnection(connectionId);
    if (denied) return denied;
    if (!THREAD_MODES.includes(mode)) {
      return fail('invalid_mode', { mode });
    }
    this._threadSeq += 1;
    const threadId = `thr_${this._threadSeq}`;
    const thread = {
      threadId,
      connectionId,
      mode,
      recordId: recordId || null,
      archived: false,
      route: 'primary',
      tombstone: null,
      pendingRefresh: false,
      lastWriteTxnId: null,
    };
    this.threads.set(threadId, thread);
    return ok({ threadId, mode, recordId: thread.recordId });
  }

  startTurn({ connectionId, threadId, input, recordId } = {}) {
    const denied = this._requireConnection(connectionId);
    if (denied) return denied;
    const thread = this._getThread(threadId);
    if (!thread || thread.connectionId !== connectionId) {
      return fail('thread_missing', { threadId });
    }
    if (thread.archived) {
      return fail('thread_archived', { threadId });
    }
    const effectiveRecord = recordId || thread.recordId;
    if (thread.mode === 'product' && !effectiveRecord) {
      return fail('record_required');
    }
    this._turnSeq += 1;
    const turnId = `turn_${this._turnSeq}`;
    const turn = {
      turnId,
      threadId,
      connectionId,
      input: input || '',
      recordId: effectiveRecord || null,
      open: true,
      interrupted: false,
      trustedPathTurningOn: false,
      status: 'running',
      verdict: null,
    };
    this.turns.set(turnId, turn);
    thread.openTurnId = turnId;
    if (effectiveRecord) thread.recordId = effectiveRecord;
    return ok({ turnId, threadId, recordId: turn.recordId, open: true });
  }

  streamEvent({ connectionId, threadId, event } = {}) {
    const denied = this._requireConnection(connectionId);
    if (denied) return denied;
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    const payload = event && typeof event === 'object' ? event : {};
    if (payload.status === 'live' || payload.verdict === 'fully_satisfactory') {
      const trustedOn = payload.trustedPathTurningOn === true
        || (turn && turn.trustedPathTurningOn === true);
      if ((turn && turn.open) || trustedOn) {
        return fail('claim_blocked', {
          status: payload.status || null,
          verdict: payload.verdict || null,
          turnOpen: Boolean(turn && turn.open),
          trustedPathTurningOn: trustedOn,
        });
      }
    }
    return ok({
      threadId,
      event: payload,
      streamed: true,
    });
  }

  interruptTurn({ connectionId, threadId } = {}) {
    const denied = this._requireConnection(connectionId);
    if (denied) return denied;
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    if (!turn || !turn.open) {
      return fail('turn_not_open', { threadId });
    }
    turn.open = false;
    turn.interrupted = true;
    turn.status = 'interrupted';
    thread.openTurnId = null;
    return ok({ threadId, turnId: turn.turnId, interrupted: true });
  }

  archiveThread({ connectionId, threadId } = {}) {
    const denied = this._requireConnection(connectionId);
    if (denied) return denied;
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    if (turn && turn.open) {
      turn.open = false;
      turn.status = 'archived';
      thread.openTurnId = null;
    }
    thread.archived = true;
    return ok({ threadId, archived: true });
  }

  setTrustedPathTurningOn({ threadId, trustedPathTurningOn } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    if (turn) turn.trustedPathTurningOn = trustedPathTurningOn === true;
    thread.trustedPathTurningOn = trustedPathTurningOn === true;
    return ok({ threadId, trustedPathTurningOn: trustedPathTurningOn === true });
  }

  claimOutcome({ threadId, status, verdict, trustedPathTurningOn } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    const turnOpen = Boolean(turn && turn.open);
    const trustedOn = trustedPathTurningOn === true
      || (turn && turn.trustedPathTurningOn === true)
      || thread.trustedPathTurningOn === true;
    if (status === 'live' || verdict === 'fully_satisfactory') {
      if (turnOpen || trustedOn) {
        return fail('claim_blocked', {
          turnOpen,
          trustedPathTurningOn: trustedOn,
        });
      }
    }
    if (turn) {
      if (status) turn.status = status;
      if (verdict) turn.verdict = verdict;
    }
    return ok({ threadId, status: status || null, verdict: verdict || null });
  }

  endTurn({ threadId } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    if (!turn || !turn.open) return fail('turn_not_open', { threadId });
    turn.open = false;
    turn.status = 'completed';
    thread.openTurnId = null;
    return ok({ threadId, turnId: turn.turnId, open: false });
  }

  failoverRoute({ threadId, nextRoute } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    if (!nextRoute || typeof nextRoute !== 'string') {
      return fail('route_required');
    }
    thread.route = nextRoute;
    // Same thread, no FAILED tombstone — the next route inherits the turn.
    thread.tombstone = null;
    const turn = thread.openTurnId ? this.turns.get(thread.openTurnId) : null;
    return ok({
      threadId,
      route: nextRoute,
      tombstone: null,
      turnOpen: Boolean(turn && turn.open),
      sameThread: true,
    });
  }

  requestApproval({
    connectionId,
    threadId,
    action,
    surface,
    handler,
    actorId,
    autoApprove,
  } = {}) {
    if (connectionId) {
      const denied = this._requireConnection(connectionId);
      if (denied) return denied;
    }
    if (!CONSEQUENTIAL_ACTIONS.includes(action)) {
      return fail('not_consequential', { action });
    }
    const approvalHandler = handler || surface;
    if (!approvalHandler) {
      return fail('handler_missing');
    }
    if (
      INVALID_APPROVAL_SURFACES.includes(approvalHandler)
      || !VALID_APPROVAL_SURFACES.includes(approvalHandler)
    ) {
      return fail('invalid_approval_surface', { surface: approvalHandler });
    }
    const thread = threadId ? this._getThread(threadId) : null;
    const mode = thread ? thread.mode : null;
    if (autoApprove === true && mode === 'exec' && ['send', 'spend', 'prod'].includes(action)) {
      return fail('exec_auto_approve_forbidden', { action, mode });
    }
    this._approvalSeq += 1;
    const approvalId = `apr_${this._approvalSeq}`;
    const record = {
      approvalId,
      threadId: threadId || null,
      action,
      surface: approvalHandler,
      actorId: actorId || null,
      status: 'pending',
      event: 'approval-request',
    };
    this.approvals.set(approvalId, record);
    return ok({
      approvalId,
      event: 'approval-request',
      action,
      surface: approvalHandler,
    });
  }

  approve({ approvalId, approverId, autoApprove } = {}) {
    const record = approvalId ? this.approvals.get(approvalId) : null;
    if (!record) return fail('approval_missing', { approvalId });
    if (!approverId) return fail('approver_required');
    if (record.actorId && record.actorId === approverId) {
      return fail('self_approve_forbidden', { actorId: record.actorId });
    }
    const thread = record.threadId ? this._getThread(record.threadId) : null;
    const mode = thread ? thread.mode : null;
    if (
      autoApprove === true
      && mode === 'exec'
      && ['send', 'spend', 'prod'].includes(record.action)
    ) {
      return fail('exec_auto_approve_forbidden', { action: record.action, mode });
    }
    record.status = 'approved';
    record.approverId = approverId;
    if (thread && CONSEQUENTIAL_ACTIONS.includes(record.action)) {
      thread.pendingRefresh = true;
    }
    return ok({ approvalId, status: 'approved', action: record.action });
  }

  applyApprovedWrite({ threadId, recordId, skipRefresh, txnId } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    if (skipRefresh === true || thread.pendingRefresh) {
      if (skipRefresh === true) {
        return fail('refresh_required');
      }
    }
    thread.lastWriteTxnId = txnId || `txn_${Date.now()}`;
    thread.pendingRefresh = true;
    thread.recordId = recordId || thread.recordId;
    return ok({
      threadId,
      recordId: thread.recordId,
      txnId: thread.lastWriteTxnId,
      refreshRequired: true,
    });
  }

  refreshBusinessView({ threadId, recordId } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    const target = recordId || thread.recordId;
    if (!target) return fail('record_required');
    thread.pendingRefresh = false;
    thread.lastRefreshedRecordId = target;
    return ok({ threadId, recordId: target, refreshed: true });
  }

  readBusinessView({ threadId, recordId } = {}) {
    const thread = this._getThread(threadId);
    if (!thread) return fail('thread_missing', { threadId });
    if (thread.pendingRefresh) {
      return fail('refresh_required');
    }
    return ok({
      threadId,
      recordId: recordId || thread.recordId,
      view: 'current',
    });
  }

  ingestInbound({ kind, text } = {}) {
    if (kind !== 'mention' && kind !== 'chat') {
      return fail('invalid_inbound_kind', { kind });
    }
    return ok({
      kind,
      text: text || '',
      grants: Object.freeze([]),
      send: false,
      spend: false,
    });
  }
}

module.exports = {
  HermesPlatformProtocol,
  ProtocolError,
  FORBIDDEN_IDENTITIES,
  THREAD_MODES,
  CONSEQUENTIAL_ACTIONS,
  VALID_APPROVAL_SURFACES,
  INVALID_APPROVAL_SURFACES,
  isNamedIdentity,
};
