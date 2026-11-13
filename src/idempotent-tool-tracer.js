/**
 * Idempotent Tool Span Tracer & Hidden Retry Paradox Detector
 * 
 * Inspired by Brij Kishore Pandey's Google Cloud Advent of Agents analysis:
 * "Your agent gave the right answer. Why did it call the same tool twice?
 * A successful response can hide a failed tool call, a retry, and extra latency."
 * 
 * Features:
 * 1. Computes deterministic idempotencyKey for every tool execution.
 * 2. Distinguishes necessary recovery retries from redundant tool-loop thrashing.
 * 3. Tracks token waste and latency inflation from repeated calls.
 */

'use strict';

const crypto = require('crypto');

class IdempotentToolTracer {
  constructor() {
    this.spans = [];
    this.keyCounts = new Map();
  }

  /**
   * Generates a deterministic idempotency key for a tool call.
   */
  computeIdempotencyKey(agentId, toolName, args = {}) {
    const canonicalArgs = JSON.stringify(args, Object.keys(args).sort());
    return crypto
      .createHash('sha256')
      .update(`${agentId}:${toolName}:${canonicalArgs}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Records a tool call span and evaluates whether it represents a hidden duplicate or retry loop.
   */
  recordSpan({
    agentId,
    toolName,
    args = {},
    latencyMs = 0,
    inputTokens = 0,
    outputTokens = 0,
    status = 'success', // 'success' | 'failed' | 'timeout'
    isRecovery = false
  }) {
    const idempotencyKey = this.computeIdempotencyKey(agentId, toolName, args);
    const existingCount = this.keyCounts.get(idempotencyKey) || 0;
    const newCount = existingCount + 1;
    this.keyCounts.set(idempotencyKey, newCount);

    const isDuplicate = newCount > 1;
    let anomalyType = null;

    if (isDuplicate) {
      if (isRecovery) {
        anomalyType = 'RECOVERY_RETRY';
      } else {
        // Redundant loop: exact same arguments called again without a recovery context
        anomalyType = 'REDUNDANT_TOOL_LOOP_WASTE';
      }
    }

    const span = {
      spanId: `span_${crypto.randomBytes(6).toString('hex')}`,
      agentId,
      toolName,
      idempotencyKey,
      callSequenceNumber: newCount,
      isDuplicate,
      anomalyType,
      latencyMs,
      tokensUsed: inputTokens + outputTokens,
      status,
      timestamp: new Date().toISOString()
    };

    this.spans.push(span);
    return span;
  }

  /**
   * Analyzes the session trace for hidden tool execution overhead.
   */
  analyzeSessionTrace() {
    let totalLatencyMs = 0;
    let totalTokens = 0;
    let redundantLatencyWasteMs = 0;
    let redundantTokenWaste = 0;
    let duplicateCallsCount = 0;

    for (const span of this.spans) {
      totalLatencyMs += span.latencyMs;
      totalTokens += span.tokensUsed;

      if (span.isDuplicate && span.anomalyType === 'REDUNDANT_TOOL_LOOP_WASTE') {
        duplicateCallsCount++;
        redundantLatencyWasteMs += span.latencyMs;
        redundantTokenWaste += span.tokensUsed;
      }
    }

    const latencyInflationPct = totalLatencyMs > 0
      ? Math.round((redundantLatencyWasteMs / totalLatencyMs) * 100)
      : 0;

    return {
      totalSpansRecorded: this.spans.length,
      duplicateCallsCount,
      totalLatencyMs,
      redundantLatencyWasteMs,
      latencyInflationPct,
      totalTokens,
      redundantTokenWaste,
      hasProductivityParadox: duplicateCallsCount >= 2 || latencyInflationPct >= 20
    };
  }
}

module.exports = {
  IdempotentToolTracer
};
