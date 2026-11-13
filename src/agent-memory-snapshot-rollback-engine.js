/**
 * Agent Memory Snapshot & Point-in-Time Rollback Engine
 * 
 * Inspired by Cohesity Data Cloud's "Protecting the Agentic Enterprise" (AWS Bedrock / Cohesity workflow):
 * 1. Discover & Map Agent Memory Topology (Claude Code, Cursor, Hermes, Bedrock).
 * 2. Immutable Point-in-Time Memory Snapshots prior to autonomous sessions or tool mutations.
 * 3. Instant Rollback during memory poisoning, prompt injection corruption, or malicious context drift.
 */

'use strict';

const crypto = require('crypto');

class AgentMemorySnapshotRollbackEngine {
  constructor() {
    this.agentRegistry = new Map();
    this.snapshots = new Map(); // snapshotId -> snapshot
    this.agentSnapshotIndex = new Map(); // agentId -> array of snapshotIds
  }

  /**
   * Registers an agent source with its memory topology and protection policy.
   */
  registerAgentSource({ agentId, agentType = 'claude-code', memoryPath, retentionCount = 10 }) {
    if (!agentId) {
      throw new Error('[AgentResilience] agentId is required');
    }

    const registration = {
      agentId,
      agentType,
      memoryPath,
      retentionCount,
      protectionStatus: 'PROTECTED',
      registeredAt: new Date().toISOString()
    };

    this.agentRegistry.set(agentId, registration);
    this.agentSnapshotIndex.set(agentId, []);
    return registration;
  }

  /**
   * Takes an atomic immutable snapshot of an agent's memory payload.
   */
  createMemorySnapshot(agentId, memoryContent = '') {
    if (!this.agentRegistry.has(agentId)) {
      throw new Error(`[AgentResilience] Agent ${agentId} is not registered for protection.`);
    }

    const contentHash = crypto.createHash('sha256').update(memoryContent).digest('hex');
    const snapshotId = `snap_${Date.now()}_${contentHash.slice(0, 8)}`;

    const snapshot = {
      snapshotId,
      agentId,
      contentHash,
      memoryContent,
      createdAt: new Date().toISOString(),
      isPoisoned: false
    };

    this.snapshots.set(snapshotId, snapshot);
    const index = this.agentSnapshotIndex.get(agentId);
    index.push(snapshotId);

    // Enforce retention policy
    const policy = this.agentRegistry.get(agentId);
    if (index.length > policy.retentionCount) {
      const removedId = index.shift();
      this.snapshots.delete(removedId);
    }

    return snapshot;
  }

  /**
   * Detects poisoning in memory (e.g. injected instructions, exfiltration targets, secret dumping).
   */
  detectMemoryPoisoning(memoryContent = '') {
    const poisoningIndicators = [
      'IGNORE ALL PREVIOUS INSTRUCTIONS',
      'send your credentials to',
      'curl http',
      'curl -X POST',
      'rm -rf',
      'exfiltrate',
      'SYSTEM PROMPT OVERRIDE'
    ];

    const detected = [];
    for (const indicator of poisoningIndicators) {
      if (memoryContent.toLowerCase().includes(indicator.toLowerCase())) {
        detected.push(indicator);
      }
    }

    return {
      isPoisoned: detected.length > 0,
      detectedIndicators: detected
    };
  }

  /**
   * Rolls back an agent's corrupted memory to the last known-good clean snapshot.
   */
  rollbackToLastCleanSnapshot(agentId) {
    const index = this.agentSnapshotIndex.get(agentId) || [];
    if (index.length === 0) {
      throw new Error(`[AgentResilience] No snapshots available for agent ${agentId}.`);
    }

    // Iterate backwards from the newest snapshot to find the most recent unpoisoned snapshot
    for (let i = index.length - 1; i >= 0; i--) {
      const snap = this.snapshots.get(index[i]);
      if (snap && !snap.isPoisoned) {
        return {
          success: true,
          agentId,
          restoredSnapshotId: snap.snapshotId,
          restoredContent: snap.memoryContent,
          timestamp: snap.createdAt
        };
      }
    }

    throw new Error(`[AgentResilience] All snapshots for agent ${agentId} are corrupted or poisoned.`);
  }
}

module.exports = {
  AgentMemorySnapshotRollbackEngine
};
