#!/usr/bin/env node
/**
 * ThumbGate (local-first)
 *
 * Pipeline:
 *   thumbs up/down -> resolve action -> validate memory -> append logs
 *   -> compute analytics -> generate prevention rules
 */

const fs = require('fs');
const path = require('path');
const {
  resolveFeedbackAction,
  prepareForStorage,
  parseTimestamp,
  GENERIC_TAGS,
} = require('./feedback-schema');
const {
  buildClarificationMessage,
  isGenericFeedbackText,
} = require('./feedback-quality');
const {
  buildRubricEvaluation,
} = require('./rubric-engine');
const { recordAction, attributeFeedback } = require('./feedback-attribution');
const {
  distillFeedbackHistory,
} = require('./feedback-history-distiller');
const {
  extractFilePaths: extractConversationPaths,
  extractErrors: extractConversationErrors,
  normalizeConversationWindow,
} = require('./conversation-context');
const {
  diagnoseFailure,
  aggregateFailureDiagnostics,
} = require('./failure-diagnostics');
const { getEffectiveSetting } = require('./evolution-state');
const { ensureDir } = require('./fs-utils');
const {
  buildFeedbackPathsFromDir,
  getFeedbackPaths: resolveFeedbackPaths,
} = require('./feedback-paths');

const AUDIT_TRAIL_TAG = 'audit-trail';

function isAuditTrailEntry(entry = {}) {
  return Array.isArray(entry.tags) && entry.tags.includes(AUDIT_TRAIL_TAG);
}

// Lesson DB — SQLite+FTS5 backing store (dual-write alongside JSONL)
let _lessonDB = null;
let _lessonDBPath = null;

function resolveLessonDbPath() {
  if (process.env.LESSON_DB_PATH) return process.env.LESSON_DB_PATH;
  if (process.env.THUMBGATE_FEEDBACK_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(getFeedbackPaths().FEEDBACK_DIR, 'lessons.sqlite');
  }
  return null;
}

function getLessonDB() {
  const desiredPath = resolveLessonDbPath();
  if (_lessonDB && _lessonDBPath === desiredPath) return _lessonDB;

  if (_lessonDB && _lessonDBPath !== desiredPath) {
    try {
      _lessonDB.close();
    } catch {
      // Non-critical; reopen on the new path below.
    }
    _lessonDB = null;
    _lessonDBPath = null;
  }

  try {
    const { initDB } = require('./lesson-db');
    _lessonDB = desiredPath ? initDB(desiredPath) : initDB();
    _lessonDBPath = desiredPath;
    return _lessonDB;
  } catch (_err) {
    // Keep the DB path scoped to the active feedback root even when SQLite
    // cannot open (for example, native module ABI drift in local dev).
    if (desiredPath) {
      try {
        fs.mkdirSync(path.dirname(desiredPath), { recursive: true });
        fs.closeSync(fs.openSync(desiredPath, 'a'));
        _lessonDBPath = desiredPath;
      } catch {
        // Ignore file materialization failures and degrade gracefully below.
      }
    }
    return null; // SQLite unavailable — degrade gracefully
  }
}

// ML sequence tracking constants (ML-03)
const SEQUENCE_WINDOW = 10;
const DOMAIN_CATEGORIES = [
  'testing', 'security', 'performance', 'ui-components', 'api-integration',
  'git-workflow', 'documentation', 'debugging', 'architecture', 'data-modeling',
  'behavioral',
];

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const pendingBackgroundSideEffects = new Set();

/**
 * Update the statusline cache with latest lesson info after feedback capture.
 * The statusline.sh script reads this cache to display lesson context in Claude Code's status bar.
 */
function updateStatuslineWithLesson({ accepted, signal, memoryId, feedbackId, lesson, turnCount }) {
  try {
    const cachePath = path.join(getFeedbackPaths().FEEDBACK_DIR, 'statusline_cache.json');
    let cache = {};
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch { /* cache may not exist yet */ }

    if (accepted) {
      const icon = signal === 'positive' ? '\u2705' : '\u274C';
      const summary = (lesson || '').slice(0, 80).replace(/\n/g, ' ');
      cache.last_lesson = {
        icon,
        memoryId: memoryId || null,
        feedbackId: feedbackId || null,
        signal: signal || null,
        summary,
        turnCount: turnCount || 0,
        timestamp: Math.floor(Date.now() / 1000),
      };
    } else {
      cache.last_lesson = {
        icon: '\u26A0\uFE0F',
        memoryId: null,
        feedbackId: feedbackId || null,
        signal: signal || null,
        summary: 'Feedback needs detail \u2014 describe what worked/failed',
        turnCount: 0,
        timestamp: Math.floor(Date.now() / 1000),
      };
    }
    cache.updated_at = String(Math.floor(Date.now() / 1000));
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    try {
      const { refreshStatuslineCache } = require('./hook-thumbgate-cache-updater');
      refreshStatuslineCache(analyzeFeedback(), cachePath);
    } catch {
      /* keep lesson refresh best-effort */
    }
  } catch { /* statusline update is best-effort */ }
}

function getFeedbackPaths(options = {}) {
  return resolveFeedbackPaths(options);
}

function getContextFsModule() {
  try {
    return require('./contextfs');
  } catch {
    return null;
  }
}

function getVectorStoreModule() {
  // Prefer filesystem search (no embeddings, no LanceDB binary dependency).
  // Falls back to vector-store.js if filesystem-search.js is missing.
  try {
    return require('./filesystem-search');
  } catch {
    try {
      return require('./vector-store');
    } catch {
      return null;
    }
  }
}

function getRiskScorerModule() {
  try {
    return require('./risk-scorer');
  } catch {
    return null;
  }
}

function getSelfAuditModule() {
  try {
    return require('./rlaif-self-audit');
  } catch (_) {
    return null;
  }
}

function getDelegationRuntimeModule() {
  try {
    return require('./delegation-runtime');
  } catch {
    return null;
  }
}

function getMemoryFirewallModule() {
  try {
    return require('./memory-firewall');
  } catch {
    return null;
  }
}


function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function normalizeAnalysisShape(analysis = {}) {
  const total = Number.isFinite(analysis.total) ? analysis.total : 0;
  const totalPositive = Number.isFinite(analysis.totalPositive)
    ? analysis.totalPositive
    : Number.isFinite(analysis.positive) ? analysis.positive : 0;
  const totalNegative = Number.isFinite(analysis.totalNegative)
    ? analysis.totalNegative
    : Number.isFinite(analysis.negative) ? analysis.negative : Math.max(0, total - totalPositive);
  const approvalRate = Number.isFinite(analysis.approvalRate)
    ? analysis.approvalRate
    : Number.isFinite(analysis.positiveRate)
      ? Number((analysis.positiveRate / 100).toFixed(3))
      : total > 0 ? Number((totalPositive / total).toFixed(3)) : 0;
  const recentRate = Number.isFinite(analysis.recentRate) ? analysis.recentRate : approvalRate;

  return {
    total,
    totalPositive,
    totalNegative,
    approvalRate,
    recentRate,
    windows: analysis.windows || {
      '7d': { total: 0, positive: 0, rate: 0 },
      '30d': { total: 0, positive: 0, rate: 0 },
      lifetime: { total, positive: totalPositive, rate: approvalRate },
    },
    trend: analysis.trend || 'stable',
    skills: analysis.skills || {},
    tags: analysis.tags || {},
    rubric: {
      samples: 0,
      blockedPromotions: 0,
      failingCriteria: {},
      ...(analysis.rubric || {}),
    },
    diagnostics: analysis.diagnostics || {
      totalDiagnosed: 0,
      categories: [],
      criticalFailureSteps: [],
      repeatedViolations: [],
    },
    delegation: analysis.delegation || null,
    boostedRisk: analysis.boostedRisk || null,
    recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
    actionableRemediations: Array.isArray(analysis.actionableRemediations) ? analysis.actionableRemediations : [],
    source: analysis.source,
    byDomain: Array.isArray(analysis.byDomain) ? analysis.byDomain : [],
    byImportance: Array.isArray(analysis.byImportance) ? analysis.byImportance : [],
    recentLessons: Array.isArray(analysis.recentLessons) ? analysis.recentLessons : [],
    sessionCount: Number.isFinite(analysis.sessionCount) ? analysis.sessionCount : 0,
  };
}

/**
 * Check if a memory from the same feedback event already exists (retry/race dedup).
 * Only blocks true duplicates (same sourceFeedbackId). Different feedback events
 * that produce identical content are allowed — they represent real repeated signal.
 */
function findDuplicateMemory(memoryLogPath, newRecord) {
  const feedbackId = newRecord.sourceFeedbackId;
  if (!feedbackId) return null;

  const existing = readJSONL(memoryLogPath, { maxLines: 0 });
  for (let i = existing.length - 1; i >= 0; i--) {
    if (existing[i].sourceFeedbackId === feedbackId) return existing[i];
  }
  return null;
}

function toStoredDiagnosis(diagnosis) {
  if (!diagnosis || diagnosis.diagnosed === false || !diagnosis.rootCauseCategory) {
    return null;
  }
  return {
    rootCauseCategory: diagnosis.rootCauseCategory,
    criticalFailureStep: diagnosis.criticalFailureStep,
    violations: Array.isArray(diagnosis.violations) ? diagnosis.violations : [],
    evidence: Array.isArray(diagnosis.evidence) ? diagnosis.evidence : [],
  };
}

function appendRejectionLedger(feedbackEvent, reason) {
  const { REJECTION_LEDGER_PATH } = getFeedbackPaths();
  appendJSONL(REJECTION_LEDGER_PATH, {
    id: feedbackEvent.id,
    signal: feedbackEvent.signal,
    context: feedbackEvent.context || '',
    reason,
    tags: feedbackEvent.tags || [],
    revivalCondition: feedbackEvent.signal === 'negative'
      ? 'Re-submit with whatWentWrong and whatToChange fields populated'
      : 'Re-submit with whatWorked field and at least one domain-specific tag',
    timestamp: feedbackEvent.timestamp || new Date().toISOString(),
  });
}

