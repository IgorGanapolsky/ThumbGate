'use strict';

/**
 * Agent Identity & Least-Privilege Role Boundary Enforcer.
 *
 * Implements fine-grained agent identity token verification and capability scoping
 * to prevent privilege escalation across sub-agents in autonomous multi-agent fleets.
 */

const ROLE_CAPABILITY_MATRIX = Object.freeze({
  researcher: ['fs:read', 'web:search', 'mcp:read', 'telemetry:read'],
  developer: ['fs:read', 'fs:write', 'git:commit', 'git:push_branch', 'tests:run'],
  qa_auditor: ['fs:read', 'tests:run', 'e2e:execute', 'telemetry:read'],
  release_engineer: ['fs:read', 'fs:write', 'git:*', 'ci:deploy', 'npm:publish'],
  admin: ['*'],
});

class AgentIdentityBoundary {
  constructor() {
    this.agentRegistry = new Map();
  }

  registerAgent({ agentId, role = 'researcher', extraCapabilities = [] } = {}) {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    const baseCapabilities = ROLE_CAPABILITY_MATRIX[role] || ROLE_CAPABILITY_MATRIX.researcher;
    const capabilities = new Set([...baseCapabilities, ...extraCapabilities]);

    const record = {
      agentId,
      role,
      capabilities: Array.from(capabilities),
      registeredAt: Date.now(),
    };

    this.agentRegistry.set(agentId, record);
    return record;
  }

  isAuthorized(agentId, requiredCapability) {
    if (!agentId || !requiredCapability) return false;
    const record = this.agentRegistry.get(agentId);
    if (!record) return false;

    if (record.capabilities.includes('*')) return true;
    if (record.capabilities.includes(requiredCapability)) return true;

    // Check wildcard namespace e.g. git:* matches git:commit
    const [ns] = requiredCapability.split(':');
    if (record.capabilities.includes(`${ns}:*`)) return true;

    return false;
  }

  verifyAction(agentId, toolName, requiredCapability) {
    const authorized = this.isAuthorized(agentId, requiredCapability);
    const agent = this.agentRegistry.get(agentId) || { agentId, role: 'unregistered' };

    return {
      allowed: authorized,
      agentId,
      role: agent.role,
      toolName,
      requiredCapability,
      decision: authorized ? 'ALLOW' : 'DENY_PRIVILEGE_VIOLATION',
      timestamp: Date.now(),
    };
  }
}

module.exports = {
  AgentIdentityBoundary,
  ROLE_CAPABILITY_MATRIX,
};
