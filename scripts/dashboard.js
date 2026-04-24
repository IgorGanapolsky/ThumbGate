#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { aggregateFailureDiagnostics } = require('./failure-diagnostics');
const { AUDIT_LOG_FILENAME } = require('./audit-trail');
const { getBillingSummary, loadFunnelLedger, loadResolvedRevenueEvents } = require('./billing');
const {
  createUnavailableReport,
  loadOptionalModule,
} = require('./private-core-boundary');
const { getTelemetryAnalytics, loadTelemetryEvents } = require('./telemetry-analytics');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { loadGatesConfig } = require('./gates-engine');
const { filterEntriesForWindow, resolveAnalyticsWindow } = require('./analytics-window');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { generateAgentReadinessReport } = require('./agent-readiness');
const { summarizeGateTemplates } = require('./gate-templates');
const { buildPredictiveInsights } = loadOptionalModule('./predictive-insights', () => ({
  buildPredictiveInsights: () => ({
    upgradePropensity: {
      pro: { band: 'unavailable', score: 0 },
      team: { band: 'unavailable', score: 0 },
    },
    revenueForecast: {
      predictedBookedRevenueCents: 0,
      incrementalOpportunityCents: 0,
    },
    anomalySummary: {
      count: 0,
      severity: 'none',
    },
    topCreators: [],
    topSources: [],
    ...createUnavailableReport('Predictive insights'),
  }),
}));
const { routeProfile } = require('./profile-router');
const { getSettingsStatus } = require('./settings-hierarchy');
const { summarizeWorkflowRuns } = require('./workflow-runs');
const { generateGovernanceReport } = require('./background-agent-governance');
const { searchLessons } = require('./lesson-search');
const { getInterventionPolicySummary } = require('./intervention-policy');
const {
  DECISION_LOG_FILENAME,
  computeDecisionMetrics,
  readDecisionLog,
} = require('./decision-journal');
const { analyzeFeedback } = require('./feedback-loop');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'default.json');
const LANDING_PAGE_PATH = path.join(PROJECT_ROOT, 'public', 'index.html');
const DASHBOARD_REVIEW_STATE_FILE = 'dashboard-review-state.json';

function loadOrgDashboardModule() {
  const modulePath = path.resolve(__dirname, 'org-dashboard.js');
  if (!fs.existsSync(modulePath)) return null;
  return loadOptionalModule('./org-dashboard', () => ({
    generateOrgDashboard: ({ windowHours } = {}) => buildUnavailableOrgDashboard(windowHours || 24),
  }));
}

function loadDelegationRuntimeModule() {
  const modulePath = path.resolve(__dirname, 'delegation-runtime.js');
  if (!fs.existsSync(modulePath)) return null;
  return require(modulePath);
}

function buildUnavailableOrgDashboard(windowHours) {
  return {
    available: false,
    windowHours,
    totalAgents: 0,
    activeAgents: 0,
    totalToolCalls: 0,
    totalBlocked: 0,
    totalWarned: 0,
    totalAllowed: 0,
    orgAdherenceRate: 100,
    topBlockedGates: [],
    riskAgents: [],
    agents: [],
    proRequired: true,
    upgradeMessage: 'Org dashboard is available only in the private ThumbGate Core runtime (ThumbGate-Core).',
    availability: 'private_core',
  };
}

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function toLocalDayKey(value) {
  const ts = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDashboardReviewStatePath(feedbackDir) {
  return path.join(feedbackDir, DASHBOARD_REVIEW_STATE_FILE);
}

function inferProjectRootFromFeedbackDir(feedbackDir) {
  if (!feedbackDir) return null;
  const resolved = path.resolve(feedbackDir);
  return path.basename(resolved) === '.thumbgate' ? path.dirname(resolved) : null;
}

function resolveGitDir(projectRoot) {
  const gitPath = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitPath)) return null;
  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) return gitPath;
  // Worktree / submodule: .git is a file like "gitdir: /path/to/real/gitdir".
  // Parse with startsWith+slice — no regex, so no ReDoS surface (S5852).
  if (stat.isFile()) {
    const contents = fs.readFileSync(gitPath, 'utf8').trim();
    const prefix = 'gitdir:';
    if (!contents.startsWith(prefix)) return null;
    const target = contents.slice(prefix.length).trim();
    if (!target) return null;
    const resolved = path.isAbsolute(target)
      ? target
      : path.resolve(projectRoot, target);
    return fs.existsSync(resolved) ? resolved : null;
  }
  return null;
}