function listEnforcementMatrix() {
  const paths = getFeedbackPaths();
  const feedbackEntries = readJSONL(paths.FEEDBACK_LOG_PATH);
  const memoryEntries = readJSONL(paths.MEMORY_LOG_PATH);
  const rejections = readJSONL(paths.REJECTION_LEDGER_PATH);

  let autoGates = { gates: [], promotionLog: [] };
  try {
    const apg = require('./auto-promote-gates');
    autoGates = apg.loadAutoGates();
  } catch { /* auto-promote-gates not available */ }

  const totalFeedback = feedbackEntries.length;
  const promoted = memoryEntries.length;
  const rejected = rejections.length;

  const reasonCounts = {};
  for (const r of rejections) {
    const key = r.reason || 'unknown';
    reasonCounts[key] = (reasonCounts[key] || 0) + 1;
  }
  const topRejections = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    pipeline: {
      totalFeedback,
      promoted,
      rejected,
      promotionRate: totalFeedback > 0 ? Math.round((promoted / totalFeedback) * 100) : 0,
    },
    gates: {
      active: autoGates.gates.length,
      blocking: autoGates.gates.filter((g) => g.action === 'block').length,
      warning: autoGates.gates.filter((g) => g.action === 'warn').length,
      rules: autoGates.gates.map((g) => ({
        id: g.id, action: g.action, pattern: g.pattern,
        occurrences: g.occurrences, promotedAt: g.promotedAt,
      })),
    },
    rejectionLedger: {
      total: rejected,
      topReasons: topRejections,
      recentRejections: rejections.slice(-5).reverse(),
    },
  };
}

function appendDiagnosticRecord(params = {}) {
  const { DIAGNOSTIC_LOG_PATH } = getFeedbackPaths();
  const storedDiagnosis = toStoredDiagnosis(params.diagnosis);
  if (!storedDiagnosis) {
    return null;
  }

  const record = {
    id: `diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: params.source || 'system',
    step: params.step || storedDiagnosis.criticalFailureStep || null,
    context: params.context || '',
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
    diagnosis: storedDiagnosis,
    timestamp: params.timestamp || new Date().toISOString(),
  };
  appendJSONL(DIAGNOSTIC_LOG_PATH, record);
  try {
    const { trainAndPersistInterventionPolicy } = require('./intervention-policy');
    trainAndPersistInterventionPolicy(getFeedbackPaths().FEEDBACK_DIR);
  } catch { /* non-critical */ }
  return record;
}

function buildMemoryFirewallViolations(decision = {}) {
  const findingViolations = Array.isArray(decision.findings)
    ? decision.findings.map((finding) => ({
        constraintId: `security:${finding.id || 'credential_leak'}`,
        description: finding.reason || finding.label || 'Blocked by memory-ingress firewall',
        metadata: {
          label: finding.label || finding.id || null,
          line: finding.line || null,
          source: finding.source || null,
        },
      }))
    : [];

  if (findingViolations.length > 0) {
    return findingViolations;
  }

  return (decision.threatIndicators || []).map((indicator) => ({
    constraintId: `security:${indicator}`,
    description: `Blocked by memory-ingress firewall (${indicator})`,
    metadata: {
      provider: decision.provider || null,
      mode: decision.mode || null,
    },
  }));
}

function maybeBlockMemoryIngress({ feedbackEvent, memoryRecord = null, summary, now }) {
  const memoryFirewall = getMemoryFirewallModule();
  if (!memoryFirewall || typeof memoryFirewall.evaluateMemoryIngress !== 'function') {
    return null;
  }

  const decision = memoryFirewall.evaluateMemoryIngress({
    feedbackEvent,
    memoryRecord,
    sourceIdentifier: 'feedback-loop',
  });

  if (!decision || decision.allowed) {
    return null;
  }

  appendDiagnosticRecord({
    source: 'memory_firewall',
    step: 'memory_ingress',
    context: decision.redactedPreview || '',
    metadata: {
      provider: decision.provider || 'unknown',
      mode: decision.mode || null,
      degraded: Boolean(decision.degraded),
      firewallResult: decision.firewallResult || null,
      blockedPatterns: Array.isArray(decision.blockedPatterns) ? decision.blockedPatterns : [],
      requestedProvider: decision.requestedProvider || null,
    },
    diagnosis: {
      diagnosed: true,
      rootCauseCategory: 'guardrail_triggered',
      criticalFailureStep: 'memory_ingress',
      violations: buildMemoryFirewallViolations(decision),
      evidence: [
        decision.reason || 'Memory ingress blocked',
        ...(decision.threatIndicators || []),
      ].filter(Boolean),
    },
  });

  summary.rejected += 1;
  summary.lastUpdated = now;
  saveSummary(summary);

  return {
    accepted: false,
    status: 'blocked',
    reason: decision.reason,
    message: 'Feedback blocked by memory-ingress security checks.',
    feedbackEvent,
    security: {
      provider: decision.provider || 'unknown',
      mode: decision.mode || null,
      threatIndicators: decision.threatIndicators || [],
      degraded: Boolean(decision.degraded),
    },
  };
}

function readDiagnosticEntries(logPath) {
  const { DIAGNOSTIC_LOG_PATH } = getFeedbackPaths();
  return readJSONL(logPath || DIAGNOSTIC_LOG_PATH);
}

function trackBackgroundSideEffect(taskPromise) {
  if (!taskPromise || typeof taskPromise.then !== 'function') {
    return null;
  }

  let tracked;
  tracked = Promise.resolve(taskPromise)
    .catch(() => {
      // Non-critical side effects should never fail the primary feedback write.
    })
    .finally(() => {
      pendingBackgroundSideEffects.delete(tracked);
    });

  pendingBackgroundSideEffects.add(tracked);
  return tracked;
}

async function waitForBackgroundSideEffects() {
  while (pendingBackgroundSideEffects.size > 0) {
    await Promise.allSettled([...pendingBackgroundSideEffects]);
  }
}

function getPendingBackgroundSideEffectCount() {
  return pendingBackgroundSideEffects.size;
}

function readJSONL(filePath, { maxLines = 500 } = {}) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const tail = maxLines > 0 ? lines.slice(-maxLines) : lines;
  const results = [];
  for (const line of tail) {
    try { results.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return results;
}

function normalizeSignal(signal) {
  const value = String(signal || '').trim().toLowerCase();
  if (['up', 'thumbsup', 'thumbs-up', 'positive', 'good'].includes(value)) return 'positive';
  if (['down', 'thumbsdown', 'thumbs-down', 'negative', 'bad'].includes(value)) return 'negative';
  if (value === 'thumbs_up') return 'positive';
  if (value === 'thumbs_down') return 'negative';
  return null;
}

function parseOptionalObject(input, name) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be an object`);
    }
    return parsed;
  }
  throw new Error(`${name} must be object or JSON string`);
}

function loadSummary() {
  const { SUMMARY_PATH } = getFeedbackPaths();
  if (!fs.existsSync(SUMMARY_PATH)) {
    return {
      total: 0,
      positive: 0,
      negative: 0,
      accepted: 0,
      rejected: 0,
      lastUpdated: null,
    };
  }
  return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf-8'));
}

