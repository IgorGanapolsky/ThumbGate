'use strict';

/**
 * Datadog-Style Agent & LLM Observability Engine.
 *
 * Stolen from Datadog's "Best Practices for Monitoring, Optimizing, and Securing LLM Applications":
 * 1. Span-Level End-to-End Tracing: Detailed latency breakdown and token attribution per step.
 * 2. Sensitive Data Scanner: Pre-execution PII, secret, and auth token redaction.
 * 3. Functional Quality & Deviation Checks: No-op detection, topic relevancy, safety guard compliance.
 * 4. Cost & Token Burn Rate Tripwires: Real-time budget monitoring and circuit breaking.
 */

const crypto = require('node:crypto');

const SENSITIVE_PATTERNS = [
  /(?:Bearer\s+)[A-Za-z0-9_\-\.]{20,}/gi,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/g,
  /(?:sk-[A-Za-z0-9]{32,})/g,
  /(?:AIza[0-9A-Za-z-_]{35})/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // Email
  /(?:xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)/g, // Slack
];

class AgentTraceSpan {
  constructor(name, parentSpanId = null, traceId = null) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.parentSpanId = parentSpanId;
    this.traceId = traceId || crypto.randomUUID();
    this.startTime = Date.now();
    this.endTime = null;
    this.durationMs = null;
    this.status = 'IN_PROGRESS';
    this.error = null;
    this.tags = {};
    this.metrics = {
      tokensIn: 0,
      tokensOut: 0,
      costEstimateUsd: 0,
    };
    this.events = [];
  }

  setTag(key, value) {
    this.tags[key] = value;
    return this;
  }

  addEvent(name, attributes = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  recordUsage({ tokensIn = 0, tokensOut = 0, costUsd = 0 } = {}) {
    this.metrics.tokensIn += tokensIn;
    this.metrics.tokensOut += tokensOut;
    this.metrics.costEstimateUsd += costUsd;
    return this;
  }

  finish(status = 'SUCCESS', error = null) {
    this.endTime = Date.now();
    this.durationMs = this.endTime - this.startTime;
    this.status = error ? 'ERROR' : status;
    this.error = error ? (error.message || String(error)) : null;
    return this;
  }

  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.id,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      durationMs: this.durationMs,
      status: this.status,
      error: this.error,
      tags: this.tags,
      metrics: this.metrics,
      events: this.events,
    };
  }
}

class DatadogAgentObservability {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'thumbgate-fleet-orchestrator';
    this.budgetLimitUsd = options.budgetLimitUsd || 10.0;
    this.spans = [];
    this.activeTraces = new Map();
    this.stats = {
      totalTraces: 0,
      totalSpans: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostUsd: 0,
      piiRedactionCount: 0,
      budgetBreaches: 0,
    };
  }

  /**
   * Sensitive Data Scanner (Scrubbing PII, tokens, and secrets).
   */
  scrubSensitiveData(text) {
    if (typeof text !== 'string') return text;
    let scrubbed = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, (match) => {
        this.stats.piiRedactionCount++;
        return `[REDACTED_${match.slice(0, 4)}...]`;
      });
    }
    return scrubbed;
  }

  startTrace(traceName) {
    const traceId = crypto.randomUUID();
    const rootSpan = new AgentTraceSpan(traceName, null, traceId);
    rootSpan.setTag('service', this.serviceName);
    this.activeTraces.set(traceId, { rootSpan, spans: [rootSpan] });
    this.stats.totalTraces++;
    this.stats.totalSpans++;
    return rootSpan;
  }

  startChildSpan(parentSpan, spanName) {
    const span = new AgentTraceSpan(spanName, parentSpan.id, parentSpan.traceId);
    span.setTag('service', this.serviceName);
    const trace = this.activeTraces.get(parentSpan.traceId);
    if (trace) {
      trace.spans.push(span);
    }
    this.stats.totalSpans++;
    return span;
  }

  recordUsage(span, usage = {}) {
    span.recordUsage(usage);
    this.stats.totalTokensIn += usage.tokensIn || 0;
    this.stats.totalTokensOut += usage.tokensOut || 0;
    this.stats.totalCostUsd += usage.costUsd || 0;

    if (this.stats.totalCostUsd >= this.budgetLimitUsd) {
      this.stats.budgetBreaches++;
      throw new Error(
        `[Datadog LLM Observability Tripwire] Cost ceiling breached: $${this.stats.totalCostUsd.toFixed(4)} >= $${this.budgetLimitUsd.toFixed(2)}`
      );
    }
  }

  /**
   * Functional Quality & Policy Evaluator.
   */
  evaluateQuality({ traceId, actionCount = 0, noOpDetected = false, violations = [] } = {}) {
    const evaluations = {
      timestamp: new Date().toISOString(),
      traceId,
      verdict: 'PASS',
      checks: {
        noOpInterdiction: noOpDetected ? 'FAIL' : 'PASS',
        actionEfficiency: actionCount > 0 ? 'PASS' : 'WARN',
        safetyPolicyCompliance: violations.length === 0 ? 'PASS' : 'FAIL',
      },
      violations,
    };

    if (noOpDetected || violations.length > 0) {
      evaluations.verdict = 'FAIL';
    }

    return evaluations;
  }

  exportTraceSummary(traceId) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;

    return {
      traceId,
      rootSpan: trace.rootSpan.toJSON(),
      totalSpans: trace.spans.length,
      durationMs: trace.rootSpan.durationMs,
      status: trace.rootSpan.status,
      metrics: {
        totalTokens: trace.spans.reduce((acc, s) => acc + s.metrics.tokensIn + s.metrics.tokensOut, 0),
        totalCostUsd: trace.spans.reduce((acc, s) => acc + s.metrics.costEstimateUsd, 0),
      },
      spans: trace.spans.map((s) => s.toJSON()),
    };
  }
}

module.exports = {
  AgentTraceSpan,
  DatadogAgentObservability,
  SENSITIVE_PATTERNS,
};
