#!/usr/bin/env node
'use strict';

/**
 * PII Scanner — LogSentinel-inspired PII detection for ThumbGate.
 *
 * Scans feedback content, context packs, and DPO exports for PII patterns.
 * Applies hierarchical sensitivity labels. Redacts or rejects as configured.
 * Builds on secret-scanner.js patterns + adds PII-specific detectors.
 */

const { SECRET_PATTERNS, redactText: redactSecrets } = require('./secret-scanner');

// PII patterns beyond secrets — emails, phone numbers, SSNs, card numbers, IP addresses
const PII_PATTERNS = [
  { id: 'email', label: 'Email address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, sensitivity: 'sensitive' },
  { id: 'phone_us', label: 'US phone number', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, sensitivity: 'sensitive' },
  { id: 'ssn', label: 'Social Security Number', regex: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, sensitivity: 'restricted' },
  { id: 'credit_card', label: 'Credit card number', regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, sensitivity: 'restricted' },
  { id: 'ip_address', label: 'IP address', regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, sensitivity: 'internal' },
  { id: 'aws_account', label: 'AWS account ID', regex: /\b\d{12}\b/g, sensitivity: 'internal' },
];

const SENSITIVITY_LEVELS = ['public', 'internal', 'sensitive', 'restricted'];

function sensitivityRank(level) {
  const idx = SENSITIVITY_LEVELS.indexOf(level);
  return idx >= 0 ? idx : 0;
}

/**
 * Scan text for PII and return findings with sensitivity labels.
 */
function scanForPii(text) {
  if (!text) return { findings: [], highestSensitivity: 'public', hasPii: false };
  const str = String(text);
  const findings = [];
  let highest = 'public';

  for (const pattern of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;
    const matches = str.match(pattern.regex);
    if (matches && matches.length > 0) {
      findings.push({
        id: pattern.id,
        label: pattern.label,
        sensitivity: pattern.sensitivity,
        matchCount: matches.length,
        sample: matches[0].slice(0, 4) + '***',
      });
      if (sensitivityRank(pattern.sensitivity) > sensitivityRank(highest)) {
        highest = pattern.sensitivity;
      }
    }
  }

  return { findings, highestSensitivity: highest, hasPii: findings.length > 0 };
}

/**
 * Redact PII from text. Returns redacted string.
 */
function redactPii(text) {
  if (!text) return '';
  let redacted = String(text);
  // First redact secrets (API keys, tokens)
  redacted = redactSecrets(redacted);
  // Then redact PII
  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.id}]`);
  }
  return redacted;
}

/**
 * Assign a sensitivity label to a feedback entry based on content scan.
 * Returns: { sensitivity, findings, redactedContent }
 */
function classifyFeedback(feedbackEntry) {
  const content = [
    feedbackEntry.context || '',
    feedbackEntry.whatWentWrong || '',
    feedbackEntry.whatToChange || '',
    feedbackEntry.whatWorked || '',
  ].join('\n');

  const scan = scanForPii(content);

  return {
    sensitivity: scan.highestSensitivity,
    findings: scan.findings,
    hasPii: scan.hasPii,
    redactedContent: scan.hasPii ? redactPii(content) : content,
    originalContentHash: require('crypto').createHash('sha256').update(content).digest('hex').slice(0, 16),
  };
}

/**
 * Scan a DPO pair for PII. Returns scan result with pass/fail.
 */
function scanDpoPair(pair) {
  const chosen = scanForPii(pair.chosen || '');
  const rejected = scanForPii(pair.rejected || '');
  const prompt = scanForPii(pair.prompt || '');
  const allFindings = [...prompt.findings, ...chosen.findings, ...rejected.findings];
  const highest = SENSITIVITY_LEVELS[Math.max(
    sensitivityRank(prompt.highestSensitivity),
    sensitivityRank(chosen.highestSensitivity),
    sensitivityRank(rejected.highestSensitivity),
  )];

  return {
    hasPii: allFindings.length > 0,
    highestSensitivity: highest,
    findings: allFindings,
    safe: sensitivityRank(highest) < sensitivityRank('sensitive'),
  };
}

/**
 * Gate a DPO export: filter out pairs containing PII above threshold.
 * Returns { safePairs, blockedPairs, blockedCount, totalScanned }.
 */
function gateDpoExport(pairs, { maxSensitivity = 'internal' } = {}) {
  const maxRank = sensitivityRank(maxSensitivity);
  const safePairs = [];
  const blockedPairs = [];

  for (const pair of pairs) {
    const scan = scanDpoPair(pair);
    if (sensitivityRank(scan.highestSensitivity) <= maxRank) {
      safePairs.push(pair);
    } else {
      blockedPairs.push({ pair, scan });
    }
  }

  return {
    safePairs,
    blockedPairs,
    blockedCount: blockedPairs.length,
    totalScanned: pairs.length,
    passRate: pairs.length > 0 ? Math.round((safePairs.length / pairs.length) * 1000) / 10 : 100,
  };
}

module.exports = {
  PII_PATTERNS, SENSITIVITY_LEVELS,
  scanForPii, redactPii, classifyFeedback,
  scanDpoPair, gateDpoExport, sensitivityRank,
};