function saveSummary(summary) {
  const { SUMMARY_PATH } = getFeedbackPaths();
  ensureDir(path.dirname(SUMMARY_PATH));
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

// ============================================================
// ML Side-Effect Helpers — Sequence Tracking (ML-03) and
// Diversity Tracking (ML-04). Inline per Subway architecture.
// ============================================================

function inferDomain(tags, context) {
  const tagSet = new Set((tags || []).map((t) => t.toLowerCase()));
  const ctx = (context || '').toLowerCase();
  if (tagSet.has('test') || tagSet.has('testing') || ctx.includes('test')) return 'testing';
  if (tagSet.has('security') || ctx.includes('secret')) return 'security';
  if (tagSet.has('perf') || tagSet.has('performance') || ctx.includes('performance')) return 'performance';
  if (tagSet.has('ui') || tagSet.has('component') || ctx.includes('component')) return 'ui-components';
  if (tagSet.has('api') || tagSet.has('endpoint') || ctx.includes('endpoint')) return 'api-integration';
  if (tagSet.has('git') || tagSet.has('commit') || ctx.includes('commit')) return 'git-workflow';
  if (tagSet.has('doc') || tagSet.has('readme') || ctx.includes('readme')) return 'documentation';
  if (tagSet.has('debug') || tagSet.has('debugging') || ctx.includes('error')) return 'debugging';
  if (tagSet.has('arch') || tagSet.has('architecture') || ctx.includes('design')) return 'architecture';
  if (tagSet.has('data') || tagSet.has('schema') || ctx.includes('schema')) return 'data-modeling';
  return 'general';
}

/**
 * Infer granular outcome category from signal + context.
 * Satisfies QUAL-03 — beyond binary up/down.
 * @param {string} signal - 'positive' or 'negative'
 * @param {string} context - feedback context string
 * @returns {string} granular outcome category
 */
function inferOutcome(signal, context) {
  const cl = (context || '').toLowerCase();
  if (signal === 'positive') {
    if (cl.includes('first try') || cl.includes('immediately') || cl.includes('right away')) return 'quick-success';
    if (cl.includes('thorough') || cl.includes('comprehensive') || cl.includes('in-depth')) return 'deep-success';
    if (cl.includes('creative') || cl.includes('novel') || cl.includes('elegant')) return 'creative-success';
    if (cl.includes('partial') || cl.includes('mostly') || cl.includes('some issues')) return 'partial-success';
    return 'standard-success';
  } else {
    if (cl.includes('wrong') || cl.includes('incorrect') || cl.includes('factual')) return 'factual-error';
    if (cl.includes('shallow') || cl.includes('surface') || cl.includes('superficial')) return 'insufficient-depth';
    if (cl.includes('slow') || cl.includes('took too long') || cl.includes('inefficient')) return 'efficiency-issue';
    if (cl.includes('assumption') || cl.includes('guessed') || cl.includes('assumed')) return 'false-assumption';
    if (cl.includes('partial') || cl.includes('incomplete') || cl.includes('missing')) return 'incomplete';
    return 'standard-failure';
  }
}

/**
 * Enrich feedbackEvent with richContext metadata.
 * Satisfies QUAL-02 — domain, filePaths, errorType, outcomeCategory.
 * Non-throwing: returns original event on any error.
 * @param {object} feedbackEvent - base feedback event
 * @param {object} params - original captureFeedback params
 * @returns {object} enriched feedbackEvent
 */
function enrichFeedbackContext(feedbackEvent, params) {
  try {
    const domain = inferDomain(feedbackEvent.tags, feedbackEvent.context);
    const outcomeCategory = inferOutcome(feedbackEvent.signal, feedbackEvent.context);
    const filePaths = Array.isArray(params.filePaths)
      ? params.filePaths
      : typeof params.filePaths === 'string' && params.filePaths.trim()
        ? params.filePaths.split(',').map((f) => f.trim()).filter(Boolean)
        : [];
    const errorType = params.errorType || null;
    const protectedFiles = filePaths.filter((filePath) => /(^|\/)(agents\.md|claude(\.local)?\.md|gemini\.md|readme\.md|\.gitignore|skill\.md)$|^\.husky\/|^config\/gates\//i.test(filePath));
    const combinedText = [
      feedbackEvent.context || '',
      feedbackEvent.whatWentWrong || '',
      feedbackEvent.whatToChange || '',
      ...(Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags : []),
    ].join(' ').toLowerCase();
    const includesPhrase = (phrase) => combinedText.includes(phrase);
    const includesOrderedTerms = (firstTerm, secondTerm) => {
      const firstIndex = combinedText.indexOf(firstTerm);
      if (firstIndex === -1) return false;
      return combinedText.indexOf(secondTerm, firstIndex + firstTerm.length) !== -1;
    };
    const enforcement = {
      scopeViolation: includesPhrase('scope creep')
        || includesPhrase('out of scope')
        || includesOrderedTerms('outside', 'scope')
        || includesPhrase('wrong files')
        || includesPhrase('unrelated files'),
      approvalFailure: includesPhrase('without approval')
        || includesPhrase('missing approval')
        || includesPhrase('approval required')
        || includesPhrase('permission required'),
      protectedFileViolation: protectedFiles.length > 0
        || includesPhrase('protected file')
        || includesPhrase('policy file')
        || includesPhrase('hook file'),
      protectedFiles,
    };

    return {
      ...feedbackEvent,
      richContext: {
        domain,
        filePaths,
        errorType,
        outcomeCategory,
        enforcement,
      },
    };
  } catch (_err) {
    return feedbackEvent;
  }
}

function calculateTrend(rewards) {
  if (rewards.length < 2) return 0;
  const recent = rewards.slice(-3);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function calculateTimeGaps(sequence) {
  const gaps = [];
  for (let i = 1; i < sequence.length; i++) {
    const prev = parseTimestamp(sequence[i - 1].timestamp);
    const curr = parseTimestamp(sequence[i].timestamp);
    if (prev && curr) {
      gaps.push((curr - prev) / 1000 / 60); // minutes
    }
  }
  return gaps;
}

function extractActionPatterns(sequence) {
  const patterns = {};
  sequence.forEach((f) => {
    (f.tags || []).forEach((tag) => {
      if (!patterns[tag]) patterns[tag] = { positive: 0, negative: 0 };
      if (f.signal === 'positive') patterns[tag].positive++;
      else patterns[tag].negative++;
    });
  });
  return patterns;
}

function buildSequenceFeatures(recentEntries, currentEntry) {
  const sequence = [...recentEntries, currentEntry];
  return {
    rewardSequence: sequence.map((f) => (f.signal === 'positive' ? 1 : -1)),
    tagFrequency: sequence.reduce((acc, f) => {
      (f.tags || []).forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {}),
    recentTrend: calculateTrend(sequence.slice(-5).map((f) => (f.signal === 'positive' ? 1 : -1))),
    timeGaps: calculateTimeGaps(sequence),
    actionPatterns: extractActionPatterns(sequence),
  };
}

function appendSequence(historyEntries, feedbackEvent, paths, outcome = {}) {
  const sequencePath = path.join(paths.FEEDBACK_DIR, 'feedback-sequences.jsonl');
  const recent = Array.isArray(historyEntries) ? historyEntries.slice(-SEQUENCE_WINDOW) : [];
  const features = buildSequenceFeatures(recent, feedbackEvent);
  const rubric = feedbackEvent.rubric || null;
  const filePaths = feedbackEvent.richContext && Array.isArray(feedbackEvent.richContext.filePaths)
    ? feedbackEvent.richContext.filePaths
    : [];
  const accepted = outcome.accepted === true;
  const targetRisk = feedbackEvent.signal === 'negative' || !accepted ? 1 : 0;
  const entry = {
    id: `seq_${Date.now()}`,
    timestamp: new Date().toISOString(),
    targetReward: feedbackEvent.signal === 'positive' ? 1 : -1,
    targetTags: feedbackEvent.tags,
    accepted,
    actionType: feedbackEvent.actionType || null,
    actionReason: feedbackEvent.actionReason || null,
    context: feedbackEvent.context || '',
    skill: feedbackEvent.skill || null,
    domain: feedbackEvent.richContext ? feedbackEvent.richContext.domain : 'general',
    outcomeCategory: feedbackEvent.richContext ? feedbackEvent.richContext.outcomeCategory : 'unknown',
    filePathCount: filePaths.length,
    errorType: feedbackEvent.richContext ? feedbackEvent.richContext.errorType : null,
    rubric: rubric
      ? {
        rubricId: rubric.rubricId || null,
        weightedScore: rubric.weightedScore,
        failingCriteria: rubric.failingCriteria || [],
        failingGuardrails: rubric.failingGuardrails || [],
        judgeDisagreements: rubric.judgeDisagreements || [],
      }
      : null,
    targetRisk,
    riskLabel: targetRisk === 1 ? 'high-risk' : 'low-risk',
    features,
    label: feedbackEvent.signal === 'positive' ? 'positive' : 'negative',
  };
  appendJSONL(sequencePath, entry);
}

function updateDiversityTracking(feedbackEvent, paths) {
  const diversityPath = path.join(paths.FEEDBACK_DIR, 'diversity-tracking.json');
  let diversity = { domains: {}, lastUpdated: null, diversityScore: 0 };
  if (fs.existsSync(diversityPath)) {
    try {
      diversity = JSON.parse(fs.readFileSync(diversityPath, 'utf-8'));
    } catch {
      // start fresh on parse error
    }
  }

  const domain = inferDomain(feedbackEvent.tags, feedbackEvent.context);
  if (!diversity.domains[domain]) {
    diversity.domains[domain] = { count: 0, positive: 0, negative: 0, lastSeen: null };
  }

  diversity.domains[domain].count++;
  diversity.domains[domain].lastSeen = feedbackEvent.timestamp;
  if (feedbackEvent.signal === 'positive') diversity.domains[domain].positive++;
  else diversity.domains[domain].negative++;

  const totalFeedback = Object.values(diversity.domains).reduce((s, d) => s + d.count, 0);
  const domainCount = Object.keys(diversity.domains).length;
  const idealPerDomain = totalFeedback / DOMAIN_CATEGORIES.length;
  const variance = Object.values(diversity.domains).reduce((s, d) => {
    return s + Math.pow(d.count - idealPerDomain, 2);
  }, 0) / Math.max(domainCount, 1);

  diversity.diversityScore = Math.max(0, 100 - Math.sqrt(variance) * 10).toFixed(1);
  diversity.lastUpdated = new Date().toISOString();
  diversity.recommendation = Number(diversity.diversityScore) < 50
    ? `Low diversity (${diversity.diversityScore}%). Try feedback in: ${DOMAIN_CATEGORIES.filter((d) => !diversity.domains[d]).join(', ')}`
    : `Good diversity (${diversity.diversityScore}%)`;

  fs.writeFileSync(diversityPath, JSON.stringify(diversity, null, 2) + '\n');
}

function extractAndSetConstraints(context) {
  if (!context) return;
  try {
    const { setConstraint } = require('./gates-engine');
    const lower = context.toLowerCase();

    // Extraction heuristics
    if (lower.includes('local only') || lower.includes('not in git') || lower.includes("don't push") || lower.includes("no push")) {
      setConstraint('local_only', true);
    }
  } catch (err) {
    // Non-critical if gates engine not loaded
  }
}

function inferSemanticTags(context = '') {
  const lower = context.toLowerCase();
  const tags = new Set();
  
  if (lower.includes('revenue') || lower.includes('paid') || lower.includes('dollar') || lower.includes('cent') || lower.includes('price')) {
    tags.add('entity:Revenue');
  }
  if (lower.includes('customer') || lower.includes('user') || lower.includes('pro') || lower.includes('tier')) {
    tags.add('entity:Customer');
  }
  if (lower.includes('funnel') || lower.includes('conversion') || lower.includes('visitor') || lower.includes('checkout') || lower.includes('lead')) {
    tags.add('entity:Funnel');
  }
  if (lower.includes('roi') || lower.includes('campaign') || lower.includes('attribution')) {
    tags.add('metric:ROI');
  }

  return Array.from(tags);
}

function inferLessonFromConversation(conversationWindow, signal) {
  const normalizedWindow = normalizeConversationWindow(conversationWindow);
  if (normalizedWindow.length === 0) return null;

  const userMessages = normalizedWindow.filter(m => m.role === 'user');
  const assistantMessages = normalizedWindow.filter(m => m.role === 'assistant');

  const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
  const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]?.content || '';

  const userIntent = lastUserMsg.slice(0, 200);
  const assistantAction = lastAssistantMsg.slice(0, 200);

  const lesson = signal === 'negative'
    ? `User asked: "${userIntent}" → Assistant did: "${assistantAction}" → User rejected this`
    : `User asked: "${userIntent}" → Assistant did: "${assistantAction}" → User approved this`;

  const filePaths = extractConversationPaths(normalizedWindow);
  const errorPatterns = extractConversationErrors(normalizedWindow);

  const tags = [];
  if (filePaths.length > 0) tags.push('has-file-context');
  if (errorPatterns.length > 0) tags.push('has-error-context');
  if (filePaths.some((filePath) => /(^|\/)(agents\.md|claude(\.local)?\.md|gemini\.md|readme\.md|\.gitignore|skill\.md)$|^\.husky\/|^config\/gates\//i.test(filePath))) {
    tags.push('protected-file-context');
  }

  return {
    lesson,
    whatWentWrong: signal === 'negative' ? `Assistant response to "${userIntent.slice(0, 60)}..." was rejected` : null,
    whatWorked: signal === 'positive' ? `Assistant response to "${userIntent.slice(0, 60)}..." was approved` : null,
    tags,
    filePaths,
    errorPatterns,
    messageCount: normalizedWindow.length,
  };
}

function captureFeedback(params) {
  const _captureStart = Date.now();
  const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH, FEEDBACK_DIR } = getFeedbackPaths();
  const signal = normalizeSignal(params.signal);
  if (!signal) {
    return {
      accepted: false,
      reason: `Invalid signal "${params.signal}". Use up/down or positive/negative.`,
    };
  }

  const submittedContext = params.context || '';
  const distillation = distillFeedbackHistory({
    signal,
    context: submittedContext,
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    whatWorked: params.whatWorked,
    relatedFeedbackId: params.relatedFeedbackId,
    chatHistory: params.chatHistory || params.messages,
    allowLocalConversationFallback: params.allowLocalConversationFallback === true,
    lastAction: params.lastAction,
    feedbackDir: FEEDBACK_DIR,
  });

  const shouldUseDistilledContext = !submittedContext || isGenericFeedbackText(submittedContext, signal);
  const context = shouldUseDistilledContext && distillation.inferredFields.context
    ? distillation.inferredFields.context
    : submittedContext;
  const whatWentWrong = params.whatWentWrong || distillation.inferredFields.whatWentWrong || null;
  const whatToChange = params.whatToChange || distillation.inferredFields.whatToChange || null;
  const whatWorked = params.whatWorked || distillation.inferredFields.whatWorked || null;
  extractAndSetConstraints(context);

  const providedTags = Array.isArray(params.tags)
    ? params.tags
    : String(params.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

  const semanticTags = inferSemanticTags(context);
  const tags = Array.from(new Set([...providedTags, ...semanticTags]));

  // Infer lesson from conversation window if provided
  let inferredContext = context;
  if (Array.isArray(params.conversationWindow) && params.conversationWindow.length > 0) {
    const windowSummary = inferLessonFromConversation(params.conversationWindow, signal);
    if (windowSummary) {
      inferredContext = windowSummary.lesson;
      if (windowSummary.tags) {
        tags.push(...windowSummary.tags.filter(t => !tags.includes(t)));
      }
      if (!params.whatWentWrong && windowSummary.whatWentWrong) {
        params.whatWentWrong = windowSummary.whatWentWrong;
      }
      if (!params.whatWorked && windowSummary.whatWorked) {
        params.whatWorked = windowSummary.whatWorked;
      }
    }
  }

  // Infer structured IF/THEN rule from conversation
  let structuredRule = null;
  if (Array.isArray(params.conversationWindow) && params.conversationWindow.length >= 2) {
    try {
      const { inferStructuredLesson } = require('./lesson-inference');
      structuredRule = inferStructuredLesson(params.conversationWindow, signal, inferredContext);
    } catch (_err) { /* non-critical */ }
  }

  // Reflector agent: auto-propose rules on negative feedback
  let reflection = null;
  if (signal === 'negative' && Array.isArray(params.conversationWindow) && params.conversationWindow.length >= 2) {
    try {
      const { reflect } = require('./reflector-agent');
      reflection = reflect({
        conversationWindow: params.conversationWindow,
        context: inferredContext,
        whatWentWrong: params.whatWentWrong,
        structuredRule,
        feedbackEvent: null, // not yet constructed
      });
    } catch (_err) { /* non-critical */ }
  }

  let rubricEvaluation = null;
  try {
    if (params.rubricScores != null || params.guardrails != null) {
      rubricEvaluation = buildRubricEvaluation({
        rubricScores: params.rubricScores,
        guardrails: parseOptionalObject(params.guardrails, 'guardrails'),
      });
    }
  } catch (err) {
    return {
      accepted: false,
      reason: `Invalid rubric payload: ${err.message}`,
    };
  }

  const action = resolveFeedbackAction({
    signal,
    context,
    whatWentWrong,
    whatToChange,
    whatWorked,
    reasoning: params.reasoning,
    visualEvidence: params.visualEvidence,
    tags,
    rubricEvaluation,
  });

  // Tool-call attribution: link feedback to specific action (#203)
  const lastAction = params.lastAction
    ? {
      tool: params.lastAction.tool || 'unknown',
      contextKey: params.lastAction.contextKey || null,
      file: params.lastAction.file || null,
      timestamp: params.lastAction.timestamp || null,
    }
    : null;

  const now = new Date().toISOString();
  const rawFeedbackEvent = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    signal,
    context,
    submittedContext,
    relatedFeedbackId: params.relatedFeedbackId || null,
    lastAction,
    whatWentWrong,
    whatToChange,
    whatWorked,
    reasoning: params.reasoning || null,
    visualEvidence: params.visualEvidence || null,
    conversationWindow: Array.isArray(distillation.conversationWindow) && distillation.conversationWindow.length > 0 ? distillation.conversationWindow : null,
    distillation: distillation.usedHistory
      ? {
        source: distillation.source,
        relatedFeedbackId: distillation.relatedFeedbackId,
        evidence: distillation.evidence,
        lessonProposal: distillation.lessonProposal,
      }
      : null,
    tags,
    skill: params.skill || null,
    failureType: params.failureType || null,
    rubric: rubricEvaluation
      ? {
        rubricId: rubricEvaluation.rubricId,
        weightedScore: rubricEvaluation.weightedScore,
        failingCriteria: rubricEvaluation.failingCriteria,
        failingGuardrails: rubricEvaluation.failingGuardrails,
        judgeDisagreements: rubricEvaluation.judgeDisagreements,
        promotionEligible: rubricEvaluation.promotionEligible,
      }
      : null,
    actionType: action.type,
    actionReason: action.reason || null,
    conversationWindow: Array.isArray(params.conversationWindow) && params.conversationWindow.length > 0
      ? params.conversationWindow.slice(-10).map(m => ({
        role: m.role,
        content: (m.content || '').slice(0, 500),
        timestamp: m.timestamp || null,
      }))
      : (Array.isArray(distillation.conversationWindow) && distillation.conversationWindow.length > 0
        ? distillation.conversationWindow
        : null),
    structuredRule: structuredRule || null,
    ...(reflection && { reflection }),
    timestamp: now,
  };

  // Rich context enrichment (QUAL-02, QUAL-03) — non-blocking
  let feedbackEvent = enrichFeedbackContext(rawFeedbackEvent, params);
  const shouldDiagnose = signal === 'negative'
    || (rubricEvaluation && (
      (rubricEvaluation.failingCriteria || []).length > 0
      || (rubricEvaluation.failingGuardrails || []).length > 0
    ))
    || (typeof rawFeedbackEvent.actionReason === 'string' && /rubric gate/i.test(rawFeedbackEvent.actionReason));
  const diagnosis = shouldDiagnose
    ? diagnoseFailure({
      step: 'feedback_capture',
      context,
      rubricEvaluation,
      feedbackEvent,
      suspect: signal === 'negative' || action.type === 'no-action',
    })
    : null;
  const storedDiagnosis = toStoredDiagnosis(diagnosis);
  if (storedDiagnosis) {
    feedbackEvent = {
      ...feedbackEvent,
      diagnosis: storedDiagnosis,
    };
  }
  const historyEntries = readJSONL(FEEDBACK_LOG_PATH).slice(-SEQUENCE_WINDOW);

  const summary = loadSummary();
  // Only count real user feedback in the summary, not audit-trail gate events
  const isAuditEntry = Array.isArray(tags) && tags.includes(AUDIT_TRAIL_TAG);
  if (!isAuditEntry) {
    summary.total += 1;
    summary[signal] += 1;
  }

  if (action.type === 'no-action') {
    const firewallBlocked = maybeBlockMemoryIngress({ feedbackEvent, summary, now });
    if (firewallBlocked) {
      return firewallBlocked;
    }
    const clarification = buildClarificationMessage({
      signal,
      context,
      whatWentWrong,
      whatToChange,
      whatWorked,
    });
    summary.rejected += 1;
    summary.lastUpdated = now;
    saveSummary(summary);
    appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);
    try { appendRejectionLedger(feedbackEvent, action.reason); } catch { /* non-critical */ }
    try {
      appendSequence(historyEntries, feedbackEvent, getFeedbackPaths(), { accepted: false });
    } catch { /* non-critical */ }
    try {
      const riskScorer = getRiskScorerModule();
      if (riskScorer) riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
    } catch { /* non-critical */ }
    try {
      const { trainAndPersistInterventionPolicy } = require('./intervention-policy');
      trainAndPersistInterventionPolicy(FEEDBACK_DIR);
    } catch { /* non-critical */ }
    updateStatuslineWithLesson({
      accepted: false,
      signal,
      feedbackId: feedbackEvent.id,
    });
    return {
      accepted: false,
      signalLogged: true,
      status: clarification ? 'clarification_required' : 'rejected',
      reason: action.reason,
      message: clarification ? clarification.message : 'Signal logged, but reusable memory was not created.',
      feedbackEvent,
      ...(clarification || {}),
    };
  }

  const prepared = prepareForStorage(action.memory);
  if (!prepared.ok) {
    const firewallBlocked = maybeBlockMemoryIngress({ feedbackEvent, summary, now });
    if (firewallBlocked) {
      return firewallBlocked;
    }
    summary.rejected += 1;
    summary.lastUpdated = now;
    saveSummary(summary);
    appendJSONL(FEEDBACK_LOG_PATH, {
      ...feedbackEvent,
      validationIssues: prepared.issues,
    });
    try { appendRejectionLedger(feedbackEvent, `Schema validation failed: ${prepared.issues.join('; ')}`); } catch { /* non-critical */ }
    try {
      appendSequence(historyEntries, feedbackEvent, getFeedbackPaths(), { accepted: false });
    } catch { /* non-critical */ }
    try {
      const riskScorer = getRiskScorerModule();
      if (riskScorer) riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
    } catch { /* non-critical */ }
    try {
      const { trainAndPersistInterventionPolicy } = require('./intervention-policy');
      trainAndPersistInterventionPolicy(FEEDBACK_DIR);
    } catch { /* non-critical */ }
    return {
      accepted: false,
      signalLogged: true,
      status: 'rejected',
      reason: `Schema validation failed: ${prepared.issues.join('; ')}`,
      message: 'Signal logged, but reusable memory was not created.',
      feedbackEvent,
      issues: prepared.issues,
    };
  }

  const memoryRecord = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...prepared.memory,
    richContext: feedbackEvent.richContext || null,
    distillation: feedbackEvent.distillation || null,
    diagnosis: storedDiagnosis,
    structuredRule: structuredRule || null,
    sourceFeedbackId: feedbackEvent.id,
    timestamp: now,
  };

  // Stamp a cross-session canonical hash on every memory record so future
  // captures can short-circuit dedup without re-canonicalizing legacy entries.
  // See scripts/lesson-canonical.js for the normalization contract.
  try {
    const { canonicalHash } = require('./lesson-canonical');
    const hash = canonicalHash(memoryRecord);
    if (hash) memoryRecord.canonicalHash = hash;
  } catch (_canonErr) { /* canonical hashing is non-blocking */ }

  // Bayesian Belief Update (Project Bayes)
  try {
    const { updateBelief, shouldPrune } = require('./belief-update');
    const existingMemories = readJSONL(MEMORY_LOG_PATH);
    const similarMemory = existingMemories.slice().reverse().find(m => 
      m.tags && m.tags.some(t => memoryRecord.tags.includes(t) && !GENERIC_TAGS.has(t))
    );

    if (similarMemory && similarMemory.bayesian) {
      const likelihood = signal === 'positive' ? 0.9 : 0.1;
      memoryRecord.bayesian = updateBelief(similarMemory.bayesian, likelihood);
      memoryRecord.revisedFromId = similarMemory.id;
      
      if (shouldPrune(memoryRecord.bayesian)) {
        memoryRecord.pruned = true;
        memoryRecord.pruneReason = 'high_entropy_contradiction';
      }
    }
  } catch (_err) { /* bayesian update is non-blocking */ }

  const firewallBlocked = maybeBlockMemoryIngress({
    feedbackEvent,
    memoryRecord,
    summary,
    now,
  });
  if (firewallBlocked) {
    return firewallBlocked;
  }

  appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);

  // Synthesis: merge similar lessons instead of creating duplicates
  let synthesisResult = null;
  try {
    const { findSimilarLesson, mergeIntoExisting, shouldAutoPromote, synthesizePreventionRule, appendJSONLLocal } = require('./lesson-synthesis');
    const similar = findSimilarLesson(MEMORY_LOG_PATH, memoryRecord);

    if (similar) {
      // Merge into existing lesson
      const merged = mergeIntoExisting(MEMORY_LOG_PATH, similar.match, memoryRecord, feedbackEvent);
      synthesisResult = { action: 'merged', existingId: similar.match.id, similarity: similar.similarity, occurrences: merged.occurrences };

      // Auto-promote if threshold reached, but only after the rule
      // validator (scripts/rule-validator.js) confirms the proposed trigger
      // matches the seed lesson and has acceptable precision on recent
      // overlapping-tag events. This plugs the Autogenesis "validate
      // before integrate" phase that was missing from the original
      // promotion path — previously every threshold-crossing lesson
      // shipped a rule regardless of whether it would over-block positives.
      if (shouldAutoPromote(merged)) {
        const rule = synthesizePreventionRule(merged);
        let validation = null;
        try {
          const { validateProposedRule } = require('./rule-validator');
          // Sample the last 50 memory events across both signals. Using
          // memory-log rather than feedback-log because memory records
          // carry the richer title/content fields the validator scores
          // against, and findSimilarLesson already reads this file.
          const recentEvents = readJSONL(MEMORY_LOG_PATH).slice(-50);
          validation = validateProposedRule(rule, {
            seedLesson: merged,
            recentEvents,
          });
          rule.validation = validation;
        } catch (_valErr) {
          // Validator failure must not block the existing pipeline; fall
          // back to the legacy "promote unconditionally" behavior.
          validation = { shouldPromote: true, reason: 'validator_error', error: _valErr.message };
          rule.validation = validation;
        }

        synthesisResult.preventionRule = rule;
        synthesisResult.validation = validation;
        if (validation.shouldPromote) {
          synthesisResult.autoPromoted = true;
          // Store the synthesized rule
          const rulesPath = path.join(path.dirname(MEMORY_LOG_PATH), 'synthesized-rules.jsonl');
          appendJSONLLocal(rulesPath, rule);
        } else {
          // Park rejected rules in a side log so operators can audit them.
          synthesisResult.autoPromoted = false;
          synthesisResult.rejectionReason = validation.reason;
          const rejectedPath = path.join(path.dirname(MEMORY_LOG_PATH), 'rejected-rules.jsonl');
          appendJSONLLocal(rejectedPath, rule);
        }
      }
    } else {
      // No similar lesson — check exact duplicate, then store
      const duplicateMemory = findDuplicateMemory(MEMORY_LOG_PATH, memoryRecord);
      if (!duplicateMemory) {
        memoryRecord.occurrences = 1;
        appendJSONL(MEMORY_LOG_PATH, memoryRecord);
      }
      synthesisResult = { action: duplicateMemory ? 'exact-duplicate-skipped' : 'new-lesson' };
    }
  } catch (_synthErr) {
    // Fallback to original behavior
    const duplicateMemory = findDuplicateMemory(MEMORY_LOG_PATH, memoryRecord);
    if (!duplicateMemory) {
      appendJSONL(MEMORY_LOG_PATH, memoryRecord);
    }
    synthesisResult = { action: 'fallback', error: _synthErr.message };
  }

  // Dual-write to SQLite lesson DB — deferred to avoid blocking response
  let correctiveActions = [];
  try {
    const lessonDB = getLessonDB();
    if (lessonDB) {
      const { upsertLesson, inferCorrectiveActions } = require('./lesson-db');
      upsertLesson(lessonDB, feedbackEvent, memoryRecord);
      if (feedbackEvent.signal === 'negative') {
        correctiveActions = inferCorrectiveActions(lessonDB, feedbackEvent, 3);
      }
    }
  } catch (_err) {
    // Lesson DB write is non-critical — never fail the capture pipeline
  }

  summary.accepted += 1;
  summary.lastUpdated = now;
  saveSummary(summary);

  const _captureMs = Date.now() - _captureStart;

  // Auto-open feedback session for follow-up capture
  let feedbackSession = null;
  try {
    const { openSession } = require('./feedback-session');
    feedbackSession = openSession(feedbackEvent.id, signal, inferredContext);
  } catch (_err) { /* non-critical */ }

  const correctiveActionsReminder = buildCorrectiveActionsReminder(correctiveActions);

  // Build result immediately — all remaining side-effects are deferred
  const result = {
    accepted: true,
    status: 'promoted',
    message: 'Feedback promoted to reusable memory.',
    feedbackEvent,
    memoryRecord,
    _captureMs,
    ...(correctiveActions.length > 0 && { correctiveActions }),
    ...(correctiveActionsReminder && {
      systemReminder: correctiveActionsReminder,
      thumbgateSystemReminder: correctiveActionsReminder,
    }),
    ...(reflection && { reflection }),
    ...(feedbackSession && { feedbackSession }),
    ...(synthesisResult && { synthesis: synthesisResult }),
  };

  // Update statusline with lesson info (include proposed rule if reflection available)
  updateStatuslineWithLesson({
    accepted: true,
    signal,
    memoryId: memoryRecord.id,
    feedbackId: feedbackEvent.id,
    lesson: reflection?.proposedRule?.rule
      ? `${inferredContext || context} | Rule: ${reflection.proposedRule.rule}`
      : (inferredContext || context),
    turnCount: Array.isArray(params.conversationWindow) ? params.conversationWindow.length : 0,
  });

  // --- Synchronous side-effects (fast, needed by analyzeFeedback) ---
  const mlPaths = getFeedbackPaths();
  try {
    appendSequence(historyEntries, feedbackEvent, mlPaths, { accepted: true });
  } catch { /* Sequence tracking failure is non-critical */ }
  try {
    updateDiversityTracking(feedbackEvent, mlPaths);
  } catch { /* Diversity tracking failure is non-critical */ }
  try {
    const riskScorer = getRiskScorerModule();
    if (riskScorer) riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
  } catch { /* non-critical */ }
  try {
    const { trainAndPersistInterventionPolicy } = require('./intervention-policy');
    trainAndPersistInterventionPolicy(FEEDBACK_DIR);
  } catch { /* non-critical */ }
  try {
    const toolName = feedbackEvent.toolName || feedbackEvent.tool_name || 'unknown';
    const toolInput = feedbackEvent.context || feedbackEvent.input || '';
    recordAction(toolName, toolInput);
    if (feedbackEvent.signal === 'negative') {
      attributeFeedback('negative', feedbackEvent.context || '');
    } else if (feedbackEvent.signal === 'positive') {
      attributeFeedback('positive', feedbackEvent.context || '');
    }
  } catch { /* attribution is non-blocking */ }

  // Vector storage — track promise synchronously so waitForBackgroundSideEffects works
  const vectorStore = getVectorStoreModule();
  if (vectorStore && typeof vectorStore.upsertFeedback === 'function') {
    trackBackgroundSideEffect(vectorStore.upsertFeedback(feedbackEvent));
  }

  // Auto-promote gates on negative feedback (sync — tests depend on immediate promotion)
  if (feedbackEvent.signal === 'negative') {
    try {
      const autoPromote = require('./auto-promote-gates');
      autoPromote.promote(FEEDBACK_LOG_PATH);
    } catch { /* Gate promotion is non-critical */ }
  }

  // --- Deferred side-effects (contextFs, RLAIF — non-critical, potentially slow) ---
  setImmediate(() => {
    try {
      const contextFs = getContextFsModule();
      if (contextFs && typeof contextFs.registerFeedback === 'function') {
        contextFs.registerFeedback(feedbackEvent, memoryRecord);
      }
    } catch { /* Non-critical */ }

    try {
      const sam = getSelfAuditModule();
      if (sam) sam.selfAuditAndLog(feedbackEvent, mlPaths);
    } catch { /* non-critical */ }

    // Auto-create lesson for statusbar display
    try {
      const { createLesson } = require('./lesson-inference');
      createLesson({
        feedbackId: feedbackEvent.id,
        signal: feedbackEvent.signal,
        inferredLesson: memoryRecord ? memoryRecord.title : (feedbackEvent.context || '').slice(0, 200),
        confidence: memoryRecord ? 70 : 40,
        tags: feedbackEvent.tags || [],
      });
    } catch { /* non-critical — lesson creation should never block feedback */ }
  });

  return result;
}

