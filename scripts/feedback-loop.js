#!/usr/bin/env node
/**
 * MCP Memory Gateway (local-first)
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
} = require('./feedback-quality');
const {
  buildRubricEvaluation,
} = require('./rubric-engine');
const { recordAction, attributeFeedback } = require('./feedback-attribution');
const {
  diagnoseFailure,
  aggregateFailureDiagnostics,
} = require('./failure-diagnostics');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');

// ML sequence tracking constants (ML-03)
const SEQUENCE_WINDOW = 10;
const DOMAIN_CATEGORIES = [
  'testing', 'security', 'performance', 'ui-components', 'api-integration',
  'git-workflow', 'documentation', 'debugging', 'architecture', 'data-modeling',
  'behavioral',
];

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const pendingBackgroundSideEffects = new Set();

function getFeedbackPaths() {
  if (process.env.RLHF_FEEDBACK_DIR) {
    const d = process.env.RLHF_FEEDBACK_DIR;
    return {
      FEEDBACK_DIR: d,
      FEEDBACK_LOG_PATH: path.join(d, 'feedback-log.jsonl'),
      DIAGNOSTIC_LOG_PATH: path.join(d, 'diagnostic-log.jsonl'),
      MEMORY_LOG_PATH: path.join(d, 'memory-log.jsonl'),
      SUMMARY_PATH: path.join(d, 'feedback-summary.json'),
      PREVENTION_RULES_PATH: path.join(d, 'prevention-rules.md'),
    };
  }

  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    const d = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'feedback');
    return {
      FEEDBACK_DIR: d,
      FEEDBACK_LOG_PATH: path.join(d, 'feedback-log.jsonl'),
      DIAGNOSTIC_LOG_PATH: path.join(d, 'diagnostic-log.jsonl'),
      MEMORY_LOG_PATH: path.join(d, 'memory-log.jsonl'),
      SUMMARY_PATH: path.join(d, 'feedback-summary.json'),
      PREVENTION_RULES_PATH: path.join(d, 'prevention-rules.md'),
    };
  }

  // Auto-discovery order:
  // 1. .rlhf/ (Standard)
  // 2. .claude/memory/feedback/ (Legacy Claude)
  // 3. ~/.rlhf/projects/<cwd-basename>/ (Global fallback for true plug-and-play)

  const localRlhf = path.join(process.cwd(), '.rlhf');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback');
  
  let baseDir = localRlhf;
  if (!fs.existsSync(localRlhf) && fs.existsSync(localClaude)) {
    baseDir = localClaude;
  } else if (!fs.existsSync(localRlhf)) {
    // Zero-Config Global Fallback
    const projectName = path.basename(process.cwd()) || 'default';
    baseDir = path.join(HOME, '.rlhf', 'projects', projectName);
  }

  return {
    FEEDBACK_DIR: baseDir,
    FEEDBACK_LOG_PATH: path.join(baseDir, 'feedback-log.jsonl'),
    DIAGNOSTIC_LOG_PATH: path.join(baseDir, 'diagnostic-log.jsonl'),
    MEMORY_LOG_PATH: path.join(baseDir, 'memory-log.jsonl'),
    SUMMARY_PATH: path.join(baseDir, 'feedback-summary.json'),
    PREVENTION_RULES_PATH: path.join(baseDir, 'prevention-rules.md'),
  };
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

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
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

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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

    return {
      ...feedbackEvent,
      richContext: {
        domain,
        filePaths,
        errorType,
        outcomeCategory,
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

function captureFeedback(params) {
  const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH, FEEDBACK_DIR } = getFeedbackPaths();
  const signal = normalizeSignal(params.signal);
  if (!signal) {
    return {
      accepted: false,
      reason: `Invalid signal "${params.signal}". Use up/down or positive/negative.`,
    };
  }

  const context = params.context || '';
  extractAndSetConstraints(context);

  const providedTags = Array.isArray(params.tags)
    ? params.tags
    : String(params.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

  const semanticTags = inferSemanticTags(context);
  const tags = Array.from(new Set([...providedTags, ...semanticTags]));

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
    context: params.context || '',
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    whatWorked: params.whatWorked,
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
    context: params.context || '',
    lastAction,
    whatWentWrong: params.whatWentWrong || null,
    whatToChange: params.whatToChange || null,
    whatWorked: params.whatWorked || null,
    reasoning: params.reasoning || null,
    visualEvidence: params.visualEvidence || null,
    tags,
    skill: params.skill || null,
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
  summary.total += 1;
  summary[signal] += 1;

  if (action.type === 'no-action') {
    const firewallBlocked = maybeBlockMemoryIngress({ feedbackEvent, summary, now });
    if (firewallBlocked) {
      return firewallBlocked;
    }
    const clarification = buildClarificationMessage({
      signal,
      context: params.context || '',
      whatWentWrong: params.whatWentWrong,
      whatToChange: params.whatToChange,
      whatWorked: params.whatWorked,
    });
    summary.rejected += 1;
    summary.lastUpdated = now;
    saveSummary(summary);
    appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);
    try {
      appendSequence(historyEntries, feedbackEvent, getFeedbackPaths(), { accepted: false });
    } catch {
      // Sequence tracking failure is non-critical
    }
    try {
      const riskScorer = getRiskScorerModule();
      if (riskScorer) {
        riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
      }
    } catch {
      // Risk model refresh is non-critical
    }
    return {
      accepted: false,
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
    try {
      appendSequence(historyEntries, feedbackEvent, getFeedbackPaths(), { accepted: false });
    } catch {
      // Sequence tracking failure is non-critical
    }
    try {
      const riskScorer = getRiskScorerModule();
      if (riskScorer) {
        riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
      }
    } catch {
      // Risk model refresh is non-critical
    }
    return {
      accepted: false,
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
    diagnosis: storedDiagnosis,
    sourceFeedbackId: feedbackEvent.id,
    timestamp: now,
  };

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
  appendJSONL(MEMORY_LOG_PATH, memoryRecord);

  const contextFs = getContextFsModule();
  if (contextFs && typeof contextFs.registerFeedback === 'function') {
    try {
      contextFs.registerFeedback(feedbackEvent, memoryRecord);
    } catch {
      // Non-critical; feedback remains in primary logs
    }
  }

  // ML side-effects: sequence tracking and diversity (non-blocking — primary write already succeeded)
  const mlPaths = getFeedbackPaths();
  try {
    appendSequence(historyEntries, feedbackEvent, mlPaths, { accepted: true });
  } catch (err) {
    // Sequence tracking failure is non-critical
  }
  try {
    updateDiversityTracking(feedbackEvent, mlPaths);
  } catch (err) {
    // Diversity tracking failure is non-critical
  }

  // Vector storage side-effect (non-blocking — primary write already succeeded)
  const vectorStore = getVectorStoreModule();
  if (vectorStore && typeof vectorStore.upsertFeedback === 'function') {
    trackBackgroundSideEffect(vectorStore.upsertFeedback(feedbackEvent));
  }

  // RLAIF self-audit side-effect (non-blocking — 4th enrichment layer)
  try {
    const sam = getSelfAuditModule();
    if (sam) sam.selfAuditAndLog(feedbackEvent, mlPaths);
  } catch (_err) { /* non-critical */ }

  // Boosted risk model refresh — local, file-based, and non-blocking
  try {
    const riskScorer = getRiskScorerModule();
    if (riskScorer) {
      riskScorer.trainAndPersistRiskModel(FEEDBACK_DIR);
    }
  } catch (_err) { /* non-critical */ }

  // Attribution side-effects — fire-and-forget, never throw
  try {
    const toolName = feedbackEvent.toolName || feedbackEvent.tool_name || 'unknown';
    const toolInput = feedbackEvent.context || feedbackEvent.input || '';
    recordAction(toolName, toolInput);
    if (feedbackEvent.signal === 'negative') {
      attributeFeedback('negative', feedbackEvent.context || '');
    } else if (feedbackEvent.signal === 'positive') {
      attributeFeedback('positive', feedbackEvent.context || '');
    }
  } catch (e) {
    // attribution is non-blocking
  }

  // Auto-promote gates on negative feedback — non-blocking
  if (feedbackEvent.signal === 'negative') {
    try {
      const autoPromote = require('./auto-promote-gates');
      autoPromote.promote(FEEDBACK_LOG_PATH);
    } catch (_err) {
      // Gate promotion is non-critical — never fail the capture pipeline
    }
  }

  summary.accepted += 1;
  summary.lastUpdated = now;
  saveSummary(summary);

  return {
    accepted: true,
    status: 'promoted',
    message: 'Feedback promoted to reusable memory.',
    feedbackEvent,
    memoryRecord,
  };
}

