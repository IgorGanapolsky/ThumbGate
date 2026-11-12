#!/usr/bin/env node
'use strict';

/**
 * Data Governance — GitHub Copilot-inspired interaction data preferences.
 *
 * Controls what feedback data can be exported, shared, or used for training.
 * Integrates with PII scanner and DPO export gate to enforce user preferences.
 * Local-first: preferences stored on disk, nothing phones home without consent.
 */

const fs = require('fs');
const path = require('path');
const { scanForPii, redactPii, gateDpoExport } = require('./pii-scanner');
const { resolveFeedbackDir } = require('./feedback-paths');
const { tokenizeFormatPreservingVaultless } = require('./secret-redaction');

const PREFERENCES_FILE = 'data-usage-preferences.json';

const DEFAULT_PREFERENCES = {
  version: 1,
  allowDpoExport: true,
  allowSlowLoopTraining: true,
  allowOrgDashboardSharing: true,
  allowFeedbackCollection: true,
  piiRedactionEnabled: true,
  maxExportSensitivity: 'internal',
  retentionDays: 90,
  updatedAt: null,
};

function getPreferencesPath() {
  return path.join(resolveFeedbackDir(), PREFERENCES_FILE);
}

function loadPreferences() {
  const p = getPreferencesPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_PREFERENCES };
  try {
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

function savePreferences(prefs) {
  const p = getPreferencesPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const merged = { ...DEFAULT_PREFERENCES, ...prefs, updatedAt: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

function updatePreference(key, value) {
  if (!(key in DEFAULT_PREFERENCES)) throw new Error(`Unknown preference: "${key}". Valid: ${Object.keys(DEFAULT_PREFERENCES).join(', ')}`);
  if (key === 'version') throw new Error('Cannot modify version field');
  const prefs = loadPreferences();
  prefs[key] = value;
  return savePreferences(prefs);
}

/**
 * Check if a specific data operation is allowed by current preferences.
 */
function isOperationAllowed(operation) {
  const prefs = loadPreferences();
  switch (operation) {
    case 'dpo_export': return prefs.allowDpoExport;
    case 'slow_loop': return prefs.allowSlowLoopTraining;
    case 'org_dashboard': return prefs.allowOrgDashboardSharing;
    case 'feedback_capture': return prefs.allowFeedbackCollection;
    default: return true;
  }
}

/**
 * Apply governance policies to a DPO export: check preferences, scan PII, gate output.
 * Returns { allowed, pairs, blocked, reason, piiStats }.
 */
function tokenizePairFieldsAtSource(pair, salt) {
  const opts = { salt, preserveSecretReferentialIntegrity: true };
  return {
    prompt: tokenizeFormatPreservingVaultless(pair.prompt || '', opts),
    chosen: tokenizeFormatPreservingVaultless(pair.chosen || '', opts),
    rejected: tokenizeFormatPreservingVaultless(pair.rejected || '', opts),
  };
}

function governedDpoExport(pairs, options = {}) {
  const prefs = loadPreferences();
  if (!prefs.allowDpoExport) {
    return { allowed: false, pairs: [], blocked: pairs.length, reason: 'DPO export disabled by user preference', piiStats: null };
  }
  const useSourceTokenization = options.tokenizeAtSource === true;
  const candidatePairs = useSourceTokenization
    ? pairs.map((pair) => tokenizePairFieldsAtSource(pair, options.salt))
    : pairs;
  const gateResult = gateDpoExport(candidatePairs, { maxSensitivity: prefs.maxExportSensitivity });
  let safePairs = gateResult.safePairs;
  if (prefs.piiRedactionEnabled) {
    safePairs = safePairs.map((p) => ({
      prompt: redactPii(p.prompt),
      chosen: redactPii(p.chosen),
      rejected: redactPii(p.rejected),
    }));
  }
  return {
    allowed: true,
    pairs: safePairs,
    blocked: gateResult.blockedCount,
    totalScanned: gateResult.totalScanned,
    passRate: gateResult.passRate,
    reason: gateResult.blockedCount > 0 ? `${gateResult.blockedCount} pairs blocked by PII gate` : 'all pairs clean',
    piiStats: {
      blockedCount: gateResult.blockedCount,
      redactionEnabled: prefs.piiRedactionEnabled,
      maxSensitivity: prefs.maxExportSensitivity,
      protectionMode: useSourceTokenization ? 'source_format_preserving_tokenization' : 'masking_redaction',
    },
  };
}

/**
 * Apply retention policy: delete feedback entries older than retentionDays.
 * Returns count of entries purged.
 */
function enforceRetention() {
  const prefs = loadPreferences();
  const feedbackDir = resolveFeedbackDir();
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  if (!fs.existsSync(logPath)) return { purged: 0, remaining: 0 };

  const cutoff = Date.now() - prefs.retentionDays * 24 * 60 * 60 * 1000;
  const raw = fs.readFileSync(logPath, 'utf-8').trim();
  if (!raw) return { purged: 0, remaining: 0 };

  const lines = raw.split('\n');
  const kept = [];
  let purged = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const ts = new Date(entry.timestamp || entry.createdAt || 0).getTime();
      if (ts > cutoff) { kept.push(line); } else { purged++; }
    } catch { kept.push(line); }
  }

  fs.writeFileSync(logPath, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
  return { purged, remaining: kept.length, retentionDays: prefs.retentionDays };
}

/**
 * Generate a human-readable data usage summary for compliance.
 */
function generateDataUsageSummary() {
  const prefs = loadPreferences();
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.thumbgate');
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  let entryCount = 0;
  if (fs.existsSync(logPath)) {
    const raw = fs.readFileSync(logPath, 'utf-8').trim();
    entryCount = raw ? raw.split('\n').length : 0;
  }

  return {
    dataStorageLocation: 'local-only (on-device)',
    phonesHome: false,
    feedbackEntries: entryCount,
    preferences: {
      dpoExport: prefs.allowDpoExport ? 'enabled' : 'disabled',
      slowLoopTraining: prefs.allowSlowLoopTraining ? 'enabled' : 'disabled',
      orgDashboardSharing: prefs.allowOrgDashboardSharing ? 'enabled' : 'disabled',
      piiRedaction: prefs.piiRedactionEnabled ? 'enabled' : 'disabled',
      maxExportSensitivity: prefs.maxExportSensitivity,
      retentionDays: prefs.retentionDays,
    },
    compliance: {
      localFirst: true,
      piiScanning: prefs.piiRedactionEnabled,
      dataRetention: `${prefs.retentionDays} days`,
      exportGating: prefs.allowDpoExport ? `PII gate at ${prefs.maxExportSensitivity} threshold` : 'exports disabled',
    },
    generatedAt: new Date().toISOString(),
  };
}

const CLASSICAL_PQC_COUNTDOWN_RE = /^(?:rsa|ecdsa|es256|es384|es512|rs256|rs384|rs512|ps256|ps384|ps512|dh|ecdh)(?:[-_/\d]|$)/i;

function isPositiveFiniteNumber(val) {
  const num = Number(val);
  return Number.isFinite(num) && num > 0;
}

function computeProjectedExhaustionMonths(annualBudgetUsd, spendToDateUsd, elapsedMonths) {
  if (!isPositiveFiniteNumber(annualBudgetUsd) || !isPositiveFiniteNumber(spendToDateUsd) || !isPositiveFiniteNumber(elapsedMonths)) {
    return null;
  }
  const monthlyBurn = Number(spendToDateUsd) / Number(elapsedMonths);
  return Number((Number(annualBudgetUsd) / monthlyBurn).toFixed(2));
}

/**
 * Gartner Symposium 2026 Inference-Paradox & Cost-Exhaustion Circuit Breaker.
 * Shifts orchestration from tokenmaxxing to valuemaxxing and halts cost-exhaustion amplification.
 */
function evaluateInferenceParadoxGuard({
  baselineTaskTokens = 1000,
  agentWorkflowTokens = 1000,
  annualBudgetUsd = 0,
  spendToDateUsd = 0,
  elapsedMonths = 1,
  publicFacing = false,
  requestsPerMinute = 0,
  maxPublicRpm = 60,
  positiveReturnVerified = false,
  maxAmplificationRatio = 30,
} = {}) {
  const safeBaseline = Math.max(1, Number(baselineTaskTokens) || 1);
  const safeAgentTokens = Math.max(0, Number(agentWorkflowTokens) || 0);
  const tokenAmplificationRatio = Number((safeAgentTokens / safeBaseline).toFixed(2));
  const projectedExhaustionMonths = computeProjectedExhaustionMonths(annualBudgetUsd, spendToDateUsd, elapsedMonths);
  const costExhaustionRisk = Boolean(publicFacing) && (requestsPerMinute > maxPublicRpm || tokenAmplificationRatio > maxAmplificationRatio);
  const budgetBurnAlert = projectedExhaustionMonths !== null && projectedExhaustionMonths < 12;

  const blockers = [];
  if (costExhaustionRisk) blockers.push('cost_exhaustion_circuit_open');
  if (tokenAmplificationRatio > maxAmplificationRatio) blockers.push('runaway_agent_token_amplification');
  if (budgetBurnAlert) blockers.push('annual_budget_exhaustion_trajectory');
  if (!positiveReturnVerified) blockers.push('unverified_roi_scale_out_blocked');

  const allowScaleOut = blockers.length === 0;
  return {
    tokenAmplificationRatio,
    inGartnerAgentMultiplierBand: tokenAmplificationRatio >= 5 && tokenAmplificationRatio <= 30,
    projectedExhaustionMonths,
    budgetBurnAlert,
    costExhaustionRisk,
    circuitState: costExhaustionRisk ? 'OPEN' : 'CLOSED',
    operatingMode: allowScaleOut ? 'valuemaxxing' : 'tokenmaxxing_contained',
    allowScaleOut,
    blockers,
  };
}

function auditCryptoAlgorithmsForPqc(cryptoAlgorithms = [], currentYear = 2026) {
  return cryptoAlgorithms.map((rawAlg) => {
    const algorithm = String(rawAlg || '').trim();
    const vulnerable = CLASSICAL_PQC_COUNTDOWN_RE.test(algorithm);
    return {
      algorithm,
      classicalPublicKeyVulnerable: vulnerable,
      deprecatedByYear: vulnerable ? 2030 : null,
      disallowedByYear: vulnerable ? 2035 : null,
      yearsUntilDeprecation: vulnerable ? Math.max(0, 2030 - currentYear) : null,
    };
  });
}

/**
 * Gartner Symposium 2026 Agentic Governance System of Record.
 * Tracks AI Custodian accountability, Shadow AI, Dark AI, urgency bypasses, and NIST 2030/2035 PQC countdown.
 */
function evaluateGartnerAgenticGovernanceRecord({
  custodianOwner = '',
  registeredAgents = [],
  observedAgents = [],
  darkAiEvents = [],
  bypassAttempts = 0,
  cryptoAlgorithms = [],
  currentYear = 2026,
} = {}) {
  const custodianAssigned = typeof custodianOwner === 'string' && custodianOwner.trim().length > 0;
  const registeredSet = new Set(registeredAgents);
  const shadowAiAgents = observedAgents.filter((agentId) => !registeredSet.has(agentId));
  const darkAiIncidents = Array.isArray(darkAiEvents) ? [...darkAiEvents] : [];
  const bypassCount = Math.max(0, Number(bypassAttempts) || 0);
  const pqcCountdown = auditCryptoAlgorithmsForPqc(cryptoAlgorithms, currentYear);
  const classicalCryptoCount = pqcCountdown.filter((item) => item.classicalPublicKeyVulnerable).length;

  const blockers = [];
  if (!custodianAssigned) blockers.push('missing_accountable_ai_custodian');
  if (shadowAiAgents.length > 0) blockers.push('unregistered_shadow_ai_detected');
  if (darkAiIncidents.length > 0) blockers.push('dark_ai_rogue_or_sandbox_escape_detected');
  if (bypassCount > 0) blockers.push('paperwork_only_governance_bypass_detected');

  return {
    compliant: blockers.length === 0,
    custodianAssigned,
    custodianOwner: custodianAssigned ? custodianOwner.trim() : null,
    shadowAiAgents,
    darkAiIncidents,
    bypassCount,
    paperworkOnlyRisk: bypassCount > 0,
    pqcCountdown,
    classicalCryptoMigrationRequired: classicalCryptoCount > 0,
    blockers,
  };
}

module.exports = {
  DEFAULT_PREFERENCES, loadPreferences, savePreferences, updatePreference,
  isOperationAllowed, governedDpoExport, enforceRetention, generateDataUsageSummary,
  getPreferencesPath, evaluateInferenceParadoxGuard, evaluateGartnerAgenticGovernanceRecord,
};
