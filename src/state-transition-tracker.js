/**
 * Deterministic State Transition Tracker & Cascading Invalidator.
 * 
 * Inspired by Ai2 (Allen Institute for AI) StateBench Research:
 * "Frontier transformer LLMs plummet to 13% accuracy when tracking state changes
 * and variable reassignments over long contexts. Never rely on LLM context attention
 * to mental-replay state mutations. Maintain an explicit external state transition ledger
 * and inject the materialized current state directly into the agent context."
 */

'use strict';

class StateTransitionTracker {
  constructor(options = {}) {
    // In-memory transition log (can be backed by SQLite or JSONL)
    this.transitions = [];
    // Materialized current state: entityId -> { [property]: { value, version, updatedAt, mutatedBy } }
    this.materialized = new Map();
    // Dependency graph: key (entityId:property) -> Set of dependent keys or taskIds
    this.dependencyGraph = new Map();
    // Stale/invalidated markers: Set of taskIds or decisionIds needing revalidation
    this.staleDecisions = new Set();
  }

  registerDependency(dependentId, entityId, property) {
    const stateKey = `${entityId}:${property}`;
    if (!this.dependencyGraph.has(stateKey)) {
      this.dependencyGraph.set(stateKey, new Set());
    }
    this.dependencyGraph.get(stateKey).add(dependentId);
  }

  recordTransition(transition) {
    const {
      entityId,
      property,
      newValue,
      mutatedBy = 'system',
      metadata = {},
    } = transition;

    if (!entityId || !property) {
      throw new Error('entityId and property are required to record a state transition');
    }

    const stateKey = `${entityId}:${property}`;
    const entityState = this.materialized.get(entityId) || {};
    const oldEntry = entityState[property];
    const oldValue = oldEntry !== undefined ? oldEntry.value : transition.oldValue;
    const currentVersion = oldEntry !== undefined ? oldEntry.version : 0;
    const newVersion = currentVersion + 1;

    const transitionRecord = {
      transitionId: `trans_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      entityId,
      property,
      oldValue,
      newValue,
      version: newVersion,
      mutatedBy,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.transitions.push(transitionRecord);

    // Update materialized state
    entityState[property] = {
      value: newValue,
      version: newVersion,
      updatedAt: transitionRecord.timestamp,
      mutatedBy,
    };
    this.materialized.set(entityId, entityState);

    // Cascading Invalidation of Downstream Dependencies
    const invalidated = [];
    const dependents = this.dependencyGraph.get(stateKey);
    if (dependents && dependents.size > 0) {
      for (const depId of dependents) {
        this.staleDecisions.add(depId);
        invalidated.push(depId);
      }
    }

    return {
      transition: transitionRecord,
      invalidatedDependents: invalidated,
    };
  }

  getMaterializedState(entityId) {
    const state = this.materialized.get(entityId);
    if (!state) return null;
    const clean = {};
    for (const [k, v] of Object.entries(state)) {
      clean[k] = v.value;
    }
    return clean;
  }

  getMaterializedStateWithMetadata(entityId) {
    return this.materialized.get(entityId) || null;
  }

  isDecisionStale(decisionId) {
    return this.staleDecisions.has(decisionId);
  }

  resolveStaleDecision(decisionId) {
    this.staleDecisions.delete(decisionId);
  }

  buildAgentContextPrompt(entityIds = []) {
    let prompt = '=== MATERIALIZED SYSTEM STATE (Verified External Truth) ===\n';
    for (const eid of entityIds) {
      const state = this.getMaterializedState(eid);
      if (state) {
        prompt += `Entity [${eid}]: ${JSON.stringify(state, null, 2)}\n`;
      }
    }
    prompt += 'NOTE: Use this materialized state directly; do not attempt to mental-replay historical mutations from prior conversation turns.\n';
    return prompt;
  }
}

module.exports = {
  StateTransitionTracker,
};