function analyzeFeedback(logPath) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  const entries = readJSONL(logPath || FEEDBACK_LOG_PATH);
  const diagnosticLogPath = path.join(path.dirname(logPath || FEEDBACK_LOG_PATH), 'diagnostic-log.jsonl');
  const diagnosticEntries = readDiagnosticEntries(diagnosticLogPath);
  const paths = getFeedbackPaths();
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

  for (const [skill, stat] of Object.entries(skills)) {
    const negRate = stat.total > 0 ? stat.negative / stat.total : 0;
    if (stat.total >= 3 && negRate >= 0.5) {
      recommendations.push(`IMPROVE skill '${skill}' (${stat.negative}/${stat.total} negative)`);
    }
  }

  for (const [tag, stat] of Object.entries(tags)) {
    const posRate = stat.total > 0 ? stat.positive / stat.total : 0;
    if (stat.total >= 3 && posRate >= 0.8) {
      recommendations.push(`REUSE pattern '${tag}' (${stat.positive}/${stat.total} positive)`);
    }
  }

  if (recent.length >= 10 && recentRate < approvalRate - 0.1) {
    recommendations.push('DECLINING trend in last 20 signals; tighten verification before response.');
  }
  if (trend === 'degrading') {
    recommendations.push(`DEGRADING 7d trend (${rate7d}) vs 30d (${rate30d}); increase prevention rule injection.`);
  }

  let boostedRisk = null;
  try {
    const riskScorer = getRiskScorerModule();
    if (riskScorer) {
      boostedRisk = riskScorer.getRiskSummary(paths.FEEDBACK_DIR);
      if (boostedRisk) {
        boostedRisk.highRiskDomains.slice(0, 2).forEach((bucket) => {
          recommendations.push(`CHECK high-risk domain '${bucket.key}' (${bucket.highRisk}/${bucket.total} high-risk)`);
        });
        boostedRisk.highRiskTags.slice(0, 2).forEach((bucket) => {
          recommendations.push(`CHECK high-risk tag '${bucket.key}' (${bucket.highRisk}/${bucket.total} high-risk)`);
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
      }
      if (delegation.avoidedDelegationCount >= 3) {
        recommendations.push(`REVIEW delegation policy: ${delegation.avoidedDelegationCount} handoff starts were blocked before execution`);
      }
    }
  } catch {
    delegation = null;
  }
  diagnostics.categories.slice(0, 2).forEach((bucket) => {
    recommendations.push(`DIAGNOSE '${bucket.key}' failures (${bucket.count})`);
  });

  return {
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
  };
}

function buildPreventionRules(minOccurrences = 2, options = {}) {
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
    const key = (m.tags || []).find((t) => !['feedback', 'negative', 'positive'].includes(t)) || 'general';
    if (!buckets[key]) buckets[key] = { items: [], weightedCount: 0 };
    const w = decayWeight(m);
    buckets[key].items.push(m);
    buckets[key].weightedCount += w;

    const failed = m.rubricSummary && Array.isArray(m.rubricSummary.failingCriteria)
      ? m.rubricSummary.failingCriteria
      : [];
    failed.forEach((criterion) => {
      if (!rubricBuckets[criterion]) rubricBuckets[criterion] = [];
      rubricBuckets[criterion].push(m);
    });

    if (m.diagnosis && m.diagnosis.rootCauseCategory) {
      if (!diagnosisBuckets[m.diagnosis.rootCauseCategory]) diagnosisBuckets[m.diagnosis.rootCauseCategory] = [];
      diagnosisBuckets[m.diagnosis.rootCauseCategory].push(m);
    }

    (m.diagnosis && Array.isArray(m.diagnosis.violations) ? m.diagnosis.violations : []).forEach((violation) => {
      const key = violation.constraintId || violation.message;
      if (!key) return;
      if (!repeatedViolationBuckets[key]) repeatedViolationBuckets[key] = [];
      repeatedViolationBuckets[key].push(m);
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
      if (effectiveOccurrences < minOccurrences) return;
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
    .filter(([, items]) => items.length >= minOccurrences);
  if (rubricEntries.length > 0) {
    lines.push('');
    lines.push('## Rubric Failure Dimensions');
    rubricEntries.forEach(([criterion, items]) => {
      lines.push(`- ${criterion}: ${items.length} failures`);
    });
  }

  const diagnosisEntries = Object.entries(diagnosisBuckets)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, items]) => items.length >= minOccurrences);
  if (diagnosisEntries.length > 0) {
    lines.push('');
    lines.push('## Root Cause Categories');
    diagnosisEntries.forEach(([category, items]) => {
      lines.push(`- ${category}: ${items.length} failures`);
    });
  }

  const repeatedViolationEntries = Object.entries(repeatedViolationBuckets)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, items]) => items.length >= minOccurrences);
  if (repeatedViolationEntries.length > 0) {
    lines.push('');
    lines.push('## Repeated Failure Constraints');
    repeatedViolationEntries.forEach(([constraintId, items]) => {
      lines.push(`- ${constraintId}: ${items.length} failures`);
    });
  }

  if (lines.length === 3) {
    lines.push('');
    lines.push(`No domain has reached the threshold (${minOccurrences}) yet.`);
  }

  return lines.join('\n');
}

function writePreventionRules(filePath, minOccurrences = 2) {
  const { PREVENTION_RULES_PATH } = getFeedbackPaths();
  const outPath = filePath || PREVENTION_RULES_PATH;
  const markdown = buildPreventionRules(minOccurrences);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${markdown}\n`);

  const contextFs = getContextFsModule();
  if (contextFs && typeof contextFs.registerPreventionRules === 'function') {
    try {
      contextFs.registerPreventionRules(markdown, { minOccurrences, outputPath: outPath });
    } catch {
      // Non-critical
    }
  }
  return { path: outPath, markdown };
}

function feedbackSummary(recentN = 20) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
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

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-loop-test-'));
  const localFeedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

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
  delete process.env.RLHF_FEEDBACK_DIR;
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  captureFeedback,
  analyzeFeedback,
  buildPreventionRules,
  writePreventionRules,
  feedbackSummary,
  readJSONL,
  appendDiagnosticRecord,
  readDiagnosticEntries,
  getFeedbackPaths,
  inferDomain,
  inferOutcome,
  enrichFeedbackContext,
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
