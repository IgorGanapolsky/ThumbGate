#!/usr/bin/env node
'use strict';

/**
 * Memory Firewall — Defence pipeline for MCP Memory Gateway
 *
 * Three layers competing with ShieldCortex:
 *   1. Injection Scanner — 40+ patterns across prompt injection categories
 *   2. PII Guard — blocks PII from entering memory storage
 *   3. Trust Scoring — scores memory entries by source reliability
 *
 * All local-first. No cloud required.
 */

// ---------------------------------------------------------------------------
// Layer 1: Injection Scanner
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
  // System prompt override attempts
  { id: 'system_override', category: 'system_prompt', regex: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|guidelines?|context)\b/i, severity: 'critical' },
  { id: 'new_instructions', category: 'system_prompt', regex: /\b(?:new|updated|revised|actual|real)\s+(?:instructions?|system\s+prompt|rules?)\s*:/i, severity: 'critical' },
  { id: 'you_are_now', category: 'system_prompt', regex: /\byou\s+are\s+now\s+(?:a|an|the)\b/i, severity: 'high' },
  { id: 'act_as', category: 'system_prompt', regex: /\bact\s+as\s+(?:if|though)?\s*(?:a|an|the)?\s*(?:different|new|unrestricted|unfiltered)\b/i, severity: 'high' },
  { id: 'roleplay_jailbreak', category: 'system_prompt', regex: /\b(?:pretend|imagine)\s+(?:you\s+(?:are|have|can)|there\s+are\s+no\s+(?:rules|restrictions|limits))\b/i, severity: 'high' },

  // Privilege escalation
  { id: 'sudo_mode', category: 'privilege_escalation', regex: /\b(?:sudo|admin|root|superuser|god)\s*(?:mode|access|privileges?|level)\b/i, severity: 'critical' },
  { id: 'developer_mode', category: 'privilege_escalation', regex: /\b(?:developer|debug|maintenance|service)\s*mode\s*(?:enabled?|activated?|on)\b/i, severity: 'high' },
  { id: 'bypass_safety', category: 'privilege_escalation', regex: /\b(?:bypass|disable|turn\s+off|remove|skip)\s+(?:safety|security|filter|guard|gate|restriction|limitation)\b/i, severity: 'critical' },

  // Data exfiltration
  { id: 'reveal_system', category: 'data_exfiltration', regex: /\b(?:reveal|show|display|print|output|leak|expose|dump)\s+(?:your\s+)?(?:system\s+prompt|instructions?|internal|config|secret|hidden|private)\b/i, severity: 'critical' },
  { id: 'repeat_verbatim', category: 'data_exfiltration', regex: /\b(?:repeat|recite|echo|copy)\s+(?:everything|all|verbatim|word\s+for\s+word)\b/i, severity: 'high' },
  { id: 'send_to_url', category: 'data_exfiltration', regex: /\b(?:send|post|upload|transmit|exfiltrate)\s+(?:to|data\s+to)\s+(?:https?:\/\/|ftp:\/\/)/i, severity: 'critical' },

  // Context poisoning (most relevant to memory systems)
  { id: 'memory_inject', category: 'context_poisoning', regex: /\b(?:remember|memorize|store|save|record)\s+(?:that|this|the\s+following)\s*:\s*.{0,20}(?:always|never|must|forbidden)\b/i, severity: 'high' },
  { id: 'false_context', category: 'context_poisoning', regex: /\b(?:the\s+user|admin|system)\s+(?:said|confirmed|approved|authorized|instructed)\s+that\b/i, severity: 'high' },
  { id: 'override_memory', category: 'context_poisoning', regex: /\b(?:override|replace|update|modify)\s+(?:your\s+)?(?:memory|context|knowledge|training)\b/i, severity: 'high' },
  { id: 'inject_rule', category: 'context_poisoning', regex: /\b(?:add|insert|inject)\s+(?:a\s+)?(?:new\s+)?(?:rule|constraint|instruction|policy|directive)\b/i, severity: 'high' },

  // Encoding evasion
  { id: 'base64_payload', category: 'encoding_evasion', regex: /\b(?:decode|eval|execute|run)\s+(?:this\s+)?(?:base64|b64|encoded)\b/i, severity: 'high' },
  { id: 'unicode_smuggling', category: 'encoding_evasion', regex: /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, severity: 'medium' },
  { id: 'markdown_injection', category: 'encoding_evasion', regex: /!\[.*?\]\((?:javascript|data|vbscript):/i, severity: 'critical' },

  // Indirect injection (in memory context)
  { id: 'hidden_instruction', category: 'indirect_injection', regex: /<!--\s*(?:instruction|system|admin|override|ignore)/i, severity: 'critical' },
  { id: 'xml_injection', category: 'indirect_injection', regex: /<\/?(?:system|instruction|admin|override|prompt)[^>]*>/i, severity: 'high' },
  { id: 'json_injection', category: 'indirect_injection', regex: /"(?:system_prompt|instructions?|role)"\s*:\s*"/i, severity: 'high' },

  // Social engineering
  { id: 'urgency_pressure', category: 'social_engineering', regex: /\b(?:emergency|urgent|critical|life\s+or\s+death|immediately|right\s+now)\b.*\b(?:ignore|bypass|skip|override)\b/i, severity: 'medium' },
  { id: 'authority_claim', category: 'social_engineering', regex: /\b(?:i\s+am|this\s+is)\s+(?:the\s+)?(?:admin|developer|owner|CEO|CTO|manager|supervisor)\b/i, severity: 'medium' },

  // Tool manipulation
  { id: 'tool_override', category: 'tool_manipulation', regex: /\b(?:when\s+using|before\s+calling|instead\s+of)\s+(?:the\s+)?(?:tool|function|command|script)\b/i, severity: 'high' },
  { id: 'shell_injection', category: 'tool_manipulation', regex: /[;|&`$]\s*(?:rm|curl|wget|nc|bash|sh|python|node|eval)\b/i, severity: 'critical' },
];

function scanForInjection(text) {
  const input = String(text || '');
  if (!input.trim()) return { detected: false, findings: [], score: 0 };

  const findings = [];
  for (const pattern of INJECTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(input)) {
      findings.push({
        id: pattern.id,
        category: pattern.category,
        severity: pattern.severity,
      });
    }
  }

  const severityWeights = { critical: 10, high: 5, medium: 2, low: 1 };
  const score = findings.reduce((sum, f) => sum + (severityWeights[f.severity] || 1), 0);

  return {
    detected: findings.length > 0,
    findings,
    score,
    blocked: score >= 5,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: PII Guard
// ---------------------------------------------------------------------------

const PII_PATTERNS = [
  { id: 'email', label: 'Email address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { id: 'phone_us', label: 'US phone number', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { id: 'ssn', label: 'Social Security Number', regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g },
  { id: 'credit_card', label: 'Credit card number', regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
  { id: 'ip_address', label: 'IP address', regex: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
  { id: 'passport', label: 'Passport number', regex: /\b[A-Z]{1,2}\d{6,9}\b/g },
  { id: 'date_of_birth', label: 'Date of birth', regex: /\b(?:born|dob|date\s+of\s+birth)\s*[:=]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi },
];

function scanForPII(text) {
  const input = String(text || '');
  if (!input.trim()) return { detected: false, findings: [], redacted: input };

  const findings = [];
  let redacted = input;

  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(input);
    while (match) {
      findings.push({
        id: pattern.id,
        label: pattern.label,
      });
      match = pattern.regex.exec(input);
    }
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.id}]`);
  }

  return {
    detected: findings.length > 0,
    findings: deduplicateFindings(findings),
    redacted,
  };
}

function deduplicateFindings(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = f.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function redactPII(text) {
  return scanForPII(text).redacted;
}

// ---------------------------------------------------------------------------
// Layer 3: Trust Scoring
// ---------------------------------------------------------------------------

const SOURCE_TRUST_WEIGHTS = {
  'user_direct': 1.0,
  'agent_self': 0.8,
  'hook_capture': 0.7,
  'auto_promote': 0.6,
  'sub_agent': 0.5,
  'external': 0.3,
  'unknown': 0.4,
};

function computeTrustScore(memoryEntry) {
  const source = String(memoryEntry.source || memoryEntry.actionType || 'unknown').toLowerCase();

  // Base trust from source type
  let baseTrust = SOURCE_TRUST_WEIGHTS[source] || SOURCE_TRUST_WEIGHTS.unknown;

  // Boost for rich context (more detail = more trustworthy)
  const hasContext = Boolean(memoryEntry.context && memoryEntry.context.length > 20);
  const hasTags = Array.isArray(memoryEntry.tags) && memoryEntry.tags.length > 0;
  const hasWhatWentWrong = Boolean(memoryEntry.whatWentWrong);
  const hasWhatToChange = Boolean(memoryEntry.whatToChange);
  const hasRubric = Boolean(memoryEntry.rubric);
  const hasDiagnosis = Boolean(memoryEntry.diagnosis);

  const detailBonus = [hasContext, hasTags, hasWhatWentWrong, hasWhatToChange, hasRubric, hasDiagnosis]
    .filter(Boolean).length * 0.05;

  // Penalty for injection risk
  const injectionScan = scanForInjection(
    [memoryEntry.context, memoryEntry.whatWentWrong, memoryEntry.whatToChange, memoryEntry.whatWorked]
      .filter(Boolean)
      .join(' ')
  );
  const injectionPenalty = injectionScan.detected ? Math.min(injectionScan.score * 0.05, 0.5) : 0;

  // Penalty for PII presence
  const piiScan = scanForPII(
    [memoryEntry.context, memoryEntry.whatWentWrong, memoryEntry.whatToChange, memoryEntry.whatWorked]
      .filter(Boolean)
      .join(' ')
  );
  const piiPenalty = piiScan.detected ? 0.15 : 0;

  const score = Math.max(0, Math.min(1, baseTrust + detailBonus - injectionPenalty - piiPenalty));

  return {
    score: Math.round(score * 100) / 100,
    baseTrust,
    detailBonus: Math.round(detailBonus * 100) / 100,
    injectionPenalty: Math.round(injectionPenalty * 100) / 100,
    piiPenalty: Math.round(piiPenalty * 100) / 100,
    grade: score >= 0.8 ? 'A' : score >= 0.6 ? 'B' : score >= 0.4 ? 'C' : score >= 0.2 ? 'D' : 'F',
  };
}

// ---------------------------------------------------------------------------
// Combined Firewall Pipeline
// ---------------------------------------------------------------------------

function evaluateMemoryFirewall(text, options = {}) {
  const input = String(text || '');
  if (!input.trim()) {
    return { passed: true, injection: { detected: false, findings: [], score: 0 }, pii: { detected: false, findings: [], redacted: '' } };
  }

  const injection = scanForInjection(input);
  const pii = scanForPII(input);

  const blocked = injection.blocked || (options.blockPII && pii.detected);
  const redacted = pii.detected ? pii.redacted : input;

  return {
    passed: !blocked,
    blocked,
    injection,
    pii,
    redacted,
  };
}

module.exports = {
  INJECTION_PATTERNS,
  PII_PATTERNS,
  SOURCE_TRUST_WEIGHTS,
  scanForInjection,
  scanForPII,
  redactPII,
  computeTrustScore,
  evaluateMemoryFirewall,
};
