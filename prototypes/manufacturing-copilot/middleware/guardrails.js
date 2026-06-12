'use strict';

// Chatbot-owned guardrails. These run as LangGraph nodes/edges inside the
// pipeline — they are NOT ThumbGate features. ThumbGate's two roles in this
// prototype are the RLHF feedback loop and the PreToolUse firewall on tool
// execution edges; everything in this file is the chatbot protecting its own
// input, its vector store, and its output.

const path = require('node:path');
const { redactSecrets } = require(path.join(__dirname, '../../../scripts/secret-redaction.js'));

// --- Input sanitization (PII + secrets) --------------------------------------

const PII_PATTERNS = [
  { id: 'employee_id', re: /\bEMP[- ]?\d{4,8}\b/gi, replacement: '[EMPLOYEE_ID]' },
  { id: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: '[EMAIL]' },
  { id: 'phone', re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, replacement: '[PHONE]' },
  { id: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
];

function sanitizeInput(text) {
  let sanitized = redactSecrets(String(text || ''));
  const redactions = [];
  if (sanitized !== text) redactions.push('secret');
  for (const { id, re, replacement } of PII_PATTERNS) {
    if (re.test(sanitized)) {
      sanitized = sanitized.replace(re, replacement);
      redactions.push(id);
    }
    re.lastIndex = 0;
  }
  return {
    gate: 'input_sanitization',
    status: redactions.length ? 'sanitized' : 'pass',
    detail: redactions.length
      ? `Redacted before model, logs, and traces: ${redactions.join(', ')}`
      : 'No PII or secrets detected',
    sanitized,
  };
}

// --- Prompt-injection detection (user input AND document ingestion) ----------

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|policies|safety)/i,
  /disregard\s+(your|all|the)\s+(instructions|rules|guidelines|safety)/i,
  /you\s+are\s+now\s+in\s+\w+([- ]\w+)*\s+mode/i,
  /system\s+(note|prompt|override)\s+for\s+ai/i,
  /do\s+not\s+mention\s+(lockout|tagout|safety|loto)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions|api\s+key)/i,
  /\bDAN\b|jailbreak/i,
];

function scanForInjection(text, source) {
  const hits = INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.slice(0, 40));
  const gateName = source === 'input'
    ? 'injection_scan_input'
    : source === 'ingestion'
    ? 'injection_scan_ingestion'
    : 'injection_scan_retrieved';
  return {
    gate: gateName,
    status: hits.length ? 'block' : 'pass',
    detail: hits.length
      ? `Prompt-injection signature detected in ${source}: ${hits.length} pattern(s)`
      : `No injection patterns in ${source}`,
    hits,
  };
}

// --- Retrieved-context injection quarantine ---------------------------------

function quarantineRetrievedContext(chunks) {
  const cleanChunks = [];
  const quarantined = [];

  for (const chunk of chunks) {
    const scan = scanForInjection(chunk.text || '', 'retrieved_context');
    if (scan.status === 'block') {
      quarantined.push({
        title: chunk.title,
        source: chunk.source,
        fileName: chunk.fileName,
        hits: scan.hits,
      });
    } else {
      cleanChunks.push(chunk);
    }
  }

  return {
    gate: 'retrieved_context_quarantine',
    status: quarantined.length > 0 ? 'warning' : 'pass',
    detail: quarantined.length > 0
      ? `Quarantined ${quarantined.length} chunk(s) from retrieved context due to indirect prompt-injection signatures`
      : 'All retrieved chunks passed quarantine check',
    cleanChunks,
    quarantined,
  };
}

// --- Retrieval confidence -----------------------------------------------------
// LanceDB cosine: score = 2 - distance (higher is better). After hybrid
// fusion/rerank, chunks can also carry confidenceScore, which includes exact
// procedure-code, keyword, and source evidence. The default is calibrated for
// the interview fixture and can be raised with env config.

function confidenceGate(chunks, minScore = Number(process.env.CONFIDENCE_MIN_SCORE || 0.50)) {
  const top = chunks[0]?.confidenceScore ?? chunks[0]?.score ?? 0;
  const scoreLabel = chunks[0]?.confidenceScore !== undefined ? 'hybrid confidence score' : 'vector score';
  return {
    gate: 'retrieval_confidence',
    status: top >= minScore ? 'pass' : 'block',
    detail:
      top >= minScore
        ? `Top ${scoreLabel} ${top.toFixed(3)} ≥ threshold ${minScore}`
        : `Top ${scoreLabel} ${top.toFixed(3)} below threshold ${minScore} — refusing rather than guessing; escalate to supervisor`,
  };
}

// --- Output safety ------------------------------------------------------------

const UNSAFE_OUTPUT_PATTERNS = [
  /bypass(ing)?\s+(the\s+)?(interlock|guard|light\s+curtain|safety)/i,
  /(mute|defeat|disable|override)\s+(the\s+)?(interlock|guard|light\s+curtain|safety\s+(device|system))/i,
  /without\s+(performing\s+)?(loto|lockout)/i,
  /skip\s+(the\s+)?(lockout|tagout|permit)/i,
  /shortcut\s+approved/i,
];

function unsafeOutputGate(answer) {
  const hits = UNSAFE_OUTPUT_PATTERNS.filter((re) => re.test(answer));
  return {
    gate: 'unsafe_output_scan',
    status: hits.length ? 'block' : 'pass',
    detail: hits.length
      ? 'Draft answer recommended defeating a safety control — blocked and escalated to safety officer'
      : 'No unsafe instructions in answer',
  };
}

