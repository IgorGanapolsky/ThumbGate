'use strict';

// ThumbGate gate chain for the manufacturing copilot.
// Gates run as middleware around the RAG pipeline:
//   pre-model:  input sanitization, input injection scan, retrieved-context injection scan
//   post-model: unsafe-instruction scan, safety citation enforcement
// Each gate returns { gate, status: 'pass'|'sanitized'|'block', detail }.

const path = require('node:path');
const { redactSecrets } = require(path.join(__dirname, '../../../scripts/secret-redaction.js'));

// --- Gate 1: input sanitization (PII + secrets) -----------------------------

const PII_PATTERNS = [
  { id: 'employee_id', re: /\bEMP[- ]?\d{4,8}\b/gi, replacement: '[EMPLOYEE_ID]' },
  { id: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: '[EMAIL]' },
  { id: 'phone', re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, replacement: '[PHONE]' },
  { id: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
];

function sanitizeInput(text) {
  let sanitized = redactSecrets(text);
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
      ? `Redacted before model/logs: ${redactions.join(', ')}`
      : 'No PII or secrets detected',
    sanitized,
  };
}

// --- Gate 2/3: prompt-injection scan (user input AND retrieved context) -----

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
    gate: source === 'input' ? 'injection_scan_input' : 'injection_scan_context',
    status: hits.length ? 'block' : 'pass',
    detail: hits.length
      ? `Prompt-injection pattern detected in ${source}: ${hits.length} signature(s)`
      : `No injection patterns in ${source}`,
    hits,
  };
}

// Scan retrieved chunks; quarantine any chunk carrying an injection payload so
// it never reaches the model context. The pipeline continues with clean chunks.
function quarantineChunks(chunks) {
  const clean = [];
  const quarantined = [];
  for (const chunk of chunks) {
    const scan = scanForInjection(chunk.text, 'context');
    if (scan.status === 'block') quarantined.push({ ...chunk, hits: scan.hits });
    else clean.push(chunk);
  }
  return {
    gate: 'injection_scan_context',
    status: quarantined.length ? 'block' : 'pass',
    detail: quarantined.length
      ? `Quarantined ${quarantined.length} poisoned chunk(s) from ${quarantined[0].source}; answer built from clean context only`
      : `All ${chunks.length} retrieved chunks clean`,
    clean,
    quarantined,
  };
}

// --- Gate 4: retrieval confidence -------------------------------------------

function confidenceGate(chunks, minScore = 2) {
  const top = chunks[0]?.score || 0;
  return {
    gate: 'retrieval_confidence',
    status: top >= minScore ? 'pass' : 'block',
    detail:
      top >= minScore
        ? `Top retrieval score ${top} ≥ threshold ${minScore}`
        : `Top retrieval score ${top} below threshold ${minScore} — refusing rather than guessing; escalate to supervisor`,
  };
}

// --- Gate 5: unsafe-output scan ----------------------------------------------

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
      ? 'Answer recommended defeating a safety control — blocked and escalated to safety officer'
      : 'No unsafe instructions in answer',
  };
}

// --- Gate 6: safety answers must cite the procedure --------------------------

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
  quarantineChunks,
  confidenceGate,
  unsafeOutputGate,
  safetyCitationGate,
};