function analyzeFeedback(logPath) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  const resolvedLogPath = logPath || FEEDBACK_LOG_PATH;
  const feedbackDir = path.dirname(resolvedLogPath);
  const paths = buildFeedbackPathsFromDir(feedbackDir);
  const shouldUseSQLite = !logPath || path.resolve(resolvedLogPath) === path.resolve(FEEDBACK_LOG_PATH);
  const entries = readJSONL(resolvedLogPath, { maxLines: 0 });
  const diagnosticLogPath = path.join(feedbackDir, 'diagnostic-log.jsonl');
  const diagnosticEntries = readDiagnosticEntries(diagnosticLogPath);

  // Prefer the JSONL mirror for full analytics fidelity. Fall back to SQLite only
  // when the mirror is unavailable so dashboards and proof paths keep their full shape.
  const db = shouldUseSQLite ? getLessonDB() : null;
  if (db && entries.length === 0) {
    try {
      const { getStatsFromDB } = require('./lesson-db');
      const sqliteStats = getStatsFromDB(db);
      if (sqliteStats.total > 0) return normalizeAnalysisShape(sqliteStats);
    } catch { /* fall through to JSONL scan */ }
  }

  const skills = {};
  const tags = {};
  const rubricCriteria = {};
  let rubricSamples = 0;
  let blockedPromotions = 0;

  let totalPositive = 0;
  let totalNegative = 0;

  for (const entry of entries) {
    if (entry.signal === 'positive') totalPositive++;
    if (entry.signal === 'negative') totalNegative++;

    if (entry.skill) {
      if (!skills[entry.skill]) skills[entry.skill] = { positive: 0, negative: 0, total: 0 };
      skills[entry.skill][entry.signal] += 1;
      skills[entry.skill].total += 1;
    }

    for (const tag of entry.tags || []) {
      if (!tags[tag]) tags[tag] = { positive: 0, negative: 0, total: 0 };
      tags[tag][entry.signal] += 1;
      tags[tag].total += 1;
    }

    if (entry.actionType === 'no-action' && typeof entry.actionReason === 'string' && entry.actionReason.includes('Rubric gate')) {
      blockedPromotions += 1;
    }

    if (entry.rubric && entry.rubric.weightedScore != null) {
      rubricSamples += 1;
    }

    if (entry.rubric && Array.isArray(entry.rubric.failingCriteria)) {
      for (const criterion of entry.rubric.failingCriteria) {
        if (!rubricCriteria[criterion]) rubricCriteria[criterion] = { failures: 0 };
        rubricCriteria[criterion].failures += 1;
      }
    }
  }

  const total = totalPositive + totalNegative;
  const approvalRate = total > 0 ? Math.round((totalPositive / total) * 1000) / 1000 : 0;
  const recent = entries.slice(-20);
  const recentPos = recent.filter((e) => e.signal === 'positive').length;
  const recentRate = recent.length > 0 ? Math.round((recentPos / recent.length) * 1000) / 1000 : 0;

  // Rolling windows: 7-day, 30-day, lifetime (#204)
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const windowStats = { '7d': { total: 0, positive: 0 }, '30d': { total: 0, positive: 0 } };
  for (const entry of entries) {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    const age = now - ts;
    if (age <= SEVEN_DAYS_MS) {
      windowStats['7d'].total++;
      if (entry.signal === 'positive') windowStats['7d'].positive++;
    }
    if (age <= THIRTY_DAYS_MS) {
      windowStats['30d'].total++;
      if (entry.signal === 'positive') windowStats['30d'].positive++;
    }
  }
  const rate7d = windowStats['7d'].total > 0
    ? Math.round((windowStats['7d'].positive / windowStats['7d'].total) * 1000) / 1000 : 0;
  const rate30d = windowStats['30d'].total > 0
    ? Math.round((windowStats['30d'].positive / windowStats['30d'].total) * 1000) / 1000 : 0;
  const TREND_THRESHOLD = 0.05;
  const hasTrendData = windowStats['7d'].total > 0 && windowStats['30d'].total > 0;
  const trend = !hasTrendData ? 'stable'
    : rate7d > rate30d + TREND_THRESHOLD ? 'improving'
      : rate7d < rate30d - TREND_THRESHOLD ? 'degrading' : 'stable';
  const windows = {
    '7d': { ...windowStats['7d'], rate: rate7d },
    '30d': { ...windowStats['30d'], rate: rate30d },
    lifetime: { total, positive: totalPositive, rate: approvalRate },
  };

  const recommendations = [];
  // Structured counterpart to `recommendations` — machine-actionable shape so
  // hooks/agents can act on each item without regex-parsing prose strings.
  // Each entry: { type, target, evidence, action, rationale }.
  const actionableRemediations = [];

  for (const [skill, stat] of Object.entries(skills)) {
    const negRate = stat.total > 0 ? stat.negative / stat.total : 0;
    if (stat.total >= 3 && negRate >= 0.5) {
      recommendations.push(`IMPROVE skill '${skill}' (${stat.negative}/${stat.total} negative)`);
      actionableRemediations.push({
        type: 'skill-improve',
        target: skill,
        evidence: { positive: stat.positive, negative: stat.negative, total: stat.total, negativeRate: Math.round(negRate * 1000) / 1000 },
        action: 'review-and-update-skill',
        rationale: `Skill '${skill}' has ${stat.negative}/${stat.total} negative feedback events (${Math.round(negRate * 100)}% negative rate).`,
      });
    }
  }

  for (const [tag, stat] of Object.entries(tags)) {
    const posRate = stat.total > 0 ? stat.positive / stat.total : 0;
    if (stat.total >= 3 && posRate >= 0.8) {
      recommendations.push(`REUSE pattern '${tag}' (${stat.positive}/${stat.total} positive)`);
      actionableRemediations.push({
        type: 'pattern-reuse',
        target: tag,
        evidence: { positive: stat.positive, negative: stat.negative, total: stat.total, positiveRate: Math.round(posRate * 1000) / 1000 },
        action: 'replicate-pattern',
        rationale: `Pattern '${tag}' has ${stat.positive}/${stat.total} positive feedback events (${Math.round(posRate * 100)}% positive rate).`,
      });
    }
  }

  if (recent.length >= 10 && recentRate < approvalRate - 0.1) {
    recommendations.push('DECLINING trend in last 20 signals; tighten verification before response.');
    actionableRemediations.push({
      type: 'trend-declining',
      target: 'recent-signals',
      evidence: { recentRate, approvalRate, sampleSize: recent.length },
      action: 'tighten-verification-before-response',
      rationale: `Recent approval rate (${Math.round(recentRate * 100)}%) has dropped ≥10pp below lifetime (${Math.round(approvalRate * 100)}%).`,
    });
  }
  if (trend === 'degrading') {
    recommendations.push(`DEGRADING 7d trend (${rate7d}) vs 30d (${rate30d}); increase prevention rule injection.`);
    actionableRemediations.push({
      type: 'trend-degrading',
      target: '7d-window',
      evidence: { rate7d, rate30d, delta: Math.round((rate7d - rate30d) * 1000) / 1000 },
      action: 'increase-prevention-rule-injection',
      rationale: `7d rate (${rate7d}) is below 30d rate (${rate30d}) by more than threshold.`,
    });
  }

  let boostedRisk = null;
  try {
    const riskScorer = getRiskScorerModule();
    if (riskScorer) {
      boostedRisk = riskScorer.getRiskSummary(paths.FEEDBACK_DIR);
      if (boostedRisk) {
        boostedRisk.highRiskDomains.slice(0, 2).forEach((bucket) => {
          recommendations.push(`CHECK high-risk domain '${bucket.key}' (${bucket.highRisk}/${bucket.total} high-risk)`);
          actionableRemediations.push({
            type: 'high-risk-domain',
            target: bucket.key,
            evidence: { highRisk: bucket.highRisk, total: bucket.total, riskRate: bucket.riskRate },
            action: 'audit-domain-failures',
            rationale: `Domain '${bucket.key}' has ${bucket.highRisk}/${bucket.total} high-risk events (${Math.round((bucket.riskRate || 0) * 100)}% risk rate).`,
          });
        });
        boostedRisk.highRiskTags.slice(0, 2).forEach((bucket) => {
          recommendations.push(`CHECK high-risk tag '${bucket.key}' (${bucket.highRisk}/${bucket.total} high-risk)`);
          actionableRemediations.push({
            type: 'high-risk-tag',
            target: bucket.key,
            evidence: { highRisk: bucket.highRisk, total: bucket.total, riskRate: bucket.riskRate },
            action: 'audit-tag-failures',
            rationale: `Tag '${bucket.key}' has ${bucket.highRisk}/${bucket.total} high-risk events (${Math.round((bucket.riskRate || 0) * 100)}% risk rate).`,
          });
        });
      }
    }
  } catch {
    boostedRisk = null;
  }
  const diagnostics = aggregateFailureDiagnostics([...entries, ...diagnosticEntries]);
  let delegation = null;
  try {
    const delegationRuntime = getDelegationRuntimeModule();
    if (delegationRuntime && typeof delegationRuntime.summarizeDelegation === 'function') {
      delegation = delegationRuntime.summarizeDelegation(paths.FEEDBACK_DIR);
      if (delegation.attemptCount >= 3 && delegation.verificationFailureRate >= 0.5) {
        recommendations.push(`REDUCE delegation: verification failure rate is ${Math.round(delegation.verificationFailureRate * 100)}%`);
        actionableRemediations.push({
          type: 'delegation-reduce',
          target: 'verification-failure-rate',
          evidence: { verificationFailureRate: delegation.verificationFailureRate, attemptCount: delegation.attemptCount },
          action: 'reduce-delegation-use',
          rationale: `Delegation verification failure rate is ${Math.round(delegation.verificationFailureRate * 100)}% across ${delegation.attemptCount} attempts.`,
        });
      }
      if (delegation.avoidedDelegationCount >= 3) {
        recommendations.push(`REVIEW delegation policy: ${delegation.avoidedDelegationCount} handoff starts were blocked before execution`);
        actionableRemediations.push({
          type: 'delegation-policy-review',
          target: 'handoff-blocks',
          evidence: { avoidedDelegationCount: delegation.avoidedDelegationCount },
          action: 'review-delegation-policy',
          rationale: `${delegation.avoidedDelegationCount} handoff starts were blocked before execution.`,
        });
      }
    }
  } catch {
    delegation = null;
  }
  diagnostics.categories.slice(0, 2).forEach((bucket) => {
    recommendations.push(`DIAGNOSE '${bucket.key}' failures (${bucket.count})`);
    actionableRemediations.push({
      type: 'diagnose-failure-category',
      target: bucket.key,
      evidence: { count: bucket.count },
      action: 'investigate-failure-category',
      rationale: `Failure category '${bucket.key}' has ${bucket.count} diagnosed events.`,
    });
  });

  return normalizeAnalysisShape({
    total,
    totalPositive,
    totalNegative,
    approvalRate,
    recentRate,
    windows,
    trend,
    skills,
    tags,
    rubric: {
      samples: rubricSamples,
      blockedPromotions,
      failingCriteria: rubricCriteria,
    },
    diagnostics,
    delegation,
    boostedRisk,
    recommendations,
    actionableRemediations,
  });
}

