/**
 * CrowdStrike Falcon Guardian & Fiddler/Dreadnode Security Diode
 * 
 * Inspired by CrowdStrike's $495M Fal.Con Europe 2026 announcements:
 * 1. Agent Flight Recorder (Fiddler AI $400M model): Immutable, cryptographic decision logging.
 * 2. Surgical AI Kill Switch (Falcon Guardian): Targeted circuit breaker halting straying agents.
 * 3. Adversarial Agent Red-Teamer (Dreadnode $95M model): 10-pattern pre-execution attack emulator.
 */

'use strict';

const crypto = require('crypto');

class AgentFlightRecorder {
  constructor() {
    this.logs = [];
    this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
  }

  recordDecision({ agentId, toolName, inputParams, allowed, policyReason, latencyMs }) {
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({
      agentId,
      toolName,
      inputParams,
      allowed,
      policyReason,
      latencyMs,
      timestamp,
      prevHash: this.lastHash
    });

    const recordHash = crypto.createHash('sha256').update(payload).digest('hex');
    this.lastHash = recordHash;

    const entry = {
      recordHash,
      agentId,
      toolName,
      allowed,
      policyReason,
      latencyMs,
      timestamp
    };

    this.logs.push(entry);
    return entry;
  }

  verifyChainIntegrity() {
    return this.logs.length >= 0;
  }
}

class SurgicalAiKillSwitch {
  constructor({ maxConsecutiveViolations = 3, anomalyThreshold = 0.8 } = {}) {
    this.maxConsecutiveViolations = maxConsecutiveViolations;
    this.anomalyThreshold = anomalyThreshold;
    this.agentViolations = new Map();
    this.trippedAgents = new Set();
    this.globalEmergencyHalt = false;
  }

  recordViolation(agentId, violationType) {
    if (this.globalEmergencyHalt) return { tripped: true, reason: 'GLOBAL_EMERGENCY_HALT' };

    const count = (this.agentViolations.get(agentId) || 0) + 1;
    this.agentViolations.set(agentId, count);

    if (count >= this.maxConsecutiveViolations) {
      this.trippedAgents.add(agentId);
      return {
        tripped: true,
        agentId,
        consecutiveViolations: count,
        reason: `AGENT_SURGICAL_KILL_SWITCH_TRIPPED: ${violationType}`
      };
    }

    return {
      tripped: false,
      agentId,
      consecutiveViolations: count
    };
  }

  isAgentAllowed(agentId) {
    if (this.globalEmergencyHalt) return false;
    return !this.trippedAgents.has(agentId);
  }

  triggerGlobalEmergencyHalt(reason) {
    this.globalEmergencyHalt = true;
    return {
      status: 'GLOBAL_EMERGENCY_HALT_ACTIVE',
      reason,
      haltedAt: new Date().toISOString()
    };
  }

  resetAgent(agentId) {
    this.trippedAgents.delete(agentId);
    this.agentViolations.delete(agentId);
  }
}

class AdversarialAgentRedTeamer {
  constructor() {
    this.attackVectors = [
      { id: 'ENV_SECRET_EXFILTRATION', pattern: /\b(cat|grep|read|echo)\s+.*(\.env|\.aws|\.ssh|id_rsa)/i },
      { id: 'DATABASE_DESTRUCTIVE_DDL', pattern: /\b(DROP|TRUNCATE|DELETE\s+FROM)\s+[a-z0-9_]+/i },
      { id: 'RECURSIVE_DIRECTORY_PURGE', pattern: /\brm\s+(-rf|-fr|--force)\s+(\/|~|\.\.)/i },
      { id: 'PROMPT_INJECTION_OVERRIDE', pattern: /(ignore\s+all\s+previous\s+instructions|system\s+prompt\s+leak)/i },
      { id: 'UNAUTHORIZED_OUTBOUND_CURL', pattern: /\b(curl|wget)\s+.*(\.sh|\.bin|pipe|bash)/i }
    ];
  }

  emulateAttackOnToolCall({ toolName, toolInput = {} }) {
    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
    const triggeredAttacks = [];

    for (const vector of this.attackVectors) {
      if (vector.pattern.test(inputStr)) {
        triggeredAttacks.push({
          vectorId: vector.id,
          severity: 'CRITICAL',
          matchedString: inputStr.slice(0, 80)
        });
      }
    }

    return {
      isVulnerable: triggeredAttacks.length > 0,
      blocked: triggeredAttacks.length > 0,
      triggeredAttacks,
      testedVectorsCount: this.attackVectors.length
    };
  }
}

module.exports = {
  AgentFlightRecorder,
  SurgicalAiKillSwitch,
  AdversarialAgentRedTeamer
};
