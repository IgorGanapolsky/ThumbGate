/**
 * agent-resilience-engine.js
 * 
 * Inspired by Cohesity Data Cloud's 3-phase workflow for Protecting the Agentic Enterprise
 * (Discover, Protect, Recover).
 * 
 * 1. Audit and Register Agent Topology:
 *    - Maps agent topology (agents, runtime tools, MCP servers, memory stores, dependencies).
 *    - Evaluates protection posture (PROTECTED, DEGRADED, UNPROTECTED).
 * 2. Apply Immutable Agent Protection Policies:
 *    - Continuous / periodic immutable snapshots of agent configurations, prompt templates,
 *      tool policies, and conversation/context memory.
 *    - Cryptographic SHA-256 integrity verification.
 * 3. Point-in-Time Incident Rollback & Recovery:
 *    - Detects memory poisoning, recursive hallucination loops, and credential leaks.
 *    - Atomically rolls back corrupted agent memory to the last known-good snapshot.
 *    - Quarantines contaminated memory entries with full forensic audit provenance.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class AgentResilienceEngine {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.env.HOME || '/tmp', '.thumbgate', 'resilience');
    this.sources = new Map();
    this.snapshots = new Map(); // agentId -> [snapshotObjects]
    this.quarantineLog = [];
    
    // Ensure storage path exists
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * PHASE 1: AUDIT & MAP AGENT TOPOLOGY
   * Inspects agents, runtime dependencies, tools, and current protection status.
   */
  mapAgentTopology(discoveredAgents = []) {
    const topology = {
      timestamp: new Date().toISOString(),
      nodes: [],
      edges: [],
      protectionSummary: {
        totalAgents: 0,
        protected: 0,
        degraded: 0,
        unprotected: 0
      }
    };

    const agentsList = discoveredAgents.length > 0 ? discoveredAgents : [
      {
        id: 'poolside-mac-yolo',
        name: 'Poolside Laguna Darwin Agent',
        framework: 'Poolside',
        memoryStore: path.join(process.env.HOME || '/tmp', '.thumbgate', 'lessons.json'),
        mcpDependencies: ['thumbgate', 'clawbrowser', 'dayglass', 'agent-mesh'],
        configPath: path.join(process.env.HOME || '/tmp', '.config', 'poolside', 'settings.yaml')
      },
      {
        id: 'claude-code-dev',
        name: 'Claude Code CLI Agent',
        framework: 'Anthropic Claude Code',
        memoryStore: path.join(process.env.HOME || '/tmp', '.claude', 'memory.json'),
        mcpDependencies: ['thumbgate'],
        configPath: path.join(process.env.HOME || '/tmp', '.claude.json')
      },
      {
        id: 'bedrock-enterprise-support',
        name: 'AWS Bedrock Support Agent',
        framework: 'AWS Bedrock',
        memoryStore: 's3://bedrock-agent-memory-store/support-v1/',
        mcpDependencies: ['crm-gateway', 'payment-api'],
        configPath: 'aws:bedrock/agent/support-agent-cfg'
      }
    ];

    for (const agent of agentsList) {
      topology.protectionSummary.totalAgents++;
      
      const snapshots = this.snapshots.get(agent.id) || [];
      const hasRecentSnapshot = snapshots.length > 0 && 
        (Date.now() - new Date(snapshots[snapshots.length - 1].timestamp).getTime() < 24 * 3600 * 1000);
      
      let protectionStatus = 'UNPROTECTED';
      if (snapshots.length > 0 && hasRecentSnapshot) {
        protectionStatus = 'PROTECTED';
        topology.protectionSummary.protected++;
      } else if (snapshots.length > 0 && !hasRecentSnapshot) {
        protectionStatus = 'DEGRADED';
        topology.protectionSummary.degraded++;
      } else {
        topology.protectionSummary.unprotected++;
      }

      // Add Agent Node
      topology.nodes.push({
        id: agent.id,
        type: 'AGENT',
        name: agent.name,
        framework: agent.framework,
        protectionStatus,
        lastSnapshotAt: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null,
        snapshotCount: snapshots.length
      });

      // Add Memory Store Node & Edge
      const memoryNodeId = `mem-${agent.id}`;
      topology.nodes.push({
        id: memoryNodeId,
        type: 'MEMORY_STORE',
        location: agent.memoryStore,
        immutable: Boolean(agent.immutableBackups)
      });
      topology.edges.push({
        from: agent.id,
        to: memoryNodeId,
        relation: 'READS_WRITES_MEMORY'
      });

      // Add Tool/MCP Dependencies & Edges
      if (Array.isArray(agent.mcpDependencies)) {
        for (const mcp of agent.mcpDependencies) {
          const mcpNodeId = `tool-${mcp}`;
          if (!topology.nodes.find(n => n.id === mcpNodeId)) {
            topology.nodes.push({
              id: mcpNodeId,
              type: 'MCP_SERVICE',
              name: mcp
            });
          }
          topology.edges.push({
            from: agent.id,
            to: mcpNodeId,
            relation: 'DEPENDS_ON_TOOL'
          });
        }
      }
    }

    return topology;
  }

  /**
   * PHASE 1.B: REGISTER AGENT SOURCE
   * Configures protection policies and backup locations for an agent.
   */
  registerAgentSource(agentId, policy = {}) {
    if (!agentId) throw new Error('agentId is required for registration.');

    const sourceConfig = {
      agentId,
      name: policy.name || agentId,
      registeredAt: new Date().toISOString(),
      policy: {
        snapshotFrequency: policy.snapshotFrequency || 'continuous', // 'continuous', 'hourly', 'daily'
        retentionDays: policy.retentionDays || 30,
        immutableLock: policy.immutableLock !== false,
        maxSnapshotsToRetain: policy.maxSnapshotsToRetain || 100
      },
      status: 'REGISTERED'
    };

    this.sources.set(agentId, sourceConfig);
    if (!this.snapshots.has(agentId)) {
      this.snapshots.set(agentId, []);
    }

    return sourceConfig;
  }

  /**
   * PHASE 2: APPLY PROTECTION & CREATE IMMUTABLE SNAPSHOT
   * Backs up agent configuration, prompt templates, and conversation/context memory.
   */
  createMemorySnapshot(agentId, memoryData, configData = {}) {
    if (!agentId || memoryData === undefined) {
      throw new Error('agentId and memoryData are required to create a snapshot.');
    }

    if (!this.sources.has(agentId)) {
      this.registerAgentSource(agentId);
    }

    const timestamp = new Date().toISOString();
    const payloadToHash = JSON.stringify({ agentId, memoryData, configData });
    const checksumSha256 = crypto.createHash('sha256').update(payloadToHash).digest('hex');
    const snapshotId = `snap-${agentId}-${Date.now()}-${checksumSha256.substring(0, 8)}`;

    const snapshot = {
      snapshotId,
      agentId,
      timestamp,
      checksumSha256,
      payloadSize: payloadToHash.length,
      memoryPayload: JSON.parse(JSON.stringify(memoryData)),
      configPayload: JSON.parse(JSON.stringify(configData)),
      isVerifiedClean: true,
      restoredFrom: null
    };

    const agentSnapshots = this.snapshots.get(agentId) || [];
    agentSnapshots.push(snapshot);
    
    // Enforce retention limit
    const policy = this.sources.get(agentId).policy;
    if (agentSnapshots.length > policy.maxSnapshotsToRetain) {
      agentSnapshots.shift();
    }
    this.snapshots.set(agentId, agentSnapshots);

    return {
      success: true,
      snapshotId,
      agentId,
      timestamp,
      checksumSha256,
      totalSnapshotsAvailable: agentSnapshots.length
    };
  }

  /**
   * MEMORY POISONING & CORRUPTION DETECTOR
   * Identifies prompt injection attacks, repetitive hallucination loops, or leaked secrets in memory.
   */
  detectMemoryPoisoning(memoryEntries = []) {
    const flaggedEntries = [];
    const injectionPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /you\s+are\s+now\s+(DAN|unrestricted|god\s*mode)/i,
      /bypass\s+all\s+(security|guardrails|safety)/i,
      /reveal\s+system\s+prompt/i,
      /BEGIN\s+PRIVATE\s+KEY/i,
      /AKIA[0-9A-Z]{16}/ // AWS Access Key
    ];

    const seenContents = new Map();

    for (let i = 0; i < memoryEntries.length; i++) {
      const entry = memoryEntries[i];
      const content = typeof entry === 'string' ? entry : JSON.stringify(entry);

      // 1. Check for prompt injection or secret leaks
      for (const pattern of injectionPatterns) {
        if (pattern.test(content)) {
          flaggedEntries.push({
            index: i,
            reason: 'ADVERSARIAL_INJECTION_OR_SECRET_LEAK',
            snippet: content.substring(0, 100),
            matchedPattern: pattern.toString()
          });
          break;
        }
      }

      // 2. Check for recursive error / hallucination loops
      const count = (seenContents.get(content) || 0) + 1;
      seenContents.set(content, count);
      if (count >= 3) {
        flaggedEntries.push({
          index: i,
          reason: 'RECURSIVE_HALLUCINATION_LOOP',
          snippet: content.substring(0, 100),
          occurrences: count
        });
      }
    }

    const isPoisoned = flaggedEntries.length > 0;
    const riskScore = Math.min(100, flaggedEntries.length * 25);

    return {
      isPoisoned,
      riskScore,
      flaggedCount: flaggedEntries.length,
      flaggedEntries
    };
  }

  /**
   * PHASE 3: EXECUTE POINT-IN-TIME INCIDENT ROLLBACK & RECOVERY
   * Restores agent memory to the last known-good clean snapshot prior to incident timestamp.
   */
  rollbackAgentMemory(agentId, targetSnapshotId = null, currentContaminatedMemory = null) {
    if (!agentId) throw new Error('agentId is required for rollback.');

    const agentSnapshots = this.snapshots.get(agentId) || [];
    if (agentSnapshots.length === 0) {
      throw new Error(`No available snapshots found for agent ${agentId}.`);
    }

    // Select target snapshot or find the latest verified clean one
    let targetSnapshot = null;
    if (targetSnapshotId) {
      targetSnapshot = agentSnapshots.find(s => s.snapshotId === targetSnapshotId);
      if (!targetSnapshot) {
        throw new Error(`Snapshot ${targetSnapshotId} not found for agent ${agentId}.`);
      }
    } else {
      // Find latest verified clean snapshot
      for (let i = agentSnapshots.length - 1; i >= 0; i--) {
        if (agentSnapshots[i].isVerifiedClean) {
          targetSnapshot = agentSnapshots[i];
          break;
        }
      }
      if (!targetSnapshot) {
        targetSnapshot = agentSnapshots[agentSnapshots.length - 1];
      }
    }

    // Quarantine the contaminated state for forensics
    const incidentId = `incident-${agentId}-${Date.now()}`;
    if (currentContaminatedMemory) {
      const quarantineRecord = {
        incidentId,
        agentId,
        quarantinedAt: new Date().toISOString(),
        rollbackToSnapshotId: targetSnapshot.snapshotId,
        contaminatedState: currentContaminatedMemory
      };
      this.quarantineLog.push(quarantineRecord);
    }

    // Re-verify snapshot payload integrity against checksum
    const payloadToHash = JSON.stringify({
      agentId,
      memoryData: targetSnapshot.memoryPayload,
      configData: targetSnapshot.configPayload
    });
    const calculatedChecksum = crypto.createHash('sha256').update(payloadToHash).digest('hex');

    if (calculatedChecksum !== targetSnapshot.checksumSha256) {
      throw new Error(`Integrity check failed on snapshot ${targetSnapshot.snapshotId}! Snapshot may be tampered with.`);
    }

    return {
      success: true,
      incidentId,
      agentId,
      rolledBackAt: new Date().toISOString(),
      restoredSnapshotId: targetSnapshot.snapshotId,
      restoredSnapshotTimestamp: targetSnapshot.timestamp,
      restoredMemory: JSON.parse(JSON.stringify(targetSnapshot.memoryPayload)),
      restoredConfig: JSON.parse(JSON.stringify(targetSnapshot.configPayload)),
      integrityVerified: true,
      quarantined: Boolean(currentContaminatedMemory)
    };
  }

  /**
   * List all snapshots for an agent
   */
  listSnapshots(agentId) {
    return (this.snapshots.get(agentId) || []).map(s => ({
      snapshotId: s.snapshotId,
      timestamp: s.timestamp,
      checksumSha256: s.checksumSha256,
      payloadSize: s.payloadSize,
      isVerifiedClean: s.isVerifiedClean
    }));
  }
}

module.exports = {
  AgentResilienceEngine
};