function buildPreventionRules(minOccurrences = 2, options = {}) {
  const resolvedMinOccurrences = Number.isFinite(minOccurrences)
    ? minOccurrences
    : getEffectiveSetting('prevention_min_occurrences', 2);
  const { MEMORY_LOG_PATH, DIAGNOSTIC_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH).filter((m) => m.category === 'error');
  const diagnosticEntries = readDiagnosticEntries(DIAGNOSTIC_LOG_PATH);
  if (memories.length === 0) {
    if (diagnosticEntries.length === 0) {
      return '# Prevention Rules\n\nNo mistake memories recorded yet.';
    }
  }

  // Time-weighted decay: recent mistakes count more (#202)
  const decayHalfLifeDays = options.decayHalfLifeDays || 7;
  const lambda = Math.LN2 / decayHalfLifeDays;
  const now = Date.now();

  function decayWeight(memory) {
    const ts = memory.timestamp ? new Date(memory.timestamp).getTime() : now;
    const daysSince = (now - ts) / (24 * 60 * 60 * 1000);
    return Math.exp(-lambda * daysSince);
  }

  const buckets = {};
  const rubricBuckets = {};
  const diagnosisBuckets = {};
  const repeatedViolationBuckets = {};
  for (const m of memories) {
    const key = (m.richContext && m.richContext.domain && m.richContext.domain !== 'unknown')
      ? m.richContext.domain
      : (m.tags || []).find((t) => !['feedback', 'negative', 'positive'].includes(t)) || 'general';
    if (!buckets[key]) buckets[key] = { items: [], weightedCount: 0 };
    const w = decayWeight(m);
    const occ = m.occurrences || 1;
    buckets[key].items.push(m);
    buckets[key].weightedCount += w * occ;

    const failed = m.rubricSummary && Array.isArray(m.rubricSummary.failingCriteria)
      ? m.rubricSummary.failingCriteria
      : [];
    failed.forEach((criterion) => {
      if (!rubricBuckets[criterion]) rubricBuckets[criterion] = [];
      for (let i = 0; i < occ; i++) rubricBuckets[criterion].push(m);
    });

    if (m.diagnosis && m.diagnosis.rootCauseCategory) {
      if (!diagnosisBuckets[m.diagnosis.rootCauseCategory]) diagnosisBuckets[m.diagnosis.rootCauseCategory] = [];
      for (let i = 0; i < occ; i++) diagnosisBuckets[m.diagnosis.rootCauseCategory].push(m);
    }

    (m.diagnosis && Array.isArray(m.diagnosis.violations) ? m.diagnosis.violations : []).forEach((violation) => {
      const vKey = violation.constraintId || violation.message;
      if (!vKey) return;
      if (!repeatedViolationBuckets[vKey]) repeatedViolationBuckets[vKey] = [];
      for (let i = 0; i < occ; i++) repeatedViolationBuckets[vKey].push(m);
    });
  }

  for (const entry of diagnosticEntries) {
    const diagnosis = entry && entry.diagnosis ? entry.diagnosis : null;
    if (!diagnosis || !diagnosis.rootCauseCategory) continue;
    if (!diagnosisBuckets[diagnosis.rootCauseCategory]) diagnosisBuckets[diagnosis.rootCauseCategory] = [];
    diagnosisBuckets[diagnosis.rootCauseCategory].push(entry);

    (Array.isArray(diagnosis.violations) ? diagnosis.violations : []).forEach((violation) => {
      const key = violation.constraintId || violation.message;
      if (!key) return;
      if (!repeatedViolationBuckets[key]) repeatedViolationBuckets[key] = [];
      repeatedViolationBuckets[key].push(entry);
    });
  }

  const lines = ['# Prevention Rules', '', 'Generated from negative feedback memories (time-weighted, half-life: ' + decayHalfLifeDays + 'd).'];

  Object.entries(buckets)
    .sort((a, b) => b[1].weightedCount - a[1].weightedCount)
    .forEach(([domain, { items, weightedCount }]) => {
      const effectiveOccurrences = Math.round(weightedCount);
      if (effectiveOccurrences < resolvedMinOccurrences) return;
      const latest = items[items.length - 1];
      const avoid = (latest.content || '').split('\n').find((l) => l.toLowerCase().startsWith('how to avoid:')) || 'How to avoid: Investigate and prevent recurrence';
      lines.push('');
      lines.push(`## ${domain}`);
      lines.push(`- Recurrence count: ${items.length} (weighted: ${weightedCount.toFixed(1)})`);
      lines.push(`- Rule: ${avoid.replace(/^How to avoid:\s*/i, '')}`);
      lines.push(`- Latest mistake: ${latest.title}`);
    });

  const rubricEntries = Object.entries(rubricBuckets)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, items]) => items.length >= resolvedMinOccurrences);
  if (rubricEntries.length > 0) {
    lines.push('');
    lines.push('## Rubric Failure Dimensions');
    rubricEntries.forEach(([criterion, items]) => {
      lines.push(`- ${criterion}: ${items.length} failures`);
    });
  }

  const diagnosisEntries = Object.entries(diagnosisBuckets)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, items]) => items.length >= resolvedMinOccurrences);
  if (diagnosisEntries.length > 0) {
    lines.push('');
    lines.push('## Root Cause Categories');
    diagnosisEntries.forEach(([category, items]) => {
      lines.push(`- ${category}: ${items.length} failures`);
    });
  }

  const repeatedViolationEntries = Object.entries(repeatedViolationBuckets)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, items]) => items.length >= resolvedMinOccurrences);
  if (repeatedViolationEntries.length > 0) {
    lines.push('');
    lines.push('## Repeated Failure Constraints');
    repeatedViolationEntries.forEach(([constraintId, items]) => {
      lines.push(`- ${constraintId}: ${items.length} failures`);
    });
  }

  if (lines.length === 3) {
    lines.push('');
    lines.push(`No domain has reached the threshold (${resolvedMinOccurrences}) yet.`);
  }

  return lines.join('\n');
}

