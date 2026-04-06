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
function governedDpoExport(pairs) {
  const prefs = loadPreferences();
  if (!prefs.allowDpoExport) {
    return { allowed: false, pairs: [], blocked: pairs.length, reason: 'DPO export disabled by user preference', piiStats: null };
  }
  const gateResult = gateDpoExport(pairs, { maxSensitivity: prefs.maxExportSensitivity });
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
    piiStats: { blockedCount: gateResult.blockedCount, redactionEnabled: prefs.piiRedactionEnabled, maxSensitivity: prefs.maxExportSensitivity },
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
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf');
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

module.exports = {
  DEFAULT_PREFERENCES, loadPreferences, savePreferences, updatePreference,
  isOperationAllowed, governedDpoExport, enforceRetention, generateDataUsageSummary,
  getPreferencesPath,
};
