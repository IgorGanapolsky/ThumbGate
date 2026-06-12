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
  return {
    gate: source === 'input' ? 'injection_scan_input' : 'injection_scan_ingestion',
    status: hits.length ? 'block' : 'pass',
    detail: hits.length
      ? `Prompt-injection signature detected in ${source}: ${hits.length} pattern(s)`
      : `No injection patterns in ${source}`,
    hits,
  };
}

// --- Retrieval confidence -----------------------------------------------------
// LanceDB cosine: score = 2 - distance (higher is better). Relevant chunks
// land ~1.1-1.3 with the local MiniLM profile; unrelated questions ~0.8.

function confidenceGate(chunks, minScore = Number(process.env.CONFIDENCE_MIN_SCORE || 0.95)) {
  const top = chunks[0]?.score ?? 0;
  return {
    gate: 'retrieval_confidence',
    status: top >= minScore ? 'pass' : 'block',
    detail:
      top >= minScore
        ? `Top vector score ${top.toFixed(3)} ≥ threshold ${minScore}`
        : `Top vector score ${top.toFixed(3)} below threshold ${minScore} — refusing rather than guessing; escalate to supervisor`,
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
  if (route !== 'safety') {
    return { gate: 'safety_citation', status: 'pass', detail: 'Not a safety-routed answer; citation not required' };
  }
  const cited = /\bSP-\d{3}\b/.test(answer);
  return {
    gate: 'safety_citation',
    status: cited ? 'pass' : 'block',
    detail: cited
      ? 'Answer cites the governing safety procedure'
      : 'Safety answer missing procedure citation (SP-xxx) — blocked; verbatim procedure required',
  };
}

module.exports = {
  sanitizeInput,
  scanForInjection,
  confidenceGate,
  unsafeOutputGate,
  safetyCitationGate,
};