function readGitHead(projectRoot) {
  if (!projectRoot) return null;
  const gitDir = resolveGitDir(projectRoot);
  if (!gitDir) return null;
  try {
    // Read .git/HEAD directly instead of spawning `git rev-parse HEAD`.
    // Avoids S4036 (PATH-resolved binary) and is faster: no subprocess.
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head) return null;
    // Detached HEAD: the file contains the raw SHA.
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    // Symbolic ref: "ref: refs/heads/<branch>" — resolve the ref file.
    // Parse with startsWith+slice — no regex, so no ReDoS surface (S5852).
    const refPrefix = 'ref:';
    if (!head.startsWith(refPrefix)) return null;
    const refName = head.slice(refPrefix.length).trim();
    if (!refName) return null;
    // For worktrees, the commondir points to the main .git. Refs may live
    // there rather than in the per-worktree gitdir.
    const commonDirFile = path.join(gitDir, 'commondir');
    let commonDir = gitDir;
    if (fs.existsSync(commonDirFile)) {
      const rel = fs.readFileSync(commonDirFile, 'utf8').trim();
      commonDir = path.isAbsolute(rel) ? rel : path.resolve(gitDir, rel);
    }
    for (const base of [gitDir, commonDir]) {
      const refPath = path.join(base, refName);
      if (fs.existsSync(refPath)) {
        const sha = fs.readFileSync(refPath, 'utf8').trim();
        if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
      }
    }
    // Packed refs fallback.
    const packed = path.join(commonDir, 'packed-refs');
    if (!fs.existsSync(packed)) return null;
    const lines = fs.readFileSync(packed, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('#') || line.startsWith('^')) continue;
      const [sha, ref] = line.split(/\s+/);
      if (ref === refName && /^[0-9a-f]{40}$/i.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

function findLatestTimestamp(entries) {
  return entries.reduce((latest, entry) => {
    const timestamp = normalizeText(entry && entry.timestamp);
    if (!timestamp) return latest;
    if (!latest) return timestamp;
    return new Date(timestamp).getTime() > new Date(latest).getTime() ? timestamp : latest;
  }, null);
}

function buildReviewSnapshot(feedbackDir, options = {}) {
  const feedbackEntries = Array.isArray(options.feedbackEntries)
    ? options.feedbackEntries
    : readJSONL(path.join(feedbackDir, 'feedback-log.jsonl'));
  const memoryEntries = Array.isArray(options.memoryEntries)
    ? options.memoryEntries
    : readJSONL(path.join(feedbackDir, 'memory-log.jsonl'));
  const auditEntries = Array.isArray(options.auditEntries)
    ? options.auditEntries
    : readJSONL(path.join(feedbackDir, AUDIT_LOG_FILENAME));
  const projectRoot = options.projectRoot === undefined
    ? inferProjectRootFromFeedbackDir(feedbackDir)
    : options.projectRoot;

  return {
    reviewedAt: options.reviewedAt || new Date().toISOString(),
    feedbackCount: feedbackEntries.length,
    positiveCount: feedbackEntries.filter((entry) => entry.signal === 'positive').length,
    negativeCount: feedbackEntries.filter((entry) => entry.signal === 'negative').length,
    lessonCount: memoryEntries.length,
    blockedCount: auditEntries.filter((entry) => entry && entry.decision === 'deny').length,
    warnedCount: auditEntries.filter((entry) => entry && entry.decision === 'warn').length,
    latestFeedbackAt: findLatestTimestamp(feedbackEntries),
    latestLessonAt: findLatestTimestamp(memoryEntries),
    gitHead: readGitHead(projectRoot),
  };
}

function readDashboardReviewState(feedbackDir) {
  return readJsonFile(getDashboardReviewStatePath(feedbackDir));
}

function writeDashboardReviewState(feedbackDir, snapshot) {
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(getDashboardReviewStatePath(feedbackDir), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

function selectLatestRecord(entries, mapper) {
  let latest = null;
  let latestTime = -Infinity;
  for (const entry of entries) {
    const timestamp = normalizeText(entry && entry.timestamp);
    if (!timestamp) continue;
    const currentTime = new Date(timestamp).getTime();
    if (Number.isNaN(currentTime) || currentTime < latestTime) continue;
    latest = mapper(entry);
    latestTime = currentTime;
  }
  return latest;
}

function summarizeReviewDelta(feedbackEntries, memoryEntries, auditEntries, baseline, currentSnapshot) {
  const noBaselineSummary = {
    hasBaseline: false,
    reviewedAt: null,
    previousHead: null,
    currentHead: currentSnapshot.gitHead || null,
    feedbackAdded: feedbackEntries.length,
    negativeAdded: feedbackEntries.filter((entry) => entry.signal === 'negative').length,
    lessonsAdded: memoryEntries.length,
    blocksAdded: auditEntries.filter((entry) => entry && entry.decision === 'deny').length,
    warnsAdded: auditEntries.filter((entry) => entry && entry.decision === 'warn').length,
    headline: 'No review checkpoint yet. Mark the current dashboard as reviewed to start seeing only new changes.',
    latestFeedback: selectLatestRecord(feedbackEntries, (entry) => ({
      title: pickFirstText(entry.title, entry.context, entry.whatWentWrong, entry.whatWorked) || 'Feedback event',
      timestamp: entry.timestamp,
      signal: entry.signal || null,
    })),
    latestLesson: selectLatestRecord(memoryEntries, (entry) => ({
      title: pickFirstText(entry.title, entry.content) || 'Lesson event',
      timestamp: entry.timestamp,
      category: entry.category || null,
    })),
  };

  if (!baseline || !baseline.reviewedAt) return noBaselineSummary;

  const reviewedAtMs = new Date(baseline.reviewedAt).getTime();
  if (!Number.isFinite(reviewedAtMs)) return noBaselineSummary;

  const isAfterBaseline = (entry) => {
    const timestamp = entry && entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
    return Number.isFinite(timestamp) && timestamp > reviewedAtMs;
  };
  const newFeedback = feedbackEntries.filter(isAfterBaseline);
  const newLessons = memoryEntries.filter(isAfterBaseline);
  const newAudit = auditEntries.filter(isAfterBaseline);
  const reviewFeedback = newFeedback.some((entry) => entry.signal === 'negative')
    ? newFeedback.filter((entry) => entry.signal === 'negative')
    : newFeedback;
  const feedbackAdded = newFeedback.length;
  const negativeAdded = newFeedback.filter((entry) => entry.signal === 'negative').length;
  const lessonsAdded = newLessons.length;
  const blocksAdded = newAudit.filter((entry) => entry && entry.decision === 'deny').length;
  const warnsAdded = newAudit.filter((entry) => entry && entry.decision === 'warn').length;
  let headline = 'No new review activity since your last checkpoint.';

  if (feedbackAdded || lessonsAdded || blocksAdded || warnsAdded) {
    const parts = [];
    if (feedbackAdded) parts.push(`${feedbackAdded} feedback event${feedbackAdded === 1 ? '' : 's'}`);
    if (negativeAdded) parts.push(`${negativeAdded} negative`);
    if (lessonsAdded) parts.push(`${lessonsAdded} lesson${lessonsAdded === 1 ? '' : 's'}`);
    if (blocksAdded) parts.push(`${blocksAdded} gate block${blocksAdded === 1 ? '' : 's'}`);
    if (warnsAdded) parts.push(`${warnsAdded} warning${warnsAdded === 1 ? '' : 's'}`);
    headline = `Since your last review: ${parts.join(' · ')}.`;
  }

  return {
    hasBaseline: true,
    reviewedAt: baseline.reviewedAt,
    previousHead: baseline.gitHead || null,
    currentHead: currentSnapshot.gitHead || null,
    feedbackAdded,
    negativeAdded,
    lessonsAdded,
    blocksAdded,
    warnsAdded,
    headline,
    latestFeedback: selectLatestRecord(reviewFeedback, (entry) => ({
      title: pickFirstText(entry.title, entry.context, entry.whatWentWrong, entry.whatWorked) || 'Feedback event',
      timestamp: entry.timestamp,
      signal: entry.signal || null,
    })),
    latestLesson: selectLatestRecord(newLessons, (entry) => ({
      title: pickFirstText(entry.title, entry.content) || 'Lesson event',
      timestamp: entry.timestamp,
      category: entry.category || null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Approval rate + trend
// ---------------------------------------------------------------------------

function computeApprovalStats(entries) {
  const total = entries.length;
  const positive = entries.filter((e) => e.signal === 'positive').length;
  const negative = entries.filter((e) => e.signal === 'negative').length;
  const approvalRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  // 7-day trend
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentEntries = entries.filter((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    return ts >= sevenDaysAgo;
  });
  const recentPositive = recentEntries.filter((e) => e.signal === 'positive').length;
  const recentRate = recentEntries.length > 0
    ? Math.round((recentPositive / recentEntries.length) * 100)
    : approvalRate;

  let trendDirection = 'stable';
  const diff = recentRate - approvalRate;
  if (diff > 5) trendDirection = 'improving';
  else if (diff < -5) trendDirection = 'declining';

  return {
    total,
    positive,
    negative,
    approvalRate,
    recentRate,
    trendDirection,
  };
}

// ---------------------------------------------------------------------------
// Gate enforcement stats
// ---------------------------------------------------------------------------

function computeGateStats() {
  const autoGatesPath = getAutoGatesPath();
  const statsPath = path.join(
    process.env.HOME || '/tmp',
    '.thumbgate',
    'gate-stats.json'
  );
  const stats = readJsonFile(statsPath) || { blocked: 0, warned: 0, passed: 0, byGate: {} };

  // Count manual vs auto-promoted gates
  const defaultGates = readJsonFile(DEFAULT_GATES_PATH);
  const autoGates = readJsonFile(autoGatesPath);
  const manualCount = defaultGates && Array.isArray(defaultGates.gates) ? defaultGates.gates.length : 0;
  const autoCount = autoGates && Array.isArray(autoGates.gates) ? autoGates.gates.length : 0;
  const totalGates = manualCount + autoCount;

  // Top blocked gate
  let topBlocked = null;
  let topBlockedCount = 0;
  if (stats.byGate) {
    for (const [gateId, gateStat] of Object.entries(stats.byGate)) {
      const blocked = gateStat.blocked || 0;
      if (blocked > topBlockedCount) {
        topBlockedCount = blocked;
        topBlocked = gateId;
      }
    }
  }

  return {
    totalGates,
    manualCount,
    autoCount,
    blocked: stats.blocked || 0,
    warned: stats.warned || 0,
    passed: stats.passed || 0,
    topBlocked,
    topBlockedCount,
    byGate: stats.byGate || {},
  };
}

function computeGateAuditSeries(feedbackDir, options = {}) {
  const auditLogPath = path.join(feedbackDir, AUDIT_LOG_FILENAME);
  const entries = readJSONL(auditLogPath).filter((entry) => entry && entry.timestamp);
  const dayCount = Number.isInteger(options.dayCount) ? options.dayCount : 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const countsByDay = new Map();

  for (const entry of entries) {
    if (!['allow', 'deny', 'warn'].includes(entry.decision)) continue;
    const dayKey = toLocalDayKey(entry.timestamp);
    if (!dayKey) continue;
    if (!countsByDay.has(dayKey)) {
      countsByDay.set(dayKey, { allow: 0, deny: 0, warn: 0 });
    }
    countsByDay.get(dayKey)[entry.decision] += 1;
  }

  const days = [];
  const totals = { allow: 0, deny: 0, warn: 0, intercepted: 0, total: 0 };

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const dayKey = toLocalDayKey(day);
    const record = countsByDay.get(dayKey) || { allow: 0, deny: 0, warn: 0 };
    const intercepted = record.deny + record.warn;
    const total = intercepted + record.allow;
    const summary = {
      dayKey,
      allow: record.allow,
      deny: record.deny,
      warn: record.warn,
      intercepted,
      total,
    };
    totals.allow += record.allow;
    totals.deny += record.deny;
    totals.warn += record.warn;
    totals.intercepted += intercepted;
    totals.total += total;
    days.push(summary);
  }

  return {
    dayCount,
    days,
    totals,
    activeDays: days.filter((day) => day.total > 0).length,
  };
}

function listActiveGates() {
  try {
    const config = loadGatesConfig();
    return (config.gates || []).map((gate) => ({
      id: gate.id || null,
      name: gate.id || gate.pattern || 'gate',
      pattern: gate.pattern || '',
      action: gate.action || 'warn',
      severity: gate.severity || 'medium',
      layer: gate.layer || null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Prevention impact
// ---------------------------------------------------------------------------

function computePreventionImpact(feedbackDir, gateStats) {
  const autoGatesPath = getAutoGatesPath();
  const preventionRulesPath = path.join(feedbackDir, 'prevention-rules.md');
  let ruleCount = 0;
  if (fs.existsSync(preventionRulesPath)) {
    const content = fs.readFileSync(preventionRulesPath, 'utf-8');
    const headers = content.match(/^## /gm);
    ruleCount = headers ? headers.length : 0;
  }

  // Estimate time saved: ~16 min per blocked action (conservative)
  const estimatedMinutesSaved = gateStats.blocked * 16;
  const estimatedHoursSaved = (estimatedMinutesSaved / 60).toFixed(1);

  // Last auto-promotion
  const autoGates = readJsonFile(autoGatesPath);
  let lastPromotion = null;
  if (autoGates && Array.isArray(autoGates.promotionLog) && autoGates.promotionLog.length > 0) {
    const sorted = autoGates.promotionLog
      .filter((p) => p.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (sorted.length > 0) {
      const last = sorted[0];
      const daysAgo = Math.round((Date.now() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60 * 24));
      lastPromotion = { id: last.gateId || last.id || 'unknown', daysAgo };
    }
  }

  return {
    estimatedHoursSaved,
    ruleCount,
    lastPromotion,
  };
}

// ---------------------------------------------------------------------------
// Feedback time series (daily up/down for charts)
// ---------------------------------------------------------------------------

function computeFeedbackTimeSeries(entries, dayCount = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const dayKey = toLocalDayKey(day);
    days.push({ dayKey, up: 0, down: 0, lessons: 0 });
  }

  const dayMap = new Map(days.map((d) => [d.dayKey, d]));

  for (const entry of entries) {
    if (!entry.timestamp) continue;
    const dayKey = toLocalDayKey(entry.timestamp);
    const bucket = dayMap.get(dayKey);
    if (!bucket) continue;
    const signal = String(entry.signal || entry.feedback || '').toLowerCase();
    if (['up', 'positive', 'thumbs_up'].includes(signal)) bucket.up += 1;
    else if (['down', 'negative', 'thumbs_down'].includes(signal)) bucket.down += 1;
  }

  return { dayCount, days };
}

function isAuditTrailEntry(entry) {
  return Array.isArray(entry.tags) && entry.tags.includes('audit-trail');
}

// ---------------------------------------------------------------------------
// Lesson pipeline (feedback → lesson → gate conversion)
// ---------------------------------------------------------------------------

function computeLessonPipeline(feedbackDir, entries, gateStats) {
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const memories = readJSONL(memoryLogPath);

  const totalFeedback = entries.length;
  const totalNegative = entries.filter((e) => {
    const s = String(e.signal || e.feedback || '').toLowerCase();
    return ['down', 'negative', 'thumbs_down'].includes(s);
  }).length;
  const totalPositive = totalFeedback - totalNegative;

  const totalLessons = memories.filter((m) => m.category === 'error' || m.category === 'learning').length;
  const errorLessons = memories.filter((m) => m.category === 'error').length;
  const learningLessons = memories.filter((m) => m.category === 'learning').length;

  const autoGatesPath = getAutoGatesPath();
  const autoGates = readJsonFile(autoGatesPath);
  const promotedGates = autoGates && Array.isArray(autoGates.gates) ? autoGates.gates.length : 0;

  const feedbackToLessonRate = totalFeedback > 0
    ? Math.round((totalLessons / totalFeedback) * 100) : 0;
  const lessonToGateRate = totalLessons > 0
    ? Math.min(100, Math.round((promotedGates / totalLessons) * 100)) : 0;
  const totalBlocked = gateStats.blocked || 0;

  // Populate lesson counts onto the time series if available
  const lessonsByDay = new Map();
  for (const m of memories) {
    if (!m.timestamp) continue;
    const dayKey = toLocalDayKey(m.timestamp);
    if (dayKey) lessonsByDay.set(dayKey, (lessonsByDay.get(dayKey) || 0) + 1);
  }

  return {
    stages: [
      { id: 'feedback', label: 'Feedback Signals', count: totalFeedback, detail: `${totalPositive} up / ${totalNegative} down` },
      { id: 'lessons', label: 'Lessons Distilled', count: totalLessons, detail: `${errorLessons} mistakes / ${learningLessons} good patterns` },
      { id: 'gates', label: 'Gates Promoted', count: promotedGates, detail: `${lessonToGateRate}% of lessons become gates` },
      { id: 'blocked', label: 'Actions Blocked', count: totalBlocked, detail: `Repeat mistakes prevented` },
    ],
    rates: {
      feedbackToLesson: feedbackToLessonRate,
      lessonToGate: lessonToGateRate,
    },
    lessonsByDay,
  };
}

// ---------------------------------------------------------------------------
// Session trend (last N sessions)
// ---------------------------------------------------------------------------

function computeSessionTrend(entries, windowCount) {
  if (entries.length < 10) return { bars: '', percentage: 0 };
  const windowSize = Math.max(1, Math.floor(entries.length / windowCount));
  const windows = [];
  for (let i = 0; i + windowSize <= entries.length; i += windowSize) {
    const slice = entries.slice(i, i + windowSize);
    const pos = slice.filter((e) => e.signal === 'positive').length;
    windows.push(Math.round((pos / slice.length) * 100));
  }
  const recent = windows.slice(-windowCount);
  const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
  const filledBlocks = Math.round((avg / 100) * windowCount);
  const bars = '\u2588'.repeat(filledBlocks) + '\u2591'.repeat(windowCount - filledBlocks);
  return { bars, percentage: avg };
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

function computeSystemHealth(feedbackDir, gateStats) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

  const feedbackCount = readJSONL(feedbackLogPath).length;
  const memoryCount = readJSONL(memoryLogPath).length;

  return {
    feedbackCount,
    memoryCount,
    gateConfigLoaded: gateStats.totalGates > 0,
    gateCount: gateStats.totalGates,
    mcpServerRunning: true, // If dashboard is running, server is available
  };
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function computeEfficiencyMetrics(feedbackDir) {
  const provenanceDir = path.join(feedbackDir, 'contextfs', 'provenance');
  const packs = readJSONL(path.join(provenanceDir, 'packs.jsonl'));
  const cacheHits = packs.filter((pack) => pack && pack.cache && pack.cache.hit === true);
  const similarities = cacheHits
    .map((pack) => Number(pack.cache && pack.cache.similarity))
    .filter((value) => Number.isFinite(value));
  const estimatedContextCharsReused = cacheHits.reduce((sum, pack) => {
    const usedChars = Number(pack && pack.usedChars);
    return sum + (Number.isFinite(usedChars) ? usedChars : 0);
  }, 0);

  return {
    semanticCacheEnabled: process.env.THUMBGATE_SEMANTIC_CACHE_ENABLED !== 'false',
    contextPackRequests: packs.length,
    semanticCacheHits: cacheHits.length,
    semanticCacheHitRate: safeRate(cacheHits.length, packs.length),
    averageSemanticSimilarity: similarities.length > 0
      ? Number((similarities.reduce((sum, value) => sum + value, 0) / similarities.length).toFixed(4))
      : 0,
    estimatedContextCharsReused,
    estimatedContextTokensReused: Math.round(estimatedContextCharsReused / 4),
  };
}

function resolveJourneyKey(entry = {}) {
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
  const attribution = entry.attribution && typeof entry.attribution === 'object' ? entry.attribution : {};
  return pickFirstText(
    entry.acquisitionId,
    metadata.acquisitionId,
    attribution.acquisitionId,
    entry.traceId,
    metadata.traceId,
    entry.installId,
    metadata.installId,
    entry.visitorId,
    metadata.visitorId,
    entry.sessionId,
    metadata.sessionId,
    entry.orderId,
    entry.evidence
  );
}

function countCoverage(entries, resolver) {
  if (!entries.length) return 0;
  const matched = entries.filter((entry) => resolver(entry)).length;
  return safeRate(matched, entries.length);
}

function sumCounterValues(counter = {}) {
  return Object.values(counter).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function sumKeysMatching(counter = {}, matcher) {
  return Object.entries(counter).reduce((sum, entry) => {
    const [key, value] = entry;
    return matcher(key) ? sum + (Number(value) || 0) : sum;
  }, 0);
}

function rankCounter(counter = {}, limit = 5) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function mapBuyerLossTheme(reasonCode) {
  const normalized = String(reasonCode || 'unknown').toLowerCase();
  if (['too_expensive', 'price_shock', 'budget', 'need_budget_approval'].includes(normalized)) {
    return 'pricing';
  }
  if (['need_more_proof', 'trust_gap', 'security_unclear'].includes(normalized)) {
    return 'trust';
  }
  if (['not_ready', 'later', 'just_researching'].includes(normalized)) {
    return 'timing';
  }
  if (['need_team_features', 'need_team_approval'].includes(normalized)) {
    return 'team';
  }
  if (['integration_unclear', 'setup_confusing'].includes(normalized)) {
    return 'integration';
  }
  if (['prefer_oss'].includes(normalized)) {
    return 'open_source';
  }
  return 'unknown';
}

function buildLossAnalysis(analytics) {
  const telemetry = analytics.telemetry || {};
  const visitors = telemetry.visitors || {};
  const ctas = telemetry.ctas || {};
  const behavior = telemetry.behavior || {};
  const buyerLoss = analytics.buyerLoss || {};
  const conversionFunnel = telemetry.conversionFunnel || {};
  const runtimeConfig = resolveHostedBillingConfig();
  const monthlyPriceCents = Math.round((Number(runtimeConfig.proPriceDollars) || 19) * 100);
  const pageViews = visitors.pageViews || 0;
  const checkoutStarts = ctas.checkoutStarts || 0;
  const paidOrders = analytics.funnel ? analytics.funnel.paidOrders || 0 : 0;
  const trialEmails = conversionFunnel.trialEmails || 0;
  const explicitReasons = buyerLoss.reasonsByCode || {};
  const reasonThemes = {};
  Object.entries(explicitReasons).forEach(([reasonCode, count]) => {
    const theme = mapBuyerLossTheme(reasonCode);
    reasonThemes[theme] = (reasonThemes[theme] || 0) + count;
  });

  const proImpressions = sumKeysMatching(behavior.ctaImpressionsById || {}, (key) => /pro|pricing/i.test(key));
  const proClicks = sumKeysMatching(ctas.byId || {}, (key) => /pro|pricing/i.test(key));
  const pricingViews = sumKeysMatching(behavior.sectionViewsById || {}, (key) => /pricing/i.test(key));
  const proofViews = sumKeysMatching(behavior.sectionViewsById || {}, (key) => /proof/i.test(key));
  const exitsBeforePricing = sumKeysMatching(behavior.exitsByLastVisibleSection || {}, (key) => !/pricing|faq/i.test(key));
  const checkoutLossCount = Math.max(0, checkoutStarts - paidOrders);

  const stageDropoff = [
    {
      key: 'landing_to_checkout',
      stage: 'landing',
      lostCount: Math.max(0, pageViews - checkoutStarts),
      rate: safeRate(Math.max(0, pageViews - checkoutStarts), pageViews),
    },
    {
      key: 'cta_impression_to_click',
      stage: 'message',
      lostCount: Math.max(0, proImpressions - proClicks),
      rate: safeRate(Math.max(0, proImpressions - proClicks), proImpressions),
    },
    {
      key: 'email_focus_to_capture',
      stage: 'lead_capture',
      lostCount: Math.max(0, (behavior.emailFocusEvents || 0) - trialEmails),
      rate: safeRate(Math.max(0, (behavior.emailFocusEvents || 0) - trialEmails), behavior.emailFocusEvents || 0),
    },
    {
      key: 'checkout_to_paid',
      stage: 'checkout',
      lostCount: checkoutLossCount,
      rate: safeRate(checkoutLossCount, checkoutStarts),
    },
  ].sort((a, b) => b.lostCount - a.lostCount);

  const inferredCauses = [];
  if (exitsBeforePricing > 0) {
    inferredCauses.push({
      key: 'message_drop_before_pricing',
      stage: 'landing',
      count: exitsBeforePricing,
      evidence: {
        topExitSection: behavior.topExitSection,
        pricingViews,
        pageExits: behavior.pageExits || 0,
      },
    });
  }
  if (proImpressions > 0 && proClicks < proImpressions) {
    inferredCauses.push({
      key: 'weak_pricing_cta_response',
      stage: 'message',
      count: Math.max(0, proImpressions - proClicks),
      evidence: {
        proImpressions,
        proClicks,
        impressionToClickRate: safeRate(proClicks, proImpressions),
      },
    });
  }
  if ((behavior.emailAbandonEvents || 0) > 0) {
    inferredCauses.push({
      key: 'email_capture_friction',
      stage: 'lead_capture',
      count: behavior.emailAbandonEvents || 0,
      evidence: {
        emailFocusEvents: behavior.emailFocusEvents || 0,
        emailAbandonEvents: behavior.emailAbandonEvents || 0,
        emailAbandonRate: behavior.emailAbandonRate || 0,
      },
    });
  }
  if (checkoutLossCount > 0 || ctas.checkoutFailures || ctas.lookupFailures || ctas.checkoutCancelled || ctas.checkoutAbandoned) {
    inferredCauses.push({
      key: 'checkout_friction',
      stage: 'checkout',
      count: checkoutLossCount,
      evidence: {
        checkoutStarts,
        paidOrders,
        checkoutCancelled: ctas.checkoutCancelled || 0,
        checkoutAbandoned: ctas.checkoutAbandoned || 0,
        checkoutFailures: ctas.checkoutFailures || 0,
        lookupFailures: ctas.lookupFailures || 0,
      },
    });
  }
  const topTheme = rankCounter(reasonThemes, 1)[0] || null;
  if (topTheme) {
    inferredCauses.push({
      key: `explicit_${topTheme.key}`,
      stage: topTheme.key === 'pricing' ? 'pricing' : 'objection',
      count: topTheme.count,
      evidence: {
        theme: topTheme.key,
        topReasons: rankCounter(explicitReasons, 3),
      },
    });
  }

  inferredCauses.sort((a, b) => b.count - a.count);

  return {
    primaryIssue: inferredCauses[0] || null,
    stageDropoff,
    inferredCauses,
    explicitThemes: rankCounter(reasonThemes, 6),
    explicitReasons: rankCounter(explicitReasons, 6),
    behaviorSignals: {
      topViewedSection: behavior.topViewedSection || null,
      topExitSection: behavior.topExitSection || null,
      topExitDwellBucket: behavior.topExitDwellBucket || null,
      topImpressionCta: behavior.topImpressionCta || null,
      pricingViews,
      proofViews,
      pageExits: behavior.pageExits || 0,
      exitsBeforePricing,
      averageExitEngagementMs: behavior.averageExitEngagementMs || 0,
      averageExitScrollPercent: behavior.averageExitScrollPercent || 0,
      emailFocusEvents: behavior.emailFocusEvents || 0,
      emailAbandonEvents: behavior.emailAbandonEvents || 0,
    },
    revenueOpportunity: {
      currentMonthlyPriceCents: monthlyPriceCents,
      checkoutLossCount,
      explicitBuyerLossCount: buyerLoss.totalSignals || 0,
      opportunityAtCurrentMonthlyPriceCents: checkoutLossCount * monthlyPriceCents,
    },
  };
}

function computeAnalyticsSummary(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options.analyticsWindow || options);
  const telemetryEntries = filterEntriesForWindow(
    loadTelemetryEvents(feedbackDir),
    analyticsWindow,
    (entry) => entry && (entry.receivedAt || entry.timestamp)
  );
  const telemetry = getTelemetryAnalytics(feedbackDir, analyticsWindow);
  const billing = options.billingSummary || getBillingSummary(analyticsWindow);
  const funnelEntries = filterEntriesForWindow(
    loadFunnelLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  );
  const paidOrderEntries = filterEntriesForWindow(
    loadResolvedRevenueEvents(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  ).filter((entry) => entry && entry.status === 'paid');
  const efficiency = computeEfficiencyMetrics(feedbackDir);
  const northStar = summarizeWorkflowRuns(feedbackDir);
  const uniqueVisitors = telemetry.visitors.uniqueVisitors;
  const ctaClicks = telemetry.ctas.totalClicks;
  const checkoutStarts = telemetry.ctas.checkoutStarts || 0;
  const acquisitionLeads = billing.signups ? billing.signups.uniqueLeads || 0 : 0;
  const paidOrders = billing.revenue ? billing.revenue.paidOrders || 0 : 0;
  const checkoutStartEntries = telemetryEntries.filter((entry) => {
    const eventType = entry.eventType || entry.event;
    return eventType === 'checkout_start' || eventType === 'checkout_bootstrap';
  });
  const acquisitionEntries = funnelEntries.filter((entry) => entry && entry.stage === 'acquisition');
  const checkoutKeys = new Set(checkoutStartEntries.map(resolveJourneyKey).filter(Boolean));
  const acquisitionKeys = new Set(acquisitionEntries.map(resolveJourneyKey).filter(Boolean));
  const matchedAcquisitionKeys = new Set([...checkoutKeys].filter((key) => acquisitionKeys.has(key)));
  const matchedPaidOrders = paidOrderEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return key && checkoutKeys.has(key);
  }).length;
  const unmatchedCheckoutStarts = checkoutStartEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return !key || !acquisitionKeys.has(key);
  }).length;
  const paidWithoutAcquisition = paidOrderEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return !key || !acquisitionKeys.has(key);
  }).length;
  const stitchedJourneyEntries = [...checkoutStartEntries, ...acquisitionEntries, ...paidOrderEntries];

  return {
    window: telemetry.window || analyticsWindow,
    telemetry,
    funnel: {
      visitors: uniqueVisitors,
      sessions: telemetry.visitors ? telemetry.visitors.uniqueSessions || 0 : 0,
      pageViews: telemetry.visitors ? telemetry.visitors.pageViews || 0 : 0,
      ctaClicks,
      checkoutStarts,
      acquisitionLeads,
      paidOrders,
      visitorToLeadRate: safeRate(acquisitionLeads, uniqueVisitors),
      visitorToPaidRate: safeRate(paidOrders, uniqueVisitors),
      ctaToLeadRate: safeRate(acquisitionLeads, ctaClicks),
      ctaToPaidRate: safeRate(paidOrders, ctaClicks),
      topTrafficChannel: telemetry.visitors ? telemetry.visitors.topTrafficChannel || null : null,
      checkoutConversionByTrafficChannel: telemetry.ctas ? telemetry.ctas.conversionByTrafficChannel || {} : {},
    },
    buyerLoss: telemetry.buyerLoss || {
      totalSignals: 0,
      reasonsByCode: {},
      cancellationReasons: {},
      abandonmentReasons: {},
      topReason: null,
    },
    pricing: telemetry.pricing || {
      pricingInterestEvents: 0,
      interestByLevel: {},
    },
    seo: telemetry.seo || {
      landingViews: 0,
      bySurface: {},
      byQuery: {},
      topSurface: null,
      topQuery: null,
    },
    trackedLinks: telemetry.trackedLinks || {
      totalHits: 0,
      totalCheckoutStarts: 0,
      overallConversionRate: 0,
      bySlug: {},
      topSlug: null,
    },
    efficiency,
    revenue: billing.revenue || {
      paidProviderEvents: 0,
      paidOrders: 0,
      bookedRevenueCents: 0,
      amountKnownOrders: 0,
      amountUnknownOrders: 0,
      amountKnownCoverageRate: 0,
    },
    attribution: billing.attribution || {
      acquisitionBySource: {},
      acquisitionByCampaign: {},
      paidBySource: {},
      paidByCampaign: {},
      bookedRevenueBySourceCents: {},
      bookedRevenueByCampaignCents: {},
      bookedRevenueByCtaId: {},
      bookedRevenueByLandingPath: {},
      bookedRevenueByReferrerHost: {},
      conversionBySource: {},
      conversionByCampaign: {},
    },
    pipeline: billing.pipeline || {
      workflowSprintLeads: { total: 0, bySource: {} },
      qualifiedWorkflowSprintLeads: { total: 0, bySource: {} },
    },
    northStar,
    trafficMetrics: billing.trafficMetrics || {
      visitors: 0,
      sessions: 0,
      pageViews: 0,
      ctaClicks: 0,
      checkoutStarts: 0,
      buyerLossFeedback: 0,
      seoLandingViews: 0,
    },
    operatorGeneratedAcquisition: billing.operatorGeneratedAcquisition || {
      totalEvents: 0,
      uniqueLeads: 0,
      bySource: {},
    },
    dataQuality: billing.dataQuality || {
      telemetryCoverage: 0,
      attributionCoverage: 0,
      amountKnownCoverage: 0,
      unreconciledPaidEvents: 0,
    },
    reconciliation: {
      telemetryCheckoutStarts: checkoutStarts,
      uniqueCheckoutStarters: telemetry.ctas.uniqueCheckoutStarters,
      matchedAcquisitions: matchedAcquisitionKeys.size,
      matchedPaidOrders,
      unmatchedCheckoutStarts,
      paidWithoutAcquisition,
      paidWithoutAmount: paidOrderEntries.filter((entry) => !entry.amountKnown).length,
    },
    identityCoverage: {
      visitorIdCoverage: telemetry.visitors.visitorIdCoverageRate,
      sessionIdCoverage: telemetry.visitors.sessionIdCoverageRate,
      acquisitionIdCoverage: countCoverage(
        stitchedJourneyEntries,
        (entry) => pickFirstText(entry.acquisitionId, entry.metadata && entry.metadata.acquisitionId)
      ),
      amountKnownCoverage: billing.revenue ? billing.revenue.amountKnownCoverageRate || 0 : 0,
    },
  };
}

function computeSecretGuardStats(diagnosticEntries) {
  const secretEntries = diagnosticEntries.filter((entry) => {
    if (entry.source === 'secret_guard') return true;
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    return violations.some((violation) => String(violation.constraintId || '').startsWith('security:'));
  });

  const byConstraint = {};
  for (const entry of secretEntries) {
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    for (const violation of violations) {
      const key = String(violation.constraintId || 'security:unknown');
      byConstraint[key] = (byConstraint[key] || 0) + 1;
    }
  }

  const topConstraint = Object.entries(byConstraint)
    .sort((a, b) => b[1] - a[1])[0] || null;

  return {
    blocked: secretEntries.length,
    topConstraint: topConstraint ? { key: topConstraint[0], count: topConstraint[1] } : null,
    recent: secretEntries
      .slice(-5)
      .reverse()
      .map((entry) => ({
        step: entry.step || null,
        source: entry.source || null,
        timestamp: entry.timestamp || null,
      })),
  };
}

function computeObservabilityStats(diagnosticEntries, diagnostics, secretGuard, telemetry = null) {
  const bySource = {};
  let latestEventAt = null;

  for (const entry of diagnosticEntries) {
    const key = String(entry.source || 'unknown');
    bySource[key] = (bySource[key] || 0) + 1;
    if (!latestEventAt || String(entry.timestamp || '') > latestEventAt) {
      latestEventAt = entry.timestamp || null;
    }
  }

  const topSource = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    diagnosticEvents: diagnosticEntries.length,
    bySource,
    topSource: topSource ? { key: topSource[0], count: topSource[1] } : null,
    latestEventAt,
    topRootCause: diagnostics.categories[0] || null,
    secretGuardBlocks: secretGuard.blocked,
    telemetryIngestErrors: diagnosticEntries.filter((entry) => entry.source === 'telemetry_ingest').length,
    checkoutApiFailuresByCode: telemetry && telemetry.ctas ? telemetry.ctas.failuresByCode || {} : {},
    buyerLossSignals: telemetry && telemetry.buyerLoss ? telemetry.buyerLoss.totalSignals || 0 : 0,
    topBuyerLossReason: telemetry && telemetry.buyerLoss ? telemetry.buyerLoss.topReason || null : null,
    seoLandingViews: telemetry && telemetry.seo ? telemetry.seo.landingViews || 0 : 0,
  };
}

function computeInstrumentationReadiness(analytics, billing) {
  const landingPage = fs.existsSync(LANDING_PAGE_PATH)
    ? fs.readFileSync(LANDING_PAGE_PATH, 'utf-8')
    : '';
  const runtimeConfig = resolveHostedBillingConfig();
  const coverage = billing && billing.coverage ? billing.coverage : {};
  const telemetry = analytics.telemetry || {};
  const visitors = telemetry.visitors || {};
  const cli = telemetry.cli || {};

  return {
    plausibleConfigured: /plausible\.io\/js\/script\.js|\/js\/analytics\.js/.test(landingPage),
    ga4Configured: Boolean(runtimeConfig.gaMeasurementId),
    googleSearchConsoleConfigured: Boolean(runtimeConfig.googleSiteVerification),
    softwareApplicationSchemaPresent: /"@type": "SoftwareApplication"/.test(landingPage),
    faqSchemaPresent: /"@type": "FAQPage"/.test(landingPage),
    telemetryEventsPresent: (telemetry.totalEvents || 0) > 0,
    uniqueVisitorsTracked: visitors.uniqueVisitors || 0,
    cliInstallsTracked: cli.uniqueInstalls || 0,
    funnelEventsPresent: (analytics.reconciliation.telemetryCheckoutStarts || 0) > 0,
    seoSignalsPresent: (analytics.seo.landingViews || 0) > 0,
    buyerLossSignalsPresent: (analytics.buyerLoss.totalSignals || 0) > 0,
    trafficAttributionCoverage: visitors.attributionCoverageRate || 0,
    bookedRevenueTrackingEnabled: Boolean(coverage.tracksBookedRevenue),
    paidOrderTrackingEnabled: Boolean(coverage.tracksPaidOrders),
    invoiceTrackingEnabled: Boolean(coverage.tracksInvoices),
    attributionTrackingEnabled: Boolean(coverage.tracksAttribution),
  };
}

function priorityWeight(priority) {
  return ({
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  })[String(priority || '').toLowerCase()] || 0;
}

function detectRepeatFailurePressure(entries) {
  const negativeEntries = entries.filter((entry) => entry && entry.signal === 'negative');
  if (!negativeEntries.length) {
    return {
      negativeCount: 0,
      repeatedCount: 0,
      repeatFailureRate: 0,
      topPattern: null,
    };
  }

  const buckets = new Map();
  for (const entry of negativeEntries) {
    const tags = Array.isArray(entry.tags) ? entry.tags.filter(Boolean).map((tag) => String(tag).toLowerCase()).sort() : [];
    const diagnosis = entry.diagnosis && entry.diagnosis.rootCauseCategory
      ? String(entry.diagnosis.rootCauseCategory).toLowerCase()
      : '';
    const context = pickFirstText(entry.context, entry.whatWentWrong, entry.whatToChange) || '';
    const normalizedContext = context.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    const key = diagnosis || (tags.length ? tags.join('|') : normalizedContext || 'uncategorized-negative');
    const bucket = buckets.get(key) || { key, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const repeated = [...buckets.values()].filter((bucket) => bucket.count >= 2);
  const repeatedCount = repeated.reduce((sum, bucket) => sum + bucket.count, 0);
  const topPattern = repeated.sort((a, b) => b.count - a.count)[0] || null;

  return {
    negativeCount: negativeEntries.length,
    repeatedCount,
    repeatFailureRate: safeRate(repeatedCount, negativeEntries.length),
    topPattern,
  };
}

function aggregateHarnessRecommendations(lessons, limit = 3) {
  const grouped = new Map();

  for (const lesson of lessons) {
    for (const recommendation of lesson.systemResponse && lesson.systemResponse.harnessRecommendations || []) {
      const key = recommendation.type;
      const current = grouped.get(key) || {
        type: recommendation.type,
        count: 0,
        priority: recommendation.priority,
        priorityScore: 0,
        action: recommendation.action,
        reason: recommendation.reason,
        exampleLessonId: lesson.id,
        exampleLessonTitle: lesson.title,
      };
      current.count += 1;
      const score = priorityWeight(recommendation.priority);
      if (score >= current.priorityScore) {
        current.priority = recommendation.priority;
        current.priorityScore = score;
        current.action = recommendation.action;
        current.reason = recommendation.reason;
        current.exampleLessonId = lesson.id;
        current.exampleLessonTitle = lesson.title;
      }
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (b.count !== a.count) return b.count - a.count;
      return String(a.type).localeCompare(String(b.type));
    })
    .slice(0, limit)
    .map(({ priorityScore, ...recommendation }) => recommendation);
}

function computeHarnessOverview(feedbackDir, entries) {
  const lessons = searchLessons('', { feedbackDir, limit: 1000 }).results || [];
  const errorLessons = lessons.filter((lesson) => lesson.category === 'error');
  const negativeEntries = entries.filter((entry) => entry && entry.signal === 'negative');
  const diagnosticsCovered = negativeEntries.filter((entry) => entry && entry.diagnosis && entry.diagnosis.rootCauseCategory);
  const repeatPressure = detectRepeatFailurePressure(entries);
  const lifecycleCounts = lessons.reduce((acc, lesson) => {
    const stage = lesson.systemResponse && lesson.systemResponse.lifecycle
      ? lesson.systemResponse.lifecycle.stage
      : 'detected';
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {
    detected: 0,
    promoted: 0,
    enforced: 0,
    measured: 0,
  });

  const correctionCoverage = safeRate(
    errorLessons.filter((lesson) => lesson.systemResponse.lifecycle.correctiveActionCaptured).length,
    errorLessons.length
  );
  const enforcementCoverage = safeRate(
    errorLessons.filter((lesson) => lesson.systemResponse.lifecycle.preventionRuleLinked || lesson.systemResponse.lifecycle.gateLinked).length,
    errorLessons.length
  );
  const diagnosticCoverage = safeRate(diagnosticsCovered.length, negativeEntries.length);
  const repeatResistance = 1 - repeatPressure.repeatFailureRate;
  const score = Math.round(100 * (
    (correctionCoverage * 0.3)
    + (enforcementCoverage * 0.3)
    + (diagnosticCoverage * 0.2)
    + (repeatResistance * 0.2)
  ));

  let status = 'bootstrapping';
  if (score >= 80) status = 'strong';
  else if (score >= 60) status = 'improving';
  else if (score >= 40) status = 'weak';

  return {
    score,
    status,
    lessonCount: lessons.length,
    errorLessonCount: errorLessons.length,
    correctionCoverage,
    enforcementCoverage,
    diagnosticCoverage,
    repeatFailureRate: repeatPressure.repeatFailureRate,
    repeatedFailureCount: repeatPressure.repeatedCount,
    topRepeatedPattern: repeatPressure.topPattern,
    lifecycleCounts,
    topRecommendations: aggregateHarnessRecommendations(errorLessons),
  };
}

function remediationPriority(type) {
  const priorities = {
    'trend-declining': 90,
    'trend-degrading': 85,
    'high-risk-domain': 80,
    'high-risk-tag': 78,
    'skill-improve': 72,
    'delegation-reduce': 68,
    'delegation-policy-review': 66,
    'diagnose-failure-category': 62,
    'pattern-reuse': 58,
  };
  return priorities[type] || 40;
}

function summarizeActionableRemediations(items, limit = 6) {
  if (!Array.isArray(items)) return [];
  return items
    .slice()
    .sort((left, right) => {
      const delta = remediationPriority(right && right.type) - remediationPriority(left && left.type);
      if (delta !== 0) return delta;
      const rightCount = Number(right && right.evidence && (right.evidence.count || right.evidence.total || right.evidence.highRisk || 0));
      const leftCount = Number(left && left.evidence && (left.evidence.count || left.evidence.total || left.evidence.highRisk || 0));
      if (rightCount !== leftCount) return rightCount - leftCount;
      return String((left && left.target) || '').localeCompare(String((right && right.target) || ''));
    })
    .slice(0, limit)
    .map((item) => ({
      ...item,
      priority: remediationPriority(item.type),
      title: `${String(item.action || 'review').replace(/-/g, ' ')} · ${item.target || 'system'}`,
      badge: String(item.type || 'remediation').replace(/-/g, ' '),
    }));
}

function summarizeMcpServerInventory(projectRoot = PROJECT_ROOT) {
  const configPath = path.join(projectRoot, '.mcp.json');
  const parsed = readJsonFile(configPath);
  const mcpServers = parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object'
    ? Object.keys(parsed.mcpServers).sort()
    : [];
  return {
    configPath: fs.existsSync(configPath) ? configPath : null,
    configuredServers: mcpServers,
    configuredServerCount: mcpServers.length,
  };
}

function computeAgentSurfaceInventory(feedbackDir, options = {}) {
  const readiness = options.readiness || generateAgentReadinessReport({ projectRoot: PROJECT_ROOT });
  const auditEntries = Array.isArray(options.auditEntries)
    ? options.auditEntries
    : readJSONL(path.join(feedbackDir, AUDIT_LOG_FILENAME));
  const decisionRecords = Array.isArray(options.decisionRecords)
    ? options.decisionRecords
    : readDecisionLog(path.join(feedbackDir, DECISION_LOG_FILENAME));
  const toolBuckets = new Map();
  const sourceBuckets = new Map();
  const toolNames = new Set();

  function getToolBucket(toolName) {
    const key = normalizeText(toolName) || 'unknown';
    toolNames.add(key);
    if (!toolBuckets.has(key)) {
      toolBuckets.set(key, {
        toolName: key,
        evaluations: 0,
        allow: 0,
        warn: 0,
        deny: 0,
        intercepted: 0,
      });
    }
    return toolBuckets.get(key);
  }

  for (const record of decisionRecords) {
    if (!record || record.recordType !== 'evaluation') continue;
    getToolBucket(record.toolName).evaluations += 1;
  }

  for (const entry of auditEntries) {
    if (!entry) continue;
    const bucket = getToolBucket(entry.toolName);
    if (entry.decision === 'allow') bucket.allow += 1;
    if (entry.decision === 'warn') {
      bucket.warn += 1;
      bucket.intercepted += 1;
    }
    if (entry.decision === 'deny') {
      bucket.deny += 1;
      bucket.intercepted += 1;
    }
    const sourceKey = normalizeText(entry.source) || 'unknown';
    sourceBuckets.set(sourceKey, (sourceBuckets.get(sourceKey) || 0) + 1);
  }

  const observedTools = [...toolBuckets.values()]
    .sort((left, right) => {
      if (right.intercepted !== left.intercepted) return right.intercepted - left.intercepted;
      if (right.evaluations !== left.evaluations) return right.evaluations - left.evaluations;
      return left.toolName.localeCompare(right.toolName);
    })
    .slice(0, 8);
  const policySources = [...sourceBuckets.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => ({ source, count }))
    .slice(0, 6);
  const mcpInventory = summarizeMcpServerInventory(PROJECT_ROOT);

  return {
    profile: readiness.permissions.profile,
    tier: readiness.permissions.tier,
    configuredServerCount: mcpInventory.configuredServerCount,
    configuredServers: mcpInventory.configuredServers,
    observedToolCount: toolNames.size,
    observedTools,
    policySources,
    writeCapableTools: readiness.permissions.writeCapableTools.slice(0, 8),
    activeBootstrapFiles: readiness.bootstrap.requiredPresent,
    requiredBootstrapFiles: readiness.bootstrap.requiredCount,
  };
}

function computeBackgroundAgentMode(feedbackDir, options = {}) {
  const governance = generateGovernanceReport({
    periodHours: options.periodHours || 24,
    feedbackDir,
  });
  const workflowSummary = options.workflowSummary || summarizeWorkflowRuns(feedbackDir);
  const topRunType = Object.entries(governance.byType || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || null;
  const latestRun = workflowSummary.latestRun || null;
  const checkpointCoverage = safeRate(workflowSummary.reviewedRuns || 0, workflowSummary.proofBackedRuns || 0);

  return {
    ...governance,
    checkpointCoverage,
    reviewedRuns: workflowSummary.reviewedRuns || 0,
    proofBackedRuns: workflowSummary.proofBackedRuns || 0,
    latestRun,
    topRunType: topRunType ? { runType: topRunType[0], count: topRunType[1] } : null,
    recommendedMode: governance.blocked > 0 || governance.failed > 0
      ? 'checkpoint-heavy'
      : governance.total > 0
        ? 'operator-light'
        : 'bootstrapping',
  };
}

function computeRegulatedBuyerProof(settingsStatus, workflowSummary, decisions, readiness) {
  const origins = Array.isArray(settingsStatus && settingsStatus.origins) ? settingsStatus.origins : [];
  const activeLayers = Array.isArray(settingsStatus && settingsStatus.activeLayers)
    ? settingsStatus.activeLayers.filter((layer) => layer && layer.exists)
    : [];
  const latestRun = workflowSummary && workflowSummary.latestRun ? workflowSummary.latestRun : null;
  const proofArtifacts = latestRun && Array.isArray(latestRun.proofArtifacts) ? latestRun.proofArtifacts : [];

  return {
    policyOriginCount: origins.length,
    activeLayerCount: activeLayers.length,
    reviewedRuns: workflowSummary && workflowSummary.reviewedRuns || 0,
    proofBackedRuns: workflowSummary && workflowSummary.proofBackedRuns || 0,
    checkpointCoverage: safeRate(
      workflowSummary && workflowSummary.reviewedRuns || 0,
      workflowSummary && workflowSummary.proofBackedRuns || 0
    ),
    decisionEvaluations: decisions && decisions.evaluationCount || 0,
    appendOnlyAuditReady: Boolean(decisions && decisions.evaluationCount > 0),
    runtimeIsolation: Boolean(readiness && readiness.articleAlignment && readiness.articleAlignment.runtimeIsolation),
    latestWorkflowName: latestRun ? (latestRun.workflowName || latestRun.workflowId) : null,
    latestProofArtifacts: proofArtifacts.slice(0, 3),
    latestPolicyOrigin: origins[0] || null,
  };
}

function resolveTeamWindowHours(analyticsWindow) {
  const window = analyticsWindow && analyticsWindow.window;
  if (window === 'today') return 24;
  if (window === '7d') return 24 * 7;
  if (window === '30d') return 24 * 30;
  return 24;
}

// ---------------------------------------------------------------------------
// Full dashboard data
// ---------------------------------------------------------------------------

function collectAllFeedbackEntries(feedbackDir) {
  const entries = [];
  const seen = new Set();

  function mergeFrom(logPath) {
    if (!fs.existsSync(logPath)) return;
    for (const entry of readJSONL(logPath)) {
      const id = entry.id || entry.feedbackId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      entries.push(entry);
    }
  }

  // Primary: the passed feedbackDir (global ~/.thumbgate)
  mergeFrom(path.join(feedbackDir, 'feedback-log.jsonl'));

  // Project-local .thumbgate directories (e.g. repo/.thumbgate/feedback-log.jsonl)
  // The MCP server may write to a project-scoped dir that differs from the global one.
  const projectsDir = path.join(feedbackDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    try {
      for (const project of fs.readdirSync(projectsDir)) {
        mergeFrom(path.join(projectsDir, project, 'feedback-log.jsonl'));
      }
    } catch { /* ignore read errors */ }
  }

  // Also check the project root's .thumbgate if feedbackDir is global
  // The MCP server often resolves to PROJECT_ROOT/.thumbgate for project-scoped feedback
  // Skip this merge when feedbackDir is a temp/test directory (not ~/.thumbgate)
  const homeThumbgate = path.join(process.env.HOME || '/tmp', '.thumbgate');
  const projectLocalDir = path.join(PROJECT_ROOT, '.thumbgate');
  if (
    path.resolve(feedbackDir) === path.resolve(homeThumbgate) &&
    projectLocalDir !== feedbackDir &&
    fs.existsSync(projectLocalDir)
  ) {
    mergeFrom(path.join(projectLocalDir, 'feedback-log.jsonl'));
  }

  // Sort by timestamp for consistent ordering
  entries.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  return entries;
}

function generateDashboard(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options.analyticsWindow || options);
  const diagnosticLogPath = path.join(feedbackDir, 'diagnostic-log.jsonl');
  const entries = collectAllFeedbackEntries(feedbackDir);
  const diagnosticEntries = readJSONL(diagnosticLogPath);
  const memoryEntries = readJSONL(path.join(feedbackDir, 'memory-log.jsonl'));
  const auditEntries = readJSONL(path.join(feedbackDir, AUDIT_LOG_FILENAME));
  const reviewBaseline = options.reviewBaseline === undefined
    ? readDashboardReviewState(feedbackDir)
    : options.reviewBaseline;
  const reviewSnapshot = buildReviewSnapshot(feedbackDir, {
    feedbackEntries: entries,
    memoryEntries,
    auditEntries,
    reviewedAt: options.now || new Date().toISOString(),
  });
  const billingSummary = options.billingSummary || getBillingSummary(analyticsWindow);

  const approval = computeApprovalStats(entries);
  const gateStats = computeGateStats();
  const prevention = computePreventionImpact(feedbackDir, gateStats);
  const trend = computeSessionTrend(entries, 10);
  const health = computeSystemHealth(feedbackDir, gateStats);
  const gateAudit = computeGateAuditSeries(feedbackDir);
  const diagnostics = aggregateFailureDiagnostics([...entries, ...diagnosticEntries]);
  const secretGuard = computeSecretGuardStats(diagnosticEntries);
  const gates = listActiveGates();
  const analytics = computeAnalyticsSummary(feedbackDir, {
    analyticsWindow,
    billingSummary,
  });
  analytics.lossAnalysis = buildLossAnalysis(analytics);
  const observability = computeObservabilityStats(diagnosticEntries, diagnostics, secretGuard, analytics.telemetry);
  const instrumentation = computeInstrumentationReadiness(analytics, billingSummary);
  const delegationRuntime = loadDelegationRuntimeModule();
  const delegation = delegationRuntime
    ? delegationRuntime.summarizeDelegation(feedbackDir)
    : {
      totalHandoffs: 0,
      successfulHandoffs: 0,
      blockedHandoffs: 0,
      activePlans: [],
      availability: 'private_core',
    };
  const readiness = generateAgentReadinessReport({ projectRoot: PROJECT_ROOT });
  const feedbackAnalysis = analyzeFeedback(path.join(feedbackDir, 'feedback-log.jsonl'));
  const harness = computeHarnessOverview(feedbackDir, entries);
  const interventionPolicy = getInterventionPolicySummary(feedbackDir);
  const decisionRecords = readDecisionLog(path.join(feedbackDir, DECISION_LOG_FILENAME));
  const decisions = computeDecisionMetrics(feedbackDir);
  const actionableRemediations = summarizeActionableRemediations(
    feedbackAnalysis && feedbackAnalysis.actionableRemediations
  );
  const agentSurfaceInventory = computeAgentSurfaceInventory(feedbackDir, {
    readiness,
    auditEntries,
    decisionRecords,
  });
  const settingsStatus = getSettingsStatus({ projectRoot: PROJECT_ROOT });
  settingsStatus.routingPreview = {
    dashboardTool: routeProfile({
      toolName: 'dashboard',
      settingsOptions: { projectRoot: PROJECT_ROOT },
    }),
    defaultSession: routeProfile({
      settingsOptions: { projectRoot: PROJECT_ROOT },
    }),
    reviewSession: routeProfile({
      sessionType: 'review',
      settingsOptions: { projectRoot: PROJECT_ROOT },
    }),
  };
  const workflowSummary = summarizeWorkflowRuns(feedbackDir);
  const backgroundAgents = computeBackgroundAgentMode(feedbackDir, {
    workflowSummary,
  });
  const regulatedProof = computeRegulatedBuyerProof(
    settingsStatus,
    workflowSummary,
    decisions,
    readiness,
  );

  // Live metrics — gate hit rate, lesson effectiveness, error trend
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * day;
  const recentEntries = entries.filter((e) => e.timestamp && new Date(e.timestamp).getTime() > weekAgo);
  const negRecent = recentEntries.filter((e) => ['down', 'negative', 'thumbs_down'].includes(String(e.signal || e.feedback || '').toLowerCase()));
  const posRecent = recentEntries.filter((e) => ['up', 'positive', 'thumbs_up'].includes(String(e.signal || e.feedback || '').toLowerCase()));
  const timestamps = entries.filter((e) => e.timestamp).map((e) => new Date(e.timestamp).getTime());
  const daysActive = timestamps.length > 0 ? Math.max(1, Math.ceil((now - Math.min(...timestamps)) / day)) : 1;
  const totalNeg = entries.filter((e) => ['down', 'negative', 'thumbs_down'].includes(String(e.signal || e.feedback || '').toLowerCase())).length;
  const autoGates = gateStats.autoCount || 0;
  const twoWeeksAgo = now - 14 * day;
  const lastWeekNeg = entries.filter((e) => e.timestamp && new Date(e.timestamp).getTime() > twoWeeksAgo && new Date(e.timestamp).getTime() <= weekAgo && ['down', 'negative', 'thumbs_down'].includes(String(e.signal || e.feedback || '').toLowerCase())).length;
  const liveMetrics = {
    gateHitRate: { blockedPerDay: Math.round(((gateStats.blocked || 0) / daysActive) * 100) / 100, warnedPerDay: Math.round(((gateStats.warned || 0) / daysActive) * 100) / 100, daysActive },
    lessonEffectiveness: { rate: totalNeg > 0 ? Math.round((autoGates / totalNeg) * 10000) / 100 : 0, totalNegative: totalNeg, autoGatesCreated: autoGates },
    errorTrend: { direction: lastWeekNeg > 0 ? (negRecent.length < lastWeekNeg ? 'improving' : negRecent.length > lastWeekNeg ? 'worsening' : 'stable') : (negRecent.length > 0 ? 'new-errors' : 'clean'), thisWeek: negRecent.length, lastWeek: lastWeekNeg },
    weeklyActivity: { positive: posRecent.length, negative: negRecent.length, total: recentEntries.length },
    decisionLoop: {
      fastPathRate: decisions.fastPathRate,
      overrideRate: decisions.overrideRate,
      rollbackRate: decisions.rollbackRate,
      medianLatencyMs: decisions.medianLatencyMs,
      resolvedCount: decisions.resolvedCount,
    },
  };

  const feedbackTimeSeries = computeFeedbackTimeSeries(entries, 30);
  const lessonPipeline = computeLessonPipeline(feedbackDir, entries, gateStats);

  // Estimated token savings — computed from gate blocked counts using the
  // conservative methodology in scripts/token-savings.js. This is the ONLY
  // place "$ saved" appears that's backed by real gate-block data; the landing
  // page hero uses a hardcoded sample number disclosed as "Sample".
  let tokenSavings = null;
  try {
    const { computeTokenSavings } = require('./token-savings');
    tokenSavings = computeTokenSavings({
      blockedCalls: Number(gateStats.blocked) || 0,
    });
  } catch { /* module missing — skip */ }

  // Merge lesson counts into feedbackTimeSeries days
  for (const day of feedbackTimeSeries.days) {
    day.lessons = lessonPipeline.lessonsByDay.get(day.dayKey) || 0;
  }

  const teamWindowHours = resolveTeamWindowHours(analyticsWindow);
  const orgDashboard = loadOrgDashboardModule();
  const team = orgDashboard
    ? orgDashboard.generateOrgDashboard({
      windowHours: teamWindowHours,
      authContext: options.authContext,
      proOverride: options.teamProOverride,
    })
    : buildUnavailableOrgDashboard(teamWindowHours);
  const templateLibrary = summarizeGateTemplates();
  const predictive = buildPredictiveInsights({
    telemetryAnalytics: analytics.telemetry,
    billingSummary,
    gateStats,
    team,
  });
  const reviewDelta = summarizeReviewDelta(entries, memoryEntries, auditEntries, reviewBaseline, reviewSnapshot);

  return {
    operational: {
      source: options.billingSource || 'local',
      fallbackReason: options.billingFallbackReason || null,
      window: analytics.window || analyticsWindow,
    },
    approval,
    gateStats,
    gates,
    prevention,
    trend,
    health,
    gateAudit,
    diagnostics,
    delegation,
    secretGuard,
    analytics,
    harness,
    observability,
    instrumentation,
    readiness,
    feedbackAnalysis,
    actionableRemediations,
    agentSurfaceInventory,
    backgroundAgents,
    regulatedProof,
    interventionPolicy,
    decisions,
    settingsStatus,
    team,
    templateLibrary,
    liveMetrics,
    predictive,
    reviewDelta,
    feedbackTimeSeries,
    tokenSavings,
    lessonPipeline: {
      stages: lessonPipeline.stages,
      rates: lessonPipeline.rates,
    },
  };
}

// ---------------------------------------------------------------------------
// Rich CLI output
// ---------------------------------------------------------------------------

function printDashboard(data) {
  const {
    approval,
    gateStats,
    prevention,
    trend,
    health,
    gateAudit,
    diagnostics,
    delegation,
    secretGuard,
    analytics,
    harness,
    observability,
    instrumentation,
    readiness,
    interventionPolicy,
    decisions,
    settingsStatus,
    team,
    templateLibrary,
    predictive,
  } = data;

  const trendArrow = approval.trendDirection === 'improving' ? '\u2191'
    : approval.trendDirection === 'declining' ? '\u2193'
    : '\u2192';

  console.log('');
  console.log('\uD83D\uDCCA ThumbGate Dashboard');
  console.log('\u2550'.repeat(46));
  console.log(`  Approval Rate    : ${approval.approvalRate}% \u2192 ${approval.recentRate}% (7-day trend ${trendArrow})`);
  console.log(`  Total Signals    : ${approval.total} (${approval.positive} positive, ${approval.negative} negative)`);

  console.log('');
  console.log('\uD83D\uDEE1\uFE0F  Gate Enforcement');
  console.log(`  Active Gates     : ${gateStats.totalGates} (${gateStats.manualCount} manual, ${gateStats.autoCount} auto-promoted)`);
  console.log(`  Actions Blocked  : ${gateStats.blocked}`);
  console.log(`  Actions Warned   : ${gateStats.warned}`);
  if (gateStats.topBlocked) {
    console.log(`  Top Blocked      : ${gateStats.topBlocked} (${gateStats.topBlockedCount}\u00D7)`);
  }

  console.log('');
  console.log('\u26A1 Prevention Impact');
  console.log(`  Estimated Saves  : ${prevention.estimatedHoursSaved} hours`);
  console.log(`  Rules Active     : ${prevention.ruleCount} prevention rules`);
  if (prevention.lastPromotion) {
    console.log(`  Last Promotion   : ${prevention.lastPromotion.id} (${prevention.lastPromotion.daysAgo} days ago)`);
  }

  console.log('');
  console.log('🧰 Harness');
  console.log(`  Score            : ${harness.score}/100 (${harness.status})`);
  console.log(`  Correction Cov.  : ${Math.round((harness.correctionCoverage || 0) * 100)}%`);
  console.log(`  Enforcement Cov. : ${Math.round((harness.enforcementCoverage || 0) * 100)}%`);
  console.log(`  Diagnostic Cov.  : ${Math.round((harness.diagnosticCoverage || 0) * 100)}%`);
  console.log(`  Repeat Pressure  : ${Math.round((harness.repeatFailureRate || 0) * 100)}%`);
  console.log(`  Error Lessons    : ${harness.errorLessonCount}/${harness.lessonCount}`);
  if (harness.topRecommendations[0]) {
    console.log(`  Top Next Fix     : ${harness.topRecommendations[0].type} (${harness.topRecommendations[0].count} lessons)`);
  }

  console.log('');
  console.log('🧠 Learned Policy');
  console.log(`  Enabled          : ${interventionPolicy.enabled ? 'yes' : 'no'}`);
  console.log(`  Examples         : ${interventionPolicy.exampleCount}`);
  console.log(`  Train Accuracy   : ${Math.round((interventionPolicy.metrics.trainingAccuracy || 0) * 100)}%`);
  console.log(`  Holdout Accuracy : ${Math.round((interventionPolicy.metrics.holdoutAccuracy || 0) * 100)}%`);
  console.log(`  Recent Pressure  : ${Math.round((interventionPolicy.nonAllowRate || 0) * 100)}% non-allow`);
  if (interventionPolicy.updatedAt) {
    console.log(`  Updated          : ${interventionPolicy.updatedAt}`);
  }
  if (interventionPolicy.topTokens && interventionPolicy.topTokens.deny && interventionPolicy.topTokens.deny[0]) {
    console.log(`  Top Deny Signal  : ${interventionPolicy.topTokens.deny[0].token}`);
  }

  console.log('');
  console.log('🧭 Decision Loop');
  console.log(`  Evaluations      : ${decisions.evaluationCount}`);
  console.log(`  Fast Path        : ${Math.round((decisions.fastPathRate || 0) * 100)}%`);
  console.log(`  Override Rate    : ${Math.round((decisions.overrideRate || 0) * 100)}%`);
  console.log(`  Rollback Rate    : ${Math.round((decisions.rollbackRate || 0) * 100)}%`);
  console.log(`  Median Latency   : ${Math.round((decisions.medianLatencyMs || 0) / 1000)}s`);

  console.log('');
  console.log('🎯 North Star');
  console.log(`  Weekly Proof Runs: ${analytics.northStar.weeklyActiveProofBackedWorkflowRuns}`);
  console.log(`  Weekly Teams     : ${analytics.northStar.weeklyTeamsRunningProofBackedWorkflows}`);
  console.log(`  Reviewed Runs    : ${analytics.northStar.reviewedRuns}`);
  console.log(`  Paid Team Runs   : ${analytics.northStar.paidTeamRuns}`);
  console.log(`  Named Pilots     : ${analytics.northStar.namedPilotAgreements}`);
  console.log(`  Status           : ${analytics.northStar.northStarReached ? 'tracking' : 'not_started'}`);
  console.log(`  Customer Proof   : ${analytics.northStar.customerProofReached ? 'present' : 'missing'}`);
  if (analytics.northStar.latestRun) {
    console.log(`  Latest Run       : ${analytics.northStar.latestRun.workflowId} @ ${analytics.northStar.latestRun.timestamp}`);
  }

  console.log('');
  console.log('⚙️ Efficiency');
  console.log(`  Context Packs    : ${analytics.efficiency.contextPackRequests}`);
  console.log(`  Cache Hits       : ${analytics.efficiency.semanticCacheHits}`);
  console.log(`  Hit Rate         : ${analytics.efficiency.semanticCacheHitRate}`);
  console.log(`  Avg Similarity   : ${analytics.efficiency.averageSemanticSimilarity}`);
  console.log(`  Tokens Reused    : ${analytics.efficiency.estimatedContextTokensReused} (heuristic)`);

  console.log('');
  console.log('\uD83E\uDD1D Delegation');
  console.log(`  Attempts         : ${delegation.attemptCount}`);
  console.log(`  Outcomes         : ${delegation.acceptedCount} accepted / ${delegation.rejectedCount} rejected / ${delegation.abortedCount} aborted`);
  console.log(`  Verification Fail: ${Math.round((delegation.verificationFailureRate || 0) * 100)}%`);
  console.log(`  Avoided Starts   : ${delegation.avoidedDelegationCount}`);

  console.log('');
  console.log('\uD83D\uDCBC Growth Analytics');
  console.log(`  Unique Visitors  : ${analytics.trafficMetrics.visitors}`);
  console.log(`  Sessions         : ${analytics.trafficMetrics.sessions}`);
  console.log(`  Page Views       : ${analytics.trafficMetrics.pageViews}`);
  console.log(`  CTA Clicks       : ${analytics.trafficMetrics.ctaClicks}`);
  console.log(`  Leads            : ${analytics.funnel.acquisitionLeads}`);
  console.log(`  Sprint Leads     : ${analytics.pipeline.workflowSprintLeads.total}`);
  console.log(`  Qualified Leads  : ${analytics.pipeline.qualifiedWorkflowSprintLeads.total}`);
  console.log(`  Paid Provider Ev.: ${analytics.revenue.paidProviderEvents}`);
  console.log(`  Paid Orders      : ${analytics.funnel.paidOrders}`);
  console.log(`  Visitor \u2192 Paid  : ${analytics.funnel.visitorToPaidRate}`);
  console.log(`  Booked Revenue   : $${(analytics.revenue.bookedRevenueCents / 100).toFixed(2)}`);
  console.log(`  Matched Journeys : ${analytics.reconciliation.matchedPaidOrders}/${analytics.reconciliation.telemetryCheckoutStarts}`);
  console.log(`  Buyer Loss       : ${analytics.buyerLoss.totalSignals}`);
  if (analytics.telemetry.visitors.topSource) {
    console.log(`  Top Source       : ${analytics.telemetry.visitors.topSource.key} (${analytics.telemetry.visitors.topSource.count}\u00D7)`);
  }
  if (analytics.funnel.topTrafficChannel) {
    console.log(`  Traffic Channel  : ${analytics.funnel.topTrafficChannel.key} (${analytics.funnel.topTrafficChannel.count}\u00D7)`);
  }
  if (analytics.buyerLoss.topReason) {
    console.log(`  Top Loss Reason  : ${analytics.buyerLoss.topReason.key} (${analytics.buyerLoss.topReason.count}\u00D7)`);
  }
  if (analytics.seo.topSurface) {
    console.log(`  SEO Surface      : ${analytics.seo.topSurface.key} (${analytics.seo.topSurface.count}\u00D7)`);
  }

  console.log('');
  console.log('\uD83D\uDCE1 Tracking Readiness');
  console.log(`  Plausible        : ${instrumentation.plausibleConfigured ? 'configured' : 'missing'}`);
  console.log(`  GA4              : ${instrumentation.ga4Configured ? 'configured' : 'missing'}`);
  console.log(`  Search Console   : ${instrumentation.googleSearchConsoleConfigured ? 'configured' : 'missing'}`);
  console.log(`  Telemetry Events : ${instrumentation.telemetryEventsPresent ? instrumentation.uniqueVisitorsTracked : 0} visitors`);
  console.log(`  SEO Signals      : ${instrumentation.seoSignalsPresent ? analytics.seo.landingViews : 0}`);
  console.log(`  Buyer Loss       : ${instrumentation.buyerLossSignalsPresent ? analytics.buyerLoss.totalSignals : 0}`);
  console.log(`  Attribution      : ${Math.round((instrumentation.trafficAttributionCoverage || 0) * 100)}% page-view coverage`);
  console.log(`  Revenue Tracking : ${instrumentation.bookedRevenueTrackingEnabled ? 'booked revenue enabled' : 'disabled'}`);
  console.log(`  Amount Coverage  : ${Math.round((analytics.dataQuality.amountKnownCoverage || 0) * 100)}%`);
  console.log(`  Unreconciled Paid: ${analytics.dataQuality.unreconciledPaidEvents}`);

  console.log('');
  console.log('⚙️ Policy Origins');
  console.log(`  Active Layers    : ${settingsStatus.activeLayers.filter((layer) => layer.exists).map((layer) => layer.scope).join(' -> ')}`);
  console.log(`  Default Profile  : ${settingsStatus.resolvedSettings.mcp.defaultProfile}`);
  console.log(`  Review Profile   : ${settingsStatus.resolvedSettings.mcp.readonlySessionProfile}`);
  console.log(`  Harness Runtime  : ${settingsStatus.resolvedSettings.harnesses.allowRuntimeExecution ? 'enabled' : 'disabled'}`);
  if (settingsStatus.routingPreview && settingsStatus.routingPreview.dashboardTool) {
    console.log(`  Dashboard Route  : ${settingsStatus.routingPreview.dashboardTool.profile} (${settingsStatus.routingPreview.dashboardTool.reason})`);
  }

  console.log('');
  console.log('👥 Team');
  console.log(`  Active Agents    : ${team.activeAgents}/${team.totalAgents}`);
  console.log(`  Org Adherence    : ${team.orgAdherenceRate}%`);
  console.log(`  Top Blocked Gates: ${team.topBlockedGates.length}`);
  console.log(`  Risk Agents      : ${team.riskAgents.length}`);
  console.log(`  Proof-Backed Teams: ${analytics.northStar.weeklyTeamsRunningProofBackedWorkflows}`);
  if (team.upgradeMessage) {
    console.log(`  Upgrade Path     : ${team.upgradeMessage}`);
  }

  console.log('');
  console.log('🧱 Gate Templates');
  console.log(`  Total Templates  : ${templateLibrary.total}`);
  console.log(`  Categories       : ${Object.keys(templateLibrary.categories || {}).length}`);
  const topTemplateCategory = Object.entries(templateLibrary.categories || {})
    .sort((a, b) => b[1] - a[1])[0];
  if (topTemplateCategory) {
    console.log(`  Top Category     : ${topTemplateCategory[0]} (${topTemplateCategory[1]} templates)`);
  }

  console.log('');
  console.log('🔮 Predictive Insights');
  console.log(`  Pro Propensity   : ${predictive.upgradePropensity.pro.band} (${predictive.upgradePropensity.pro.score})`);
  console.log(`  Team Propensity  : ${predictive.upgradePropensity.team.band} (${predictive.upgradePropensity.team.score})`);
  console.log(`  Revenue Forecast : $${(predictive.revenueForecast.predictedBookedRevenueCents / 100).toFixed(2)}`);
  console.log(`  Opportunity Gap  : $${(predictive.revenueForecast.incrementalOpportunityCents / 100).toFixed(2)}`);
  console.log(`  Predictive Alerts: ${predictive.anomalySummary.count} (${predictive.anomalySummary.severity})`);
  if (predictive.topCreators[0]) {
    console.log(`  Top Creator      : ${predictive.topCreators[0].key} (+$${(predictive.topCreators[0].opportunityRevenueCents / 100).toFixed(2)})`);
  }
  if (predictive.topSources[0]) {
    console.log(`  Top Channel      : ${predictive.topSources[0].key} (+$${(predictive.topSources[0].opportunityRevenueCents / 100).toFixed(2)})`);
  }

  console.log('');
  console.log('🧭 Agent Readiness');
  console.log(`  Overall          : ${readiness.overallStatus}`);
  console.log(`  Runtime          : ${readiness.runtime.mode}`);
  console.log(`  Bootstrap        : ${readiness.bootstrap.requiredPresent}/${readiness.bootstrap.requiredCount} required files`);
  console.log(`  MCP Tier         : ${readiness.permissions.profile} (${readiness.permissions.tier})`);
  if (readiness.warnings[0]) {
    console.log(`  Top Warning      : ${readiness.warnings[0]}`);
  }

  console.log('');
  console.log('\uD83D\uDD10 Secret Guard');
  console.log(`  Blocks Recorded  : ${secretGuard.blocked}`);
  if (secretGuard.topConstraint) {
    console.log(`  Top Constraint   : ${secretGuard.topConstraint.key} (${secretGuard.topConstraint.count}\u00D7)`);
  }

  console.log('');
  console.log('\uD83D\uDCC8 Trend (last 10 sessions)');
  const trendLabel = approval.trendDirection === 'improving' ? 'improving'
    : approval.trendDirection === 'declining' ? 'declining'
    : 'stable';
  console.log(`  ${trend.bars} ${trend.percentage}% \u2192 ${trendLabel}`);

  console.log('');
  console.log('\uD83D\uDD27 System Health');
  console.log(`  Feedback Log     : ${health.feedbackCount} entries`);
  console.log(`  Memory Store     : ${health.memoryCount} memories`);
  console.log(`  Gate Config      : ${health.gateConfigLoaded ? 'loaded' : 'not found'} (${health.gateCount} gates)`);
  console.log(`  MCP Server       : running`);
  if (diagnostics.totalDiagnosed > 0) {
    console.log(`  Failure Diagnoses: ${diagnostics.totalDiagnosed}`);
    if (diagnostics.categories[0]) {
      console.log(`  Top Root Cause   : ${diagnostics.categories[0].key} (${diagnostics.categories[0].count}\u00D7)`);
    }
  }

  console.log('');
  console.log('\uD83D\uDCE1 Observability');
  console.log(`  Diagnostic Events: ${observability.diagnosticEvents}`);
  console.log(`  Secret Blocks    : ${observability.secretGuardBlocks}`);
  console.log(`  Telemetry Errors : ${observability.telemetryIngestErrors}`);
  console.log(`  Buyer Loss       : ${observability.buyerLossSignals}`);
  console.log(`  SEO Views        : ${observability.seoLandingViews}`);
  if (observability.topSource) {
    console.log(`  Top Source       : ${observability.topSource.key} (${observability.topSource.count}\u00D7)`);
  }
  if (observability.topBuyerLossReason) {
    console.log(`  Top Loss Reason  : ${observability.topBuyerLossReason.key} (${observability.topBuyerLossReason.count}\u00D7)`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Exports + CLI
// ---------------------------------------------------------------------------

module.exports = {
  generateDashboard,
  buildReviewSnapshot,
  readDashboardReviewState,
  writeDashboardReviewState,
  printDashboard,
  computeApprovalStats,
  computeDecisionMetrics,
  computeGateStats,
  computePreventionImpact,
  computeSessionTrend,
  computeSystemHealth,
  computeEfficiencyMetrics,
  computeHarnessOverview,
  getInterventionPolicySummary,
  computeAnalyticsSummary,
  computeSecretGuardStats,
  computeObservabilityStats,
  readJSONL,
  readJsonFile,
};

if (require.main === module) {
  const { getFeedbackPaths } = require('./feedback-loop');
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = generateDashboard(FEEDBACK_DIR);
  printDashboard(data);
}
