'use strict';

const { executeManufacturingGraph } = require('./graph');

const ROLE_POLICIES = {
  floor_supervisor: {
    label: 'Floor Supervisor',
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation'],
    blocked: ['trigger_emergency_shutdown', 'override_interlock', 'write_plc_control', 'plant_wide_shutdown'],
  },
  maintenance_authorized: {
    label: 'Authorized Maintenance',
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation'],
    blocked: ['trigger_emergency_shutdown', 'override_interlock', 'write_plc_control', 'plant_wide_shutdown'],
  },
  ehs_incident_commander: {
    label: 'EHS Incident Commander',
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation', 'approve_emergency_shutdown'],
    blocked: ['override_interlock', 'write_plc_control'],
  },
};

function actorRole(actor = {}) {
  return actor.role || 'floor_supervisor';
}

/**
 * Checks if the user request implies executing a physical plant action (tool call).
 * Returns the proposed tool call object or null.
 */
function detectProposedToolCall(query) {
  const q = query.toLowerCase();

  // If the query is seeking information, manual procedures, or asking a question,
  // it is not a direct request to execute a physical tool/control action.
  const isInformational = 
    /^(explain|what|how|why|tell|show|is|are|should|where|procedure|manual|checklist|documentation|instructions)\b/i.test(q) ||
    /\b(explain|how|why|procedure|manual|checklist|documentation|instructions|read|details|steps|about|info|information|guide|guidelines|doc|docs|sp-\d{3}|mm-\d{3}|qc-\d{3})\b/i.test(q);

  if (isInformational) {
    return null;
  }

  if (/\b(bypass|disable|override|mute|defeat)\b/.test(q) && /\b(interlock|guard|safety|light curtain)\b/.test(q)) {
    return {
      toolName: 'override_interlock',
      input: {
        machine: q.includes('vm-22') ? 'CNC Mill VM-22' : 'Hydraulic Press HP-400',
        parameter: 'safety_interlock',
        value: 'disabled'
      },
      description: 'Defeat machine safety guard or interlock switch'
    };
  }

  if (
    /\b(shutdown|shut\s+down|stop\s+assembly|turn\s+off|power\s+down|kill\s+power)\b/.test(q)
    && /\b(plant|line|assembly|conveyor|press|machine|equipment|production|floor|main)\b/.test(q)
  ) {
    const plantWide = /\b(plant|facility|entire\s+floor|whole\s+floor|production\s+floor)\b/.test(q);
    return {
      toolName: plantWide ? 'plant_wide_shutdown' : 'trigger_emergency_shutdown',
      input: {
        target: plantWide ? 'Acme Plant 7' : q.includes('c-3') ? 'Conveyor Line C-3' : 'Main Press Line HP-400',
        reason: 'Operator manual request'
      },
      description: plantWide
        ? 'Request plant-wide shutdown or power-down'
        : 'Activate emergency power cutoff to manufacturing line'
    };
  }

  return null;
}

/**
 * ThumbGate PreAction Firewall: Evaluates tool calls against deterministic safety rules.
 * Returns { allowed: boolean, reason: string, gate: string }
 */
function evaluatePreToolUseGate(toolCall, actor = {}) {
  if (!toolCall) return { allowed: true };
  const role = actorRole(actor);
  const policy = ROLE_POLICIES[role] || ROLE_POLICIES.floor_supervisor;

  if (toolCall.toolName === 'override_interlock') {
    return {
      allowed: false,
      gate: 'no_safety_bypass',
      actorRole: role,
      reason: 'CRITICAL SECURITY VIOLATION: Defeating or bypassing machine interlocks is strictly prohibited under safety regulation SP-110.'
    };
  }

  if (toolCall.toolName === 'plant_wide_shutdown') {
    if (role === 'plant_manager' || role === 'ehs_incident_commander') {
      return { allowed: true };
    }
    return {
      allowed: false,
      gate: 'role_permission_floor_supervisor',
      actorRole: role,
      requiredRole: 'ehs_incident_commander',
      reason: `${policy.label} users may read approved procedures and escalate incidents, but cannot execute or receive plant-wide shutdown instructions. Escalate to the EHS incident commander and control room.`
    };
  }

  if (toolCall.toolName === 'trigger_emergency_shutdown') {
    if (role === 'plant_manager' || role === 'ehs_incident_commander') {
      return { allowed: true };
    }
    return {
      allowed: false,
      gate: 'role_permission_floor_supervisor',
      actorRole: role,
      requiredRole: 'ehs_incident_commander',
      reason: `${policy.label} users may read approved procedures and escalate incidents, but cannot execute or receive emergency shutdown instructions. Shutdown authority requires EHS incident commander and control-room authorization.`
    };
  }

  return { allowed: true };
}

/**
 * Public RAG facade. The actual chatbot workflow is a LangGraph state machine
 * using LangChain prompt/retriever components. ThumbGate is only invoked for
 * outbound tool-call firewall checks and feedback capture elsewhere.
 */
async function executeRAGPipeline(question, options = {}) {
  return executeManufacturingGraph(question, {
    detectProposedToolCall,
    evaluatePreToolUseGate,
    ...options,
  });
}

module.exports = {
  executeRAGPipeline,
  detectProposedToolCall,
  evaluatePreToolUseGate,
  ROLE_POLICIES
};
