'use strict';

/**
 * ThumbGate Agent Hop-Latency Budget & Fast-Path Engine
 *
 * Grounded in 2026 Enterprise Latency Benchmarks (The New Stack / Akamai / LangChain):
 * - 82% of enterprises require <=500ms response times; 64% require <=250ms.
 * - CPU/WAN multi-hop processing accounts for up to 90.6% of agent chain latency.
 * - Tracks per-hop execution budgets, isolates CPU-side bottlenecks, and enforces fast-path local execution.
 */

const PROFILES = {
  INTERACTIVE_VOICE: {
    name: 'interactive_voice',
    slaMs: 250,
    budgets: {
      reasoning_inference: 100,
      governance_gate: 15,
      tool_dispatch_transport: 75,
      cpu_data_processing: 35,
      memory_recall: 25,
    },
  },
  STANDARD_AGENT: {
    name: 'standard_agent',
    slaMs: 500,
    budgets: {
      reasoning_inference: 200,
      governance_gate: 25,
      tool_dispatch_transport: 150,
      cpu_data_processing: 75,
      memory_recall: 50,
    },
  },
  BATCH_WORKFLOW: {
    name: 'batch_workflow',
    slaMs: 5000,
    budgets: {
      reasoning_inference: 2500,
      governance_gate: 200,
      tool_dispatch_transport: 1300,
      cpu_data_processing: 600,
      memory_recall: 400,
    },
  },
};

class LatencyTracker {
  /**
   * @param {'standard_agent'|'interactive_voice'|'batch_workflow'|Object} [profile='standard_agent']
   */
  constructor(profile = 'standard_agent') {
    if (typeof profile === 'string') {
      this.profile = PROFILES[profile.toUpperCase()] || PROFILES.STANDARD_AGENT;
    } else if (typeof profile === 'object' && profile.slaMs) {
      this.profile = profile;
    } else {
      this.profile = PROFILES.STANDARD_AGENT;
    }

    this.hops = [];
    this.activeHops = new Map();
    this.sessionStartTime = Date.now();
  }

  /**
   * Starts timing a specific hop.
   * @param {string} phase e.g. 'reasoning_inference', 'governance_gate', 'tool_dispatch_transport'
   * @param {string} [label] descriptive label
   * @returns {string} hopId
   */
  startHop(phase, label = '') {
    const hopId = `hop_${this.hops.length + 1}_${Date.now()}`;
    const startMs = Date.now();
    this.activeHops.set(hopId, {
      hopId,
      phase,
      label: label || phase,
      startMs,
      endMs: null,
      durationMs: null,
    });
    return hopId;
  }

  /**
   * Ends timing a specific hop.
   * @param {string} hopId
   * @param {Object} [metadata]
   * @returns {Object} recorded hop
   */
  endHop(hopId, metadata = {}) {
    const active = this.activeHops.get(hopId);
    if (!active) {
      throw new Error(`Unknown active hop ID: ${hopId}`);
    }

    const endMs = Date.now();
    const durationMs = Math.max(0, endMs - active.startMs);
    const completed = {
      ...active,
      endMs,
      durationMs,
      metadata,
    };

    this.activeHops.delete(hopId);
    this.hops.push(completed);
    return completed;
  }

  /**
   * Directly records a completed hop duration.
   * @param {string} phase
   * @param {number} durationMs
   * @param {string} [label]
   * @param {Object} [metadata]
   */
  recordHop(phase, durationMs, label = '', metadata = {}) {
    const now = Date.now();
    const hop = {
      hopId: `hop_${this.hops.length + 1}_${now}`,
      phase,
      label: label || phase,
      startMs: now - durationMs,
      endMs: now,
      durationMs: Math.max(0, durationMs),
      metadata,
    };
    this.hops.push(hop);
    return hop;
  }

  /**
   * Analyzes all recorded hops against performance SLA and budget limits.
   * @returns {Object} analysis summary
   */
  analyze() {
    let totalDurationMs = 0;
    let cpuDurationMs = 0;
    let gpuDurationMs = 0;
    const phaseTotals = {};
    const breachedPhases = [];

    for (const hop of this.hops) {
      const dur = hop.durationMs;
      totalDurationMs += dur;
      phaseTotals[hop.phase] = (phaseTotals[hop.phase] || 0) + dur;

      if (hop.phase === 'reasoning_inference') {
        gpuDurationMs += dur;
      } else {
        cpuDurationMs += dur;
      }
    }

    const budgets = this.profile.budgets || {};
    for (const [phase, budgetMs] of Object.entries(budgets)) {
      const actual = phaseTotals[phase] || 0;
      if (actual > budgetMs) {
        breachedPhases.push({
          phase,
          budgetMs,
          actualMs: actual,
          excessMs: actual - budgetMs,
        });
      }
    }

    const cpuRatio = totalDurationMs > 0 ? Number((cpuDurationMs / totalDurationMs).toFixed(3)) : 0;
    const meetsSla = totalDurationMs <= this.profile.slaMs;
    const cpuBottleneck = cpuRatio >= 0.7; // >70% latency spent outside model reasoning

    return {
      profile: this.profile.name,
      slaMs: this.profile.slaMs,
      totalDurationMs,
      meetsSla,
      cpuDurationMs,
      gpuDurationMs,
      cpuRatio,
      cpuBottleneck,
      hopCount: this.hops.length,
      phaseTotals,
      breachedPhases,
      recommendations: this._generateRecommendations(meetsSla, cpuBottleneck, breachedPhases),
    };
  }

  /**
   * Generates actionable remediation recommendations.
   * @private
   */
  _generateRecommendations(meetsSla, cpuBottleneck, breachedPhases) {
    const recs = [];
    if (!meetsSla) {
      recs.push(`Target SLA missed by ${this.analyzeTotalExcess()}ms. Activate local fast-path edge caching.`);
    }
    if (cpuBottleneck) {
      recs.push('High CPU/transport ratio (>70%). Co-locate MCP tools with local ThumbGate gateway to eliminate WAN roundtrips.');
    }
    for (const breach of breachedPhases) {
      if (breach.phase === 'governance_gate') {
        recs.push(`Governance phase exceeded budget (${breach.actualMs}ms vs ${breach.budgetMs}ms). Switch to asynchronous scrubbed audit trail.`);
      } else if (breach.phase === 'tool_dispatch_transport') {
        recs.push(`Tool transport exceeded budget (${breach.actualMs}ms vs ${breach.budgetMs}ms). Batch parallel tool executions.`);
      }
    }
    return recs;
  }

  /**
   * Calculates total excess ms over SLA.
   * @private
   */
  analyzeTotalExcess() {
    const total = this.hops.reduce((acc, h) => acc + h.durationMs, 0);
    return Math.max(0, total - this.profile.slaMs);
  }

  /**
   * Exports OpenTelemetry-compliant trace span attributes.
   * @returns {Object}
   */
  exportOtelAttributes() {
    const report = this.analyze();
    return {
      'agent.latency.profile': report.profile,
      'agent.latency.sla_ms': report.slaMs,
      'agent.latency.total_ms': report.totalDurationMs,
      'agent.latency.cpu_ms': report.cpuDurationMs,
      'agent.latency.gpu_ms': report.gpuDurationMs,
      'agent.latency.cpu_ratio': report.cpuRatio,
      'agent.latency.cpu_bottleneck': report.cpuBottleneck,
      'agent.latency.meets_sla': report.meetsSla,
      'agent.latency.hop_count': report.hopCount,
    };
  }
}

module.exports = {
  PROFILES,
  LatencyTracker,
};
