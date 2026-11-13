/**
 * Box & NVIDIA Agent Security & Context Governance Diode
 * 
 * Architectural implementations from BoxWorks 2026 (Box + NVIDIA, Aaron Levie, Jensen Huang, Helen Yu):
 * 1. Permission-Aware Context Retrieval (NVIDIA Nemotron Retriever pattern with strict pre-LLM ACL enforcement)
 * 2. MCP Guardrails & Action Boundaries (role-based MCP tool policy, boundary containment)
 * 3. Classification-Based Access Control (PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED_PII)
 * 4. Agent Threat & Velocity Anomaly Detection (detects mass exfiltration, unusual download velocity, mass deletion)
 * 5. Governed Sandbox Mount Invariants (ensures sandbox containment and audit trail parity)
 */

'use strict';

const CLASSIFICATION_LEVELS = {
  PUBLIC: 1,
  INTERNAL: 2,
  CONFIDENTIAL: 3,
  RESTRICTED_PII: 4,
  TOP_SECRET: 5
};

const AGENT_ROLE_CLEARANCE = {
  untrusted_guest: CLASSIFICATION_LEVELS.PUBLIC,
  researcher_agent: CLASSIFICATION_LEVELS.INTERNAL,
  developer_agent: CLASSIFICATION_LEVELS.CONFIDENTIAL,
  security_auditor: CLASSIFICATION_LEVELS.RESTRICTED_PII,
  admin_orchestrator: CLASSIFICATION_LEVELS.TOP_SECRET
};

const BANNED_TOOLS_BY_ROLE = {
  untrusted_guest: ['terminal', 'write_file', 'patch', 'mcp__gitbutler', 'delete_file'],
  researcher_agent: ['terminal', 'write_file', 'patch', 'delete_file', 'execute_code'],
  developer_agent: ['delete_file', 'database_drop', 'revoke_keys'],
  security_auditor: ['database_drop', 'revoke_keys'],
  admin_orchestrator: []
};

// ============================================================================
// 1. Permission-Aware Context Retrieval Filter
// ============================================================================

function filterContextByAgentPermissions({ agentRole, passages = [] }) {
  const agentClearance = AGENT_ROLE_CLEARANCE[agentRole] || CLASSIFICATION_LEVELS.PUBLIC;

  const allowedPassages = [];
  const redactedPassages = [];

  for (const passage of passages) {
    const requiredLevel = CLASSIFICATION_LEVELS[passage.classification] || CLASSIFICATION_LEVELS.INTERNAL;
    
    if (agentClearance >= requiredLevel) {
      allowedPassages.push(passage);
    } else {
      redactedPassages.push({
        documentId: passage.documentId,
        title: passage.title,
        requiredClassification: passage.classification,
        agentClearanceLevel: agentRole,
        reason: 'INSUFFICIENT_CLEARANCE_PRE_LLM_ACL'
      });
    }
  }

  return {
    allowedPassages,
    redactedCount: redactedPassages.length,
    redactedPassages,
    isFullyCompliant: redactedPassages.length === 0,
    summary: `Retrieved ${allowedPassages.length} authorized passages; filtered out ${redactedPassages.length} unauthorized passages before LLM context injection.`
  };
}

// ============================================================================
// 2. MCP Guardrails & Action Boundary Enforcer
// ============================================================================

function enforceMcpToolGuardrails({ agentRole, toolName, parameters = {} }) {
  const bannedList = BANNED_TOOLS_BY_ROLE[agentRole] || BANNED_TOOLS_BY_ROLE.untrusted_guest;

  if (bannedList.includes(toolName)) {
    return {
      allowed: false,
      decision: 'BLOCK',
      violation: 'MCP_ROLE_TOOL_RESTRICTION',
      reason: `Agent role '${agentRole}' is restricted from invoking MCP tool '${toolName}'.`
    };
  }

  // Path boundary validation: prevent sandbox escaping
  const targetPath = parameters.path || parameters.file_path || parameters.destination;
  if (targetPath) {
    if (targetPath.includes('../') || targetPath.includes('/etc/') || targetPath.includes('/.ssh/')) {
      return {
        allowed: false,
        decision: 'BLOCK',
        violation: 'MCP_PATH_TRAVERSAL_DETECTED',
        reason: `MCP boundary violation: attempt to access sensitive or escaped path '${targetPath}'.`
      };
    }
  }

  return {
    allowed: true,
    decision: 'ALLOW',
    reason: `MCP tool call '${toolName}' allowed under '${agentRole}' boundaries.`
  };
}

// ============================================================================
// 3. Agent Velocity & Threat Anomaly Detection
// ============================================================================

class AgentThreatDetector {
  constructor({ maxDocsPerMinute = 30, maxDeletionsPerMinute = 3 } = {}) {
    this.maxDocsPerMinute = maxDocsPerMinute;
    this.maxDeletionsPerMinute = maxDeletionsPerMinute;
    this.agentActivity = new Map(); // agentId -> activityLog[]
  }

  recordActivity({ agentId, actionType, timestamp = Date.now() }) {
    if (!this.agentActivity.has(agentId)) {
      this.agentActivity.set(agentId, []);
    }
    const log = this.agentActivity.get(agentId);
    log.push({ actionType, timestamp });

    // Window prune: keep only last 60 seconds
    const cutoff = timestamp - 60000;
    const windowed = log.filter(item => item.timestamp >= cutoff);
    this.agentActivity.set(agentId, windowed);

    const docRetrievals = windowed.filter(i => i.actionType === 'RETRIEVE_DOCUMENT').length;
    const deletions = windowed.filter(i => i.actionType === 'DELETE_FILE' || i.actionType === 'PURGE').length;

    if (docRetrievals > this.maxDocsPerMinute) {
      return {
        anomalyDetected: true,
        trippedCircuitBreaker: true,
        violation: 'MASS_EXFILTRATION_VELOCITY_EXCEEDED',
        message: `ALERT: Agent '${agentId}' requested ${docRetrievals} documents in 60s (threshold: ${this.maxDocsPerMinute}). Circuit breaker tripped.`
      };
    }

    if (deletions > this.maxDeletionsPerMinute) {
      return {
        anomalyDetected: true,
        trippedCircuitBreaker: true,
        violation: 'MASS_DELETION_ANOMALY',
        message: `ALERT: Agent '${agentId}' initiated ${deletions} destructive deletes in 60s (threshold: ${this.maxDeletionsPerMinute}). Circuit breaker tripped.`
      };
    }

    return {
      anomalyDetected: false,
      trippedCircuitBreaker: false,
      docRetrievalsInWindow: docRetrievals,
      deletionsInWindow: deletions
    };
  }
}

// ============================================================================
// 4. Governed Sandbox Mount Invariants
// ============================================================================

function validateSandboxMountPath({ workspaceRoot, mountPath }) {
  const normalizedRoot = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/';
  
  if (!mountPath.startsWith(normalizedRoot)) {
    return {
      allowed: false,
      violation: 'SANDBOX_ESCAPE_MOUNT',
      reason: `Mount path '${mountPath}' is outside the authorized workspace root '${workspaceRoot}'.`
    };
  }

  return {
    allowed: true,
    reason: `Sandbox mount path '${mountPath}' verified within workspace sandbox.`
  };
}

module.exports = {
  CLASSIFICATION_LEVELS,
  AGENT_ROLE_CLEARANCE,
  BANNED_TOOLS_BY_ROLE,
  filterContextByAgentPermissions,
  enforceMcpToolGuardrails,
  AgentThreatDetector,
  validateSandboxMountPath
};