// --- Safety answers must cite the procedure ---------------------------------

function safetyCitationGate(answer, route) {
  if (route !== 'safety' && route !== true) {
    return { gate: 'safety_citation', status: 'pass', detail: 'Not a safety-routed answer; citation not required' };
  }
  const cited =
    /\bSP-\d{3}\b/.test(answer) ||
    /\bOSHA\b[\s\S]{0,120}\bp\.\s*\d+\b/i.test(answer) ||
    /\[(Safety Procedures Manual|Maintenance Manual|Quality Control Standards|OSHA\s*\d*),\s*Page\s*\d+\]/i.test(answer) ||
    /\b(Safety Procedures Manual|Maintenance Manual|Quality Control Standards)\b[\s\S]{0,100}\bp(g|age)?\.\s*\d+/i.test(answer);
  return {
    gate: 'safety_citation',
    status: cited ? 'pass' : 'block',
    detail: cited
      ? 'Answer cites the governing safety source'
      : 'Safety answer missing procedure or OSHA page citation — blocked; cited source required',
  };
}

const ROLE_POLICIES = {
  operator: {
    label: 'Floor Operator',
    clearanceLevel: 0,
    allowed: ['read_approved_procedures', 'view_machine_state'],
    blocked: ['trigger_emergency_shutdown', 'override_interlock', 'write_plc_control', 'plant_wide_shutdown', 'read_confined_space_procedures', 'read_safety_override_procedures'],
  },
  supervisor: {
    label: 'Floor Supervisor',
    clearanceLevel: 1,
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation', 'read_confined_space_procedures'],
    blocked: ['trigger_emergency_shutdown', 'override_interlock', 'write_plc_control', 'plant_wide_shutdown', 'read_safety_override_procedures'],
  },
  floor_supervisor: {
    label: 'Floor Supervisor',
    clearanceLevel: 1,
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation', 'read_confined_space_procedures'],
    blocked: ['trigger_emergency_shutdown', 'override_interlock', 'write_plc_control', 'plant_wide_shutdown', 'read_safety_override_procedures'],
  },
  plant_manager: {
    label: 'Plant Manager',
    clearanceLevel: 2,
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation', 'read_confined_space_procedures', 'read_safety_override_procedures', 'approve_emergency_shutdown'],
    blocked: ['override_interlock', 'write_plc_control'],
  },
  ehs_incident_commander: {
    label: 'EHS Incident Commander',
    clearanceLevel: 2,
    allowed: ['read_approved_procedures', 'view_machine_state', 'request_escalation', 'read_confined_space_procedures', 'read_safety_override_procedures', 'approve_emergency_shutdown'],
    blocked: ['override_interlock', 'write_plc_control'],
  },
};

const ROLE_CLEARANCES = {
  operator: 0,
  floor_supervisor: 1,
  supervisor: 1,
  plant_manager: 2,
  ehs_incident_commander: 2,
};

function clearanceGate(question, role) {
  const userRole = String(role || 'operator').toLowerCase();
  const userClearance = ROLE_CLEARANCES[userRole] ?? 0;
  const q = String(question || '').toLowerCase();

  // Rule 1: SP-110 / safety overrides requires Plant Manager (Clearance 2)
  const isBypassOverrideQuery = 
    /\bsp-110\b/i.test(q) ||
    /bypass(ing)?\s+(the\s+)?(interlock|guard|light\s+curtain|safety)/i.test(q) ||
    /(mute|defeat|disable|override)\s+(the\s+)?(interlock|guard|light\s+curtain|safety)/i.test(q);

  if (isBypassOverrideQuery && userClearance < 2) {
    return {
      gate: 'clearance_gate',
      status: 'block',
      detail: `Access Denied: Safety system override procedures (SP-110) require Plant Manager clearance. Current role: ${userRole.toUpperCase()}`,
    };
  }

  // Rule 2: Confined Space Entry SP-102 / mixing tanks require Supervisor (Clearance 1)
  const isConfinedSpaceQuery = 
    /\bsp-102\b/i.test(q) ||
    /confined\s+space/i.test(q) ||
    /mixing\s+tank/i.test(q);

  if (isConfinedSpaceQuery && userClearance < 1) {
    return {
      gate: 'clearance_gate',
      status: 'block',
      detail: `Access Denied: Confined space entry instructions (SP-102) require Floor Supervisor clearance. Current role: ${userRole.toUpperCase()}`,
    };
  }

  // Rule 3: Plant-Wide Shutdown / Emergency Shutdown (informational query) requires Plant Manager (Clearance 2)
  const isShutdownQuery = 
    (/\b(shutdown|shut\s+down|power\s+down|kill\s+power)\b/i.test(q)) &&
    (/\b(plant|floor|production|main|conveyor|line|press)\b/i.test(q));

  if (isShutdownQuery && userClearance < 2) {
    return {
      gate: 'clearance_gate',
      status: 'block',
      detail: `Access Denied: Plant-wide or equipment emergency shutdown instructions require Plant Manager clearance. Current role: ${userRole.toUpperCase()}`,
    };
  }

  return {
    gate: 'clearance_gate',
    status: 'pass',
    detail: `Clearance check passed for role: ${userRole.toUpperCase()}`,
  };
}

module.exports = {
  sanitizeInput,
  scanForInjection,
  quarantineRetrievedContext,
  confidenceGate,
  unsafeOutputGate,
  safetyCitationGate,
  ROLE_POLICIES,
  clearanceGate,
};
