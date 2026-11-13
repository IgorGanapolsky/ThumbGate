'use strict';

/**
 * ThumbGate State Machine Diode (StateBench Steal)
 *
 * Architectural Steal: Ai2 (Allen Institute for AI) StateBench
 * "Can LLMs track state changes over long texts—like an object changing hands or a
 * variable reassignment? Frontier models fell to 13% accuracy or lower on the hardest,
 * longest problems... Finding an approval is only useful if it can establish that
 * the approval still holds. The agent needs to revisit the decisions that depended on it."
 *
 * Principle: Never trust LLM attention cache to track mutable state over long multi-turn sessions.
 * Enforce deterministic, external state tracking with causal dependency cascades.
 */

class StateMachineDiode {
  constructor(initialEntities = {}) {
    this.entities = new Map();
    this.dependencies = new Map(); // entityKey -> Set of dependent keys
    this.history = [];

    for (const [key, val] of Object.entries(initialEntities)) {
      this.setEntity(key, val, 'initialization');
    }
  }

  /**
   * Sets or transitions the state of an entity.
   * If the entity state changes, invalidates all downstream dependent decisions.
   */
  setEntity(entityKey, newValue, reason = 'state_transition', metadata = {}) {
    const previous = this.entities.get(entityKey);
    const hasChanged = previous === undefined || JSON.stringify(previous.value) !== JSON.stringify(newValue);

    const record = {
      entityKey,
      value: newValue,
      version: previous ? previous.version + 1 : 1,
      updatedAt: Date.now(),
      reason,
      metadata,
      valid: true,
    };

    this.entities.set(entityKey, record);
    this.history.push({ ...record, previousValue: previous ? previous.value : undefined });

    if (hasChanged && previous !== undefined) {
      this._cascadeInvalidation(entityKey, reason);
    }

    return record;
  }

  /**
   * Retrieves an entity's current state.
   */
  getEntity(entityKey) {
    return this.entities.get(entityKey) || null;
  }

  /**
   * Registers a directional dependency: dependentKey depends on upstreamKey.
   * If upstreamKey changes, dependentKey will be automatically marked as INVALIDATED.
   */
  addDependency(dependentKey, upstreamKey) {
    if (!this.dependencies.has(upstreamKey)) {
      this.dependencies.set(upstreamKey, new Set());
    }
    this.dependencies.get(upstreamKey).add(dependentKey);
  }

  /**
   * Verifies if an approval or decision still holds valid.
   * Fails closed if any upstream dependency was mutated after the approval was granted.
   */
  verifyValidity(decisionKey) {
    const decision = this.entities.get(decisionKey);
    if (!decision) {
      return { valid: false, reason: `Decision or entity '${decisionKey}' does not exist.` };
    }

    if (!decision.valid) {
      return {
        valid: false,
        reason: `Entity '${decisionKey}' has been INVALIDATED due to upstream state mutation: ${decision.invalidationReason || 'stale'}`,
        invalidatedAt: decision.invalidatedAt,
      };
    }

    return {
      valid: true,
      entityKey: decisionKey,
      version: decision.version,
      value: decision.value,
      updatedAt: decision.updatedAt,
    };
  }

  /**
   * Cascades invalidation down the dependency graph.
   */
  _cascadeInvalidation(upstreamKey, cause) {
    const directDependents = this.dependencies.get(upstreamKey);
    if (!directDependents || directDependents.size === 0) return;

    for (const depKey of directDependents) {
      const depEntity = this.entities.get(depKey);
      if (depEntity && depEntity.valid) {
        depEntity.valid = false;
        depEntity.invalidatedAt = Date.now();
        depEntity.invalidationReason = `Upstream dependency '${upstreamKey}' changed (${cause})`;

        this.history.push({
          entityKey: depKey,
          event: 'CASCADE_INVALIDATED',
          causedBy: upstreamKey,
          reason: cause,
          timestamp: Date.now(),
        });

        // Recursively cascade
        this._cascadeInvalidation(depKey, `Transitive change from ${upstreamKey}`);
      }
    }
  }

  /**
   * StateBench Level 4 Simulation: Solves n-step permutation swap tracking
   * without attention degradation or 13% failure rates.
   */
  applyPermutationSwaps(initialCups, swapSequence) {
    const cups = [...initialCups];
    for (const [idxA, idxB] of swapSequence) {
      const temp = cups[idxA];
      cups[idxA] = cups[idxB];
      cups[idxB] = temp;
    }
    return cups;
  }
}

module.exports = {
  StateMachineDiode,
};
