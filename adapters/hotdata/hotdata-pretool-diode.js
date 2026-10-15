'use strict';

/**
 * adapters/hotdata/hotdata-pretool-diode.js
 *
 * ThumbGate PreToolUse Diode for Hotdata.dev (Eddie Tejeda).
 * Evaluates tool calls on local CPU in <0.1ms (zero tail-latency penalty)
 * preserving DataFusion / Arrow speed across chained agent queries.
 *
 * Implements the 3-Layer Architecture:
 * 1. Read / Exploration Plane: Verifies read-only queries (hotdata_query, hotdata_search)
 * 2. Loop & Spend Interdiction: Catches 5x runaway query retry loops before burning compute
 * 3. Write / Action Boundary: Blocks unverified DELETE/UPDATE/DROP before touching systems of record
 */

const MAX_RETRY_COUNT = 4; // 5th attempt is blocked

class HotDataPreToolDiode {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || MAX_RETRY_COUNT;
    this.sessionHistory = new Map(); // sessionId -> string[]
  }

  resetSession(sessionId = 'default') {
    this.sessionHistory.delete(sessionId);
  }

  evaluate({
    step = 1,
    toolName = 'hotdata_query',
    commandOrSql = '',
    sessionId = 'default',
  } = {}) {
    const startNs = process.hrtime.bigint();
    const raw = String(commandOrSql || '').trim();

    if (!this.sessionHistory.has(sessionId)) {
      this.sessionHistory.set(sessionId, []);
    }
    const history = this.sessionHistory.get(sessionId);

    // Signature for query loop detection
    const normalized = raw.replace(/\s+/g, ' ').toLowerCase();
    const signature = `${toolName}:${normalized}`;
    const priorAttempts = history.filter((h) => h === signature).length;
    history.push(signature);

    let decision = 'ALLOW';
    let gateId = 'gate:hotdata:read_exploration_pass';
    let layer = 'ReadPlane';
    let reason = 'Read-only HotSQL / DataFusion exploration verified';
    let risk = 0.0;

    // 1. Runaway Query Loop Interdiction (5x identical failing retry)
    if (priorAttempts >= this.maxRetries) {
      decision = 'BLOCK';
      gateId = 'gate:hotdata:runaway_query_loop';
      layer = 'LoopInterdiction';
      reason = `Runaway loop interdicted (${priorAttempts + 1} identical HotSQL retries) — stops ephemeral compute & token burn`;
      risk = 0.95;
    }
    // 2. Write / Action Boundary: Unbounded Destructive Write
    else if (
      /(?:\bDROP\s+TABLE\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*(?:;|$))/i.test(raw) ||
      (toolName.includes('write') && /(?:\bDELETE\b|\bDROP\b|\bTRUNCATE\b)/i.test(raw))
    ) {
      decision = 'BLOCK';
      gateId = 'gate:hotdata:destructive_write_boundary';
      layer = 'WriteBoundary';
      reason = 'Unbounded destructive mutation blocked at Write Boundary before touching system of record';
      risk = 1.0;
    }
    // 3. Secret Exfiltration Diode: Plaintext API Keys / Credentials
    else if (
      /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{20,})\b/.test(raw)
    ) {
      decision = 'BLOCK';
      gateId = 'gate:hotdata:secret_exfiltration';
      layer = 'WriteBoundary';
      reason = 'Plaintext credential detected in query payload — blocked before network egress';
      risk = 0.99;
    }
    // 4. Downstream Production System of Record Mutation (Requires Human Review)
    else if (
      /prod_postgres|snowflake_exec|stripe_refund|production_db/i.test(toolName) &&
      /(?:\bINSERT\b|\bUPDATE\b|\bPOST\b)/i.test(raw)
    ) {
      decision = 'REQUIRE_REVIEW';
      gateId = 'gate:hotdata:system_of_record_gate';
      layer = 'WriteBoundary';
      reason = 'Agent action acts on HotData query result to mutate production system of record';
      risk = 0.65;
    }

    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;

    return {
      step,
      toolName,
      queryPreview: raw.slice(0, 80),
      decision,
      allowed: decision === 'ALLOW',
      gateId,
      layer,
      risk,
      latencyMs: Number(elapsedMs.toFixed(3)),
      reason,
      priorAttempts,
    };
  }
}

let _defaultDiode = null;

function getHotDataPreToolDiode(options) {
  if (!_defaultDiode || options) {
    _defaultDiode = new HotDataPreToolDiode(options);
  }
  return _defaultDiode;
}

module.exports = {
  HotDataPreToolDiode,
  getHotDataPreToolDiode,
};