function writePreventionRules(filePath, minOccurrences = 2) {
  const { PREVENTION_RULES_PATH } = getFeedbackPaths();
  const outPath = filePath || PREVENTION_RULES_PATH;
  const resolvedMinOccurrences = Number.isFinite(minOccurrences)
    ? minOccurrences
    : getEffectiveSetting('prevention_min_occurrences', 2);
  const markdown = buildPreventionRules(resolvedMinOccurrences);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${markdown}\n`);

  const contextFs = getContextFsModule();
  if (contextFs && typeof contextFs.registerPreventionRules === 'function') {
    try {
      contextFs.registerPreventionRules(markdown, { minOccurrences: resolvedMinOccurrences, outputPath: outPath });
    } catch {
      // Non-critical
    }
  }
  return { path: outPath, markdown };
}

function feedbackSummary(recentN = 20, options = {}) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths(options);
  const entries = readJSONL(FEEDBACK_LOG_PATH);
  if (entries.length === 0) {
    return '## Feedback Summary\nNo feedback recorded yet.';
  }

  const recent = entries.slice(-recentN);
  const positive = recent.filter((e) => e.signal === 'positive').length;
  const negative = recent.filter((e) => e.signal === 'negative').length;
  const pct = Math.round((positive / recent.length) * 100);

  const analysis = analyzeFeedback(FEEDBACK_LOG_PATH);

  const lines = [
    `## Feedback Summary (last ${recent.length})`,
    `- Positive: ${positive}`,
    `- Negative: ${negative}`,
    `- Approval: ${pct}%`,
    `- Overall approval: ${Math.round(analysis.approvalRate * 100)}%`,
  ];

  if (analysis.delegation) {
    lines.push(`- Delegation attempts: ${analysis.delegation.attemptCount}`);
    lines.push(`- Delegation accepted/rejected/aborted: ${analysis.delegation.acceptedCount}/${analysis.delegation.rejectedCount}/${analysis.delegation.abortedCount}`);
    lines.push(`- Delegation verification failure rate: ${Math.round((analysis.delegation.verificationFailureRate || 0) * 100)}%`);
  }

  if (analysis.boostedRisk) {
    lines.push(`- Boosted risk base rate: ${Math.round((analysis.boostedRisk.baseRate || 0) * 100)}%`);
    lines.push(`- Boosted risk mode: ${analysis.boostedRisk.mode}`);
    if (analysis.boostedRisk.highRiskDomains.length > 0) {
      const topDomain = analysis.boostedRisk.highRiskDomains[0];
      lines.push(`- Highest-risk domain: ${topDomain.key} (${Math.round(topDomain.riskRate * 100)}%)`);
    }
  }

  if (analysis.recommendations.length > 0) {
    lines.push('- Recommendations:');
    analysis.recommendations.slice(0, 5).forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });
  return args;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.test) {
    runTests();
    return;
  }

  if (args.capture) {
    const result = captureFeedback({
      signal: args.signal,
      context: args.context || '',
      whatWentWrong: args['what-went-wrong'],
      whatToChange: args['what-to-change'],
      whatWorked: args['what-worked'],
      rubricScores: args['rubric-scores'],
      guardrails: args.guardrails,
      tags: args.tags,
      skill: args.skill,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.accepted ? 0 : 2);
  }

  if (args.analyze) {
    console.log(JSON.stringify(analyzeFeedback(), null, 2));
    return;
  }

  if (args.summary) {
    console.log(feedbackSummary(Number(args.recent || 20)));
    return;
  }

  if (args.rules) {
    const result = writePreventionRules(args.output, Number(args.min || 2));
    console.log(`Wrote prevention rules to ${result.path}`);
    return;
  }

  console.log(`Usage:
  node scripts/feedback-loop.js --capture --signal=up --context="..." --tags="verification,fix"
  node scripts/feedback-loop.js --capture --signal=up --context="..." --rubric-scores='[{\"criterion\":\"correctness\",\"score\":4}]' --guardrails='{\"testsPassed\":true}'
  node scripts/feedback-loop.js --analyze
  node scripts/feedback-loop.js --summary --recent=20
  node scripts/feedback-loop.js --rules [--min=2] [--output=path]
  node scripts/feedback-loop.js --test`);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      console.log(`  PASS ${name}`);
    } else {
      failed++;
      console.log(`  FAIL ${name}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'thumbgate-loop-test-'));
  const localFeedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  const savedInitCwd = process.env.INIT_CWD;
  process.env.INIT_CWD = savedInitCwd || process.cwd();

  assert(getFeedbackPaths().FEEDBACK_DIR === tmpDir, 'explicit feedback dir wins over npm INIT_CWD');

  appendJSONL(localFeedbackLog, { signal: 'positive', tags: ['testing'], skill: 'verify' });
  appendJSONL(localFeedbackLog, { signal: 'negative', tags: ['testing'], skill: 'verify' });
  appendJSONL(localFeedbackLog, { signal: 'positive', tags: ['testing'], skill: 'verify' });

  const stats = analyzeFeedback(localFeedbackLog);
  assert(stats.total === 3, 'analyzeFeedback counts total events');
  assert(stats.totalPositive === 2, 'analyzeFeedback counts positives');
  assert(stats.totalNegative === 1, 'analyzeFeedback counts negatives');
  assert(stats.tags.testing.total === 3, 'analyzeFeedback tracks tags');

  const good = captureFeedback({
    signal: 'up',
    context: 'Ran tests and included output',
    whatWorked: 'Evidence-first flow',
    tags: ['verification', 'testing'],
    skill: 'executor',
  });
  assert(good.accepted, 'captureFeedback accepts valid positive feedback');

  const blocked = captureFeedback({
    signal: 'up',
    context: 'Looks good',
    whatWorked: 'Skipped proof',
    tags: ['verification'],
    rubricScores: JSON.stringify([
      { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
      { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'no test output present' },
    ]),
    guardrails: JSON.stringify({
      testsPassed: false,
      pathSafety: true,
      budgetCompliant: true,
    }),
  });
  assert(!blocked.accepted, 'captureFeedback blocks unsafe positive promotion via rubric gate');

  const bad = captureFeedback({ signal: 'down' });
  assert(!bad.accepted, 'captureFeedback rejects vague negative feedback');
  assert(bad.needsClarification === true, 'captureFeedback requests clarification for vague negative feedback');

  const summary = feedbackSummary(5);
  assert(summary.includes('Feedback Summary'), 'feedbackSummary returns text output');

  const rules = writePreventionRules(path.join(tmpDir, 'rules.md'), 1);
  assert(rules.markdown.includes('# Prevention Rules'), 'writePreventionRules writes markdown rules');
  const postStats = analyzeFeedback(path.join(tmpDir, 'feedback-log.jsonl'));
  assert(postStats.rubric.blockedPromotions >= 1, 'analyzeFeedback tracks blocked rubric promotions');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  if (savedInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = savedInitCwd;
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Compact the memory JSONL log — remove exact-content duplicates, keep the most recent.
 * @returns {{ before: number, after: number, removed: number }}
 */
function compactMemories() {
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const all = readJSONL(MEMORY_LOG_PATH, { maxLines: 0 });
  const seen = new Map();

  // Walk newest-first so we keep the latest version of each memory
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const key = (m.content || '').trim().toLowerCase();
    if (!key) {
      // Keep records with no content (edge case)
      seen.set(`__empty_${i}`, m);
      continue;
    }
    if (!seen.has(key)) {
      seen.set(key, m);
    }
  }

  const deduped = [...seen.values()].reverse();
  ensureDir(path.dirname(MEMORY_LOG_PATH));
  fs.writeFileSync(MEMORY_LOG_PATH, deduped.map((r) => JSON.stringify(r)).join('\n') + (deduped.length ? '\n' : ''));

  return {
    before: all.length,
    after: deduped.length,
    removed: all.length - deduped.length,
  };
}

function buildCorrectiveActionsReminder(correctiveActions = []) {
  if (!Array.isArray(correctiveActions) || correctiveActions.length === 0) return null;
  const lines = correctiveActions
    .slice(0, 3)
    .map((action) => {
      const type = String(action.type || action.source || 'corrective_action').replace(/_/g, ' ');
      const text = String(action.text || action.action || action.description || '').trim();
      if (!text) return null;
      return `  - ${type}: ${text.slice(0, 240)}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return null;
  return `[ThumbGate] Corrective actions from prior lessons - apply before the next tool call:\n${lines.join('\n')}`;
}

module.exports = {
  captureFeedback,
  compactMemories,
  buildCorrectiveActionsReminder,
  analyzeFeedback,
  buildPreventionRules,
  writePreventionRules,
  feedbackSummary,
  listEnforcementMatrix,
  readJSONL,
  appendDiagnosticRecord,
  readDiagnosticEntries,
  getFeedbackPaths,
  inferDomain,
  inferOutcome,
  enrichFeedbackContext,
  inferLessonFromConversation,
  updateStatuslineWithLesson,
  waitForBackgroundSideEffects,
  getPendingBackgroundSideEffectCount,
  getFeedbackPaths,
  get FEEDBACK_LOG_PATH() {
    return getFeedbackPaths().FEEDBACK_LOG_PATH;
  },
  get DIAGNOSTIC_LOG_PATH() {
    return getFeedbackPaths().DIAGNOSTIC_LOG_PATH;
  },
  get MEMORY_LOG_PATH() {
    return getFeedbackPaths().MEMORY_LOG_PATH;
  },
  get SUMMARY_PATH() {
    return getFeedbackPaths().SUMMARY_PATH;
  },
  get PREVENTION_RULES_PATH() {
    return getFeedbackPaths().PREVENTION_RULES_PATH;
  },
};

if (require.main === module) {
  runCli();
}
