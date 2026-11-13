#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { aggregateFailureDiagnostics } = require('./failure-diagnostics');
const { AUDIT_LOG_FILENAME } = require('./audit-trail');
const { buildAgentRegister } = require('./agent-action-inventory');
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
const { mergeRepeatMetricIntoGateStats } = require('./repeat-metric');
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
const {
  collectAggregateLogEntries,
  shouldAggregateFeedback,
} = require('./feedback-aggregate');
const {
  DEFAULT_JSONL_TAIL_BYTES,
  DEFAULT_JSONL_TAIL_ENTRIES,
  readTextTail,
} = require('./fs-utils');

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

const DEFAULT_JSONL_MAX_BYTES = DEFAULT_JSONL_TAIL_BYTES;
const DEFAULT_JSONL_MAX_ENTRIES = DEFAULT_JSONL_TAIL_ENTRIES;

function readJSONL(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return [];
  const requestedBytes = Number(options.maxBytes);
  const requestedEntries = Number(options.maxEntries);
  const maxBytes = requestedBytes > 0 ? requestedBytes : DEFAULT_JSONL_MAX_BYTES;
  const maxEntries = requestedEntries > 0 ? requestedEntries : DEFAULT_JSONL_MAX_ENTRIES;
  let text;
  try {
    text = readTextTail(filePath, maxBytes).text;
  } catch (err) {
    return [];
  }
  if (!text?.trim()) return [];
  const lines = text.split('\n');
  const start = Math.max(0, lines.length - maxEntries);
  const entries = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed) entries.push(parsed);
    } catch {  }
  }
  return entries;
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
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head) return null;
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const refPrefix = 'ref:';
    if (!head.startsWith(refPrefix)) return null;
    const refName = head.slice(refPrefix.length).trim();
    if (!refName) return null;
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

function selectDashboardFeedback(entries, humanOnly) {
  return humanOnly
    ? entries.filter((entry) => entry.reviewOrigin === 'human' && ['positive', 'negative'].includes(entry.signal))
    : entries;
}

function buildReviewSnapshot(feedbackDir, options = {}) {
  const feedbackEntries = selectDashboardFeedback(
    Array.isArray(options.feedbackEntries)
      ? options.feedbackEntries
      : (options.humanOnly ? collectAllFeedbackEntries(feedbackDir) : readJSONL(path.join(feedbackDir, 'feedback-log.jsonl'))),
    options.humanOnly,
  );
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

function computeApprovalStats(entries) {
  const total = entries.length;
  const positive = entries.filter((e) => e.signal === 'positive').length;
  const negative = entries.filter((e) => e.signal === 'negative').length;
  const approvalRate = total > 0 ? Math.round((positive / total) * 100) : 0;

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

function resolveScopedGateStatsPath(feedbackDir) {
  const stateDir = process.env.THUMBGATE_STATE_DIR
    || path.join(process.env.HOME || '/tmp', '.thumbgate');
  const defaultStatsPath = path.join(stateDir, 'gate-stats.json');
  if (!feedbackDir) return defaultStatsPath;
  const localStatsPath = path.join(feedbackDir, 'gate-stats.json');
  if (fs.existsSync(localStatsPath)) return localStatsPath;
  const resolved = path.resolve(feedbackDir);
  const homeTg = path.resolve(stateDir);
  const projRoot = path.resolve(PROJECT_ROOT);
  const tmpRoot = path.resolve(require('node:os').tmpdir());
  const explicitFeedbackDir = Boolean(String(process.env.THUMBGATE_FEEDBACK_DIR || '').trim());
  const isProjectFeedbackSubdir = !explicitFeedbackDir && (
    resolved.endsWith(`${path.sep}.thumbgate`)
    || resolved.endsWith(`${path.sep}.thumbgate-compat`)
    || resolved.endsWith(`${path.sep}.claude${path.sep}memory${path.sep}feedback`)
  );
  const inDefaultScope = (
    resolved === homeTg
    || resolved.startsWith(`${homeTg}${path.sep}`)
    || resolved === projRoot
    || resolved.startsWith(`${projRoot}${path.sep}`)
    || isProjectFeedbackSubdir
  ) && !resolved.includes(`${path.sep}tenants${path.sep}`) && !resolved.startsWith(`${tmpRoot}${path.sep}`);
  return inDefaultScope ? defaultStatsPath : localStatsPath;
}

function computeGateStats(feedbackDir) {
  const autoGatesPath = getAutoGatesPath();
  const statsPath = resolveScopedGateStatsPath(feedbackDir);
  const stats = readJsonFile(statsPath) || { blocked: 0, warned: 0, passed: 0, byGate: {} };
  const defaultGates = readJsonFile(DEFAULT_GATES_PATH);
  const autoGates = readJsonFile(autoGatesPath);
  const manualCount = defaultGates && Array.isArray(defaultGates.gates) ? defaultGates.gates.length : 0;
  const autoCount = autoGates && Array.isArray(autoGates.gates) ? autoGates.gates.length : 0;
  const totalGates = manualCount + autoCount;

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

function formatStorageBytes(bytes) {
  const n = Number.isFinite(bytes) && bytes > 0 ? Math.trunc(bytes) : 0;
  if (n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function measureDirBytesBounded(targetPath, depth = 0) {
  if (depth > 3 || !targetPath || !fs.existsSync(targetPath)) return 0;
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) return 0;
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(targetPath).slice(0, 128)) {
      total += measureDirBytesBounded(path.join(targetPath, entry), depth + 1);
    }
    return total;
  } catch {
    return 0;
  }
}

function formatDisplayStoragePath(rawDir) {
  const resolved = path.resolve(String(rawDir || ''));
  const home = process.env.HOME ? path.resolve(process.env.HOME) : '';
  if (home && (resolved === home || resolved.startsWith(`${home}${path.sep}`))) {
    return `~${resolved.slice(home.length)}`;
  }
  return path.basename(path.dirname(resolved))
    ? `${path.basename(path.dirname(resolved))}/${path.basename(resolved)}`
    : path.basename(resolved) || '.thumbgate';
}

function computeLessonStorageSummary(feedbackDir, memoryCount = 0) {
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const trackedNames = ['memory-log.jsonl', 'prevention-rules.md', 'auto-promoted-gates.json', 'lancedb', 'vectors'];
  let lessonDbBytes = 0;
  for (const name of trackedNames) {
    lessonDbBytes += measureDirBytesBounded(path.join(feedbackDir, name), 0);
  }
  const dirDisplay = formatDisplayStoragePath(feedbackDir);
  return {
    label: '100% On-Device Private Memory',
    location: `${dirDisplay}/memory-log.jsonl`,
    exists: fs.existsSync(memoryLogPath),
    lessonCount: Number.isFinite(memoryCount) && memoryCount > 0 ? Math.trunc(memoryCount) : 0,
    lessonDbBytes,
    lessonDbSizeDisplay: formatStorageBytes(lessonDbBytes),
  };
}

const FINISH_SETUP_COMMAND = 'npx thumbgate quickstart';
const FINISH_SETUP_HREF = '/install#quickstart';
const FINISH_SETUP_DETAIL = 'Run npx thumbgate quickstart to fire your first PreToolUse block and unlock the built-in safety rule pack + 3 custom block rules on the Free tier (7-day local Pro trial included).';
const ACCOUNT_ACTIVATIONS_FILENAME = 'account-activations.json';
const PAID_SETUP_TIERS = new Set(['pro', 'team', 'enterprise']);
const CLI_ACTIVATION_EVENTS = new Set([
  'first_block',
  'first_blocked_tool_call',
  'activation_first_rule_promoted',
  'cli_quickstart_activated',
  'cli_heartbeat',
  'cli_capture',
  'cli_recall',
  'cli_stats',
  'cli_init',
]);
const _backfillMtimeCache = new Map();

function isPaidSetupTier(tier) {
  return PAID_SETUP_TIERS.has(String(tier || '').trim().toLowerCase());
}

function pickEarliestStamp(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

function isBlockActivationMarker(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return Boolean(parsed.firstBlockAt || parsed.blockedAt || parsed.event === 'first_block');
}

function readActivationMarker(feedbackDir) {
  if (!feedbackDir) return null;
  const candidates = [
    path.join(feedbackDir, 'activation-recorded.json'),
    path.join(feedbackDir, 'activation', 'first-blocked-call.json'),
  ];
  if (path.basename(feedbackDir) === 'feedback') {
    const parentDir = path.dirname(feedbackDir);
    if (path.resolve(parentDir) !== path.resolve(os.tmpdir())) {
      candidates.push(
        path.join(parentDir, 'activation-recorded.json'),
        path.join(parentDir, 'activation', 'first-blocked-call.json'),
      );
    }
  }
  for (const candidate of candidates) {
    const parsed = readJsonFile(candidate);
    if (isBlockActivationMarker(parsed)) return parsed;
  }
  return null;
}
function writeActivationMarkerFile(targetDir, firstBlockAt, source = 'first_block') {
  if (!targetDir) return;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const markerPath = path.join(targetDir, 'activation-recorded.json');
    const existing = readJsonFile(markerPath) || {};
    const stamp = pickEarliestStamp(existing.firstBlockAt || existing.at, firstBlockAt) || new Date().toISOString();
    if (existing.firstBlockAt === stamp && existing.event) return;
    fs.writeFileSync(markerPath, JSON.stringify({
      ...existing,
      at: existing.at || stamp,
      firstBlockAt: stamp,
      event: existing.event || 'first_block',
      source: existing.source || source,
    }), 'utf8');
  } catch {  }
}

function loadAccountActivations(baseFeedbackDir) {
  const empty = { version: 1, adminFirstBlockAt: null, byCustomerId: {}, byEmailHash: {}, byInstallId: {} };
  if (!baseFeedbackDir) return empty;
  const raw = readJsonFile(path.join(baseFeedbackDir, ACCOUNT_ACTIVATIONS_FILENAME));
  if (!raw || typeof raw !== 'object') return empty;
  return {
    version: 1,
    adminFirstBlockAt: raw.adminFirstBlockAt || null,
    byCustomerId: raw.byCustomerId && typeof raw.byCustomerId === 'object' ? raw.byCustomerId : {},
    byEmailHash: raw.byEmailHash && typeof raw.byEmailHash === 'object' ? raw.byEmailHash : {},
    byInstallId: raw.byInstallId && typeof raw.byInstallId === 'object' ? raw.byInstallId : {},
  };
}

function saveAccountActivations(baseFeedbackDir, store) {
  if (!baseFeedbackDir) return;
  try {
    fs.mkdirSync(baseFeedbackDir, { recursive: true });
    fs.writeFileSync(path.join(baseFeedbackDir, ACCOUNT_ACTIVATIONS_FILENAME), JSON.stringify(store), 'utf8');
  } catch {  }
}

function upsertActivationEntry(map, key, firstBlockAt, source, maxKeys = 0) {
  if (!key) return false;
  const prev = map[key];
  if (!prev && maxKeys > 0 && Object.keys(map).length >= maxKeys) return false;
  const nextAt = pickEarliestStamp(prev && prev.firstBlockAt, firstBlockAt);
  if (prev && prev.firstBlockAt === nextAt) return false;
  map[key] = { firstBlockAt: nextAt, source: (prev && prev.source) || source || 'first_block' };
  return true;
}

function recordHostedFirstBlock(baseFeedbackDir, params = {}) {
  const stamp = params.firstBlockAt || new Date().toISOString();
  const source = params.source || 'first_block';
  const store = loadAccountActivations(baseFeedbackDir);
  let changed = false;
  if (params.isAdmin) {
    const nextAdmin = pickEarliestStamp(store.adminFirstBlockAt, stamp);
    if (store.adminFirstBlockAt !== nextAdmin) {
      store.adminFirstBlockAt = nextAdmin;
      changed = true;
    }
    writeActivationMarkerFile(baseFeedbackDir, nextAdmin, source);
  }
  if (upsertActivationEntry(store.byCustomerId, params.customerId, stamp, source)) changed = true;
  if (upsertActivationEntry(store.byEmailHash, params.emailHash, stamp, source)) changed = true;
  if (upsertActivationEntry(store.byInstallId, params.installId, stamp, source, 4096)) changed = true;
  if (changed) saveAccountActivations(baseFeedbackDir, store);
  if (params.tenantDir) writeActivationMarkerFile(params.tenantDir, stamp, source);
  const resolved = (params.customerId && store.byCustomerId[params.customerId]?.firstBlockAt)
    || (params.emailHash && store.byEmailHash[params.emailHash]?.firstBlockAt)
    || (params.installId && store.byInstallId[params.installId]?.firstBlockAt)
    || (params.isAdmin && store.adminFirstBlockAt)
    || stamp;
  return { firstBlockAt: resolved, store };
}

function statMtimeSafe(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return 0; }
}

function resolveFunnelPathForBackfill(baseFeedbackDir) {
  return process.env._TEST_FUNNEL_LEDGER_PATH
    || process.env.THUMBGATE_FUNNEL_LEDGER_PATH
    || path.join(baseFeedbackDir, 'funnel-events.jsonl');
}

function collectTelemetryCliInstalls(baseFeedbackDir) {
  const installs = new Map();
  let earliestOwnerOrCli = null;
  const telemetryRows = readJSONL(path.join(baseFeedbackDir, 'telemetry-pings.jsonl'), {
    maxEntries: 100000,
    maxBytes: 64 * 1024 * 1024,
  });
  for (const row of telemetryRows) {
    if (!row || row.visitorType === 'bot' || row.visitorType === 'ci') continue;
    const ev = String(row.eventType || row.event || '');
    if (!CLI_ACTIVATION_EVENTS.has(ev) && row.clientType !== 'cli') continue;
    const ts = row.firstBlockAt || row.timestamp || row.receivedAt || new Date().toISOString();
    earliestOwnerOrCli = pickEarliestStamp(earliestOwnerOrCli, ts);
    if (row.installId && installs.size < 4096) {
      installs.set(row.installId, pickEarliestStamp(installs.get(row.installId), ts));
    }
  }
  const funnelRows = readJSONL(resolveFunnelPathForBackfill(baseFeedbackDir), {
    maxEntries: 50000,
    maxBytes: 16 * 1024 * 1024,
  });
  const customerStamps = new Map();
  for (const row of funnelRows) {
    if (!row || row.stage !== 'activation' || row.event === 'api_key_first_usage') continue;
    const ts = row.timestamp || row.createdAt || new Date().toISOString();
    earliestOwnerOrCli = pickEarliestStamp(earliestOwnerOrCli, ts);
    if (row.installId && installs.size < 4096) installs.set(row.installId, pickEarliestStamp(installs.get(row.installId), ts));
    const cid = row.metadata && row.metadata.customerId;
    if (cid) customerStamps.set(String(cid), pickEarliestStamp(customerStamps.get(String(cid)), ts));
  }
  return { installs, customerStamps, earliestOwnerOrCli };
}

function backfillHostedAccountActivations(baseFeedbackDir, opts = {}) {
  if (!baseFeedbackDir) return { backfilled: 0 };
  const keySig = Object.values((opts.keyStore && opts.keyStore.keys) || {})
    .map((m) => `${m?.customerId || ''}|${m?.installId || ''}|${m?.active ? 1 : 0}|${m?.firstBlockAt ? 1 : 0}`).join(';');
  const sig = [
    statMtimeSafe(path.join(baseFeedbackDir, 'telemetry-pings.jsonl')),
    statMtimeSafe(resolveFunnelPathForBackfill(baseFeedbackDir)),
    statMtimeSafe(path.join(baseFeedbackDir, 'marketing-install-emails.jsonl')),
    statMtimeSafe(path.join(baseFeedbackDir, 'account-activations.json')),
    Boolean(opts.includeAdmin),
    Boolean(opts.includeActivePaidKeys),
    (opts.ownerEmails || []).join(','),
    keySig,
  ].join(':');
  if (!opts.force && _backfillMtimeCache.get(baseFeedbackDir) === sig) {
    return { backfilled: 0, cached: true };
  }
  const store = loadAccountActivations(baseFeedbackDir);
  const { installs, customerStamps, earliestOwnerOrCli } = collectTelemetryCliInstalls(baseFeedbackDir);
  let backfilled = 0;
  for (const [installId, ts] of installs.entries()) {
    if (upsertActivationEntry(store.byInstallId, installId, ts, 'telemetry_backfill')) backfilled += 1;
  }
  for (const [cid, ts] of customerStamps.entries()) {
    if (upsertActivationEntry(store.byCustomerId, cid, ts, 'funnel_backfill')) backfilled += 1;
  }
  const hashEmail = typeof opts.hashEmail === 'function' ? opts.hashEmail : null;
  const hashTenant = typeof opts.hashCustomerTenant === 'function' ? opts.hashCustomerTenant : null;
  const emailRows = readJSONL(path.join(baseFeedbackDir, 'marketing-install-emails.jsonl'));
  for (const row of emailRows) {
    const email = String(row?.email || '').trim().toLowerCase();
    const matchedAt = row?.installId && store.byInstallId[row.installId]?.firstBlockAt;
    if (email && matchedAt && hashEmail) {
      const emailHash = hashEmail(email);
      if (upsertActivationEntry(store.byEmailHash, emailHash, matchedAt, 'install_email_backfill')) backfilled += 1;
      writeActivationMarkerFile(path.join(baseFeedbackDir, 'tenants', emailHash), matchedAt, 'install_email_backfill');
    }
  }
  const ownerStamp = earliestOwnerOrCli || new Date().toISOString();
  for (const rawOwner of opts.ownerEmails || []) {
    const ownerEmail = String(rawOwner || '').trim().toLowerCase();
    if (ownerEmail && hashEmail) {
      const emailHash = hashEmail(ownerEmail);
      if (upsertActivationEntry(store.byEmailHash, emailHash, ownerStamp, 'owner_backfill')) backfilled += 1;
      writeActivationMarkerFile(path.join(baseFeedbackDir, 'tenants', emailHash), ownerStamp, 'owner_backfill');
    }
  }
  if (opts.includeAdmin || earliestOwnerOrCli) {
    const nextAdmin = pickEarliestStamp(store.adminFirstBlockAt, ownerStamp);
    if (store.adminFirstBlockAt !== nextAdmin) {
      store.adminFirstBlockAt = nextAdmin;
      backfilled += 1;
    }
    writeActivationMarkerFile(baseFeedbackDir, nextAdmin, 'owner_backfill');
  }
  const keys = (opts.keyStore && opts.keyStore.keys) || {};
  for (const [key, meta] of Object.entries(keys)) {
    if (!meta || !meta.active) continue;
    const normEmail = String(meta.customerEmail || '').trim().toLowerCase();
    const emailHash = normEmail && hashEmail ? hashEmail(normEmail) : null;
    const isFree = String(meta.plan || '').toLowerCase() === 'free' || String(meta.tier || '').toLowerCase() === 'free';
    const matchedStamp = meta.firstBlockAt
      || (meta.installId && store.byInstallId[meta.installId]?.firstBlockAt)
      || (meta.customerId && store.byCustomerId[meta.customerId]?.firstBlockAt)
      || (emailHash && store.byEmailHash[emailHash]?.firstBlockAt)
      || (!isFree && Number(meta.usageCount) > 0 ? (meta.createdAt || ownerStamp) : null)
      || (opts.includeActivePaidKeys && !isFree ? (meta.createdAt || ownerStamp) : null);
    if (!matchedStamp) continue;
    if (meta.customerId && upsertActivationEntry(store.byCustomerId, meta.customerId, matchedStamp, 'account_backfill')) backfilled += 1;
    if (emailHash && upsertActivationEntry(store.byEmailHash, emailHash, matchedStamp, 'account_backfill')) backfilled += 1;
    if (!meta.firstBlockAt && typeof opts.recordKeyFirstBlock === 'function') {
      opts.recordKeyFirstBlock({ apiKey: key }, { firstBlockAt: matchedStamp });
      backfilled += 1;
    }
    if (meta.customerId && hashTenant) {
      writeActivationMarkerFile(path.join(baseFeedbackDir, 'tenants', hashTenant(meta.customerId)), matchedStamp, 'account_backfill');
    }
  }
  if (backfilled > 0) saveAccountActivations(baseFeedbackDir, store);
  _backfillMtimeCache.set(baseFeedbackDir, sig);
  return { backfilled, activatedInstalls: Object.keys(store.byInstallId).length };
}

function countRecordedGateBlocks(auditEntries, gateAudit, gateStats) {
  let auditDenies = 0;
  for (const ev of auditEntries) {
    if (ev?.decision === 'deny' || ev?.decision === 'block') {
      auditDenies += 1;
    }
  }
  const seriesDenies = Number(gateAudit?.totals?.deny) || 0;
  const statsBlocked = Number(gateStats?.blocked) || 0;
  const topBlocked = Number(gateStats?.topBlockedCount) || 0;
  return Math.max(auditDenies, seriesDenies, statsBlocked, topBlocked);
}

function computeTodayOverview(feedbackDir, options = {}) {
  const memoryEntries = Array.isArray(options.memoryEntries) ? options.memoryEntries : readJSONL(path.join(feedbackDir, 'memory-log.jsonl'));
  const auditEntries = Array.isArray(options.auditEntries) ? options.auditEntries : readJSONL(path.join(feedbackDir, AUDIT_LOG_FILENAME));
  const gateStats = options.gateStats || computeGateStats(feedbackDir);
  const gateAudit = options.gateAudit || computeGateAuditSeries(feedbackDir);

  const todayBucket = Array.isArray(gateAudit.days) && gateAudit.days.length > 0
    ? gateAudit.days[gateAudit.days.length - 1]
    : { deny: 0, warn: 0, allow: 0 };
  const gateStatusChips = {
    blockedToday: Number(todayBucket.deny) || 0,
    warnedToday: Number(todayBucket.warn) || 0,
    activeGates: Number(gateStats.totalGates) || 0,
  };

  const totalGateBlocks = countRecordedGateBlocks(auditEntries, gateAudit, gateStats);
  const marker = readActivationMarker(feedbackDir);
  const firstBlockAt = options.firstBlockAt || marker?.firstBlockAt || marker?.blockedAt || null;
  const paidAccount = isPaidSetupTier(options.tier);
  const hasActivationOrHeartbeat = Boolean(firstBlockAt || marker || options.activationRecorded || options.cliHeartbeat);
  const setupSignalKnown = options.setupSignalKnown !== false;
  const firstBlockRecorded = totalGateBlocks > 0 || paidAccount || hasActivationOrHeartbeat;
  const upNext = (!setupSignalKnown || firstBlockRecorded)
    ? null
    : {
      kind: 'finish_setup',
      kicker: 'Finish setup',
      title: 'Finish setup to record your first gate block →',
      detail: FINISH_SETUP_DETAIL,
      command: FINISH_SETUP_COMMAND,
      reward: 'Built-in safety rule pack + 3 custom block rules on Free tier (7-day local Pro trial included)',
      actionLabel: 'Finish setup →',
      actionTab: null,
      actionHref: FINISH_SETUP_HREF,
    };

  return {
    firstBlockRecorded,
    firstBlockAt,
    totalGateBlocks,
    upNext,
    gateStatusChips,
    lessonStorage: computeLessonStorageSummary(feedbackDir, memoryEntries.length),
  };
}

function computePreventionImpact(feedbackDir, gateStats) {
  const autoGatesPath = getAutoGatesPath();
  const preventionRulesPath = path.join(feedbackDir, 'prevention-rules.md');
  let ruleCount = 0;
  if (fs.existsSync(preventionRulesPath)) {
    const content = fs.readFileSync(preventionRulesPath, 'utf-8');
    const headers = content.match(/^## /gm);
    ruleCount = headers ? headers.length : 0;
  }

  const estimatedMinutesSaved = gateStats.blocked * 16;
  const estimatedHoursSaved = Number((estimatedMinutesSaved / 60).toFixed(1));

  const estimatedCostSavingsCents = gateStats.blocked * (16 / 60) * 1.5 * 100; 
  const estimatedCostSavings = `$${(estimatedCostSavingsCents / 100).toFixed(2)}`;

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

  const feedbackCount = gateStats.blocked; 
  const conversionRate = feedbackCount > 0 ? Math.min(gateStats.totalGates / feedbackCount, 1) : 0;

  return {
    estimatedHoursSaved,
    estimatedCostSavings,
    ruleCount,
    lastPromotion,
    feedbackToGateConversionRate: Number(conversionRate.toFixed(4)),
    blockedActions: gateStats.blocked || 0,
  };
}

function computeRoiSummary(gateStats, prevention, analytics, billing) {

  const blockedActions = gateStats.blocked || 0;
  const warnedActions = gateStats.warned || 0;
  const passedActions = gateStats.passed || 0;

  const hoursSaved = prevention.estimatedHoursSaved || 0;

  const funnel = analytics.funnel || {};
  const visitorToPaidRate = funnel.visitorToPaidRate || 0;
  const ctaToPaidRate = funnel.ctaToPaidRate || 0;

  const paidOrders = funnel.paidOrders || 0;
  const monthlyRevenueCents = billing.revenue ? billing.revenue.bookedRevenueCents || 0 : 0;
  const monthlyRevenue = monthlyRevenueCents / 100;

  const totalActions = blockedActions + warnedActions + passedActions;
  const preventionRate = totalActions > 0 ? (blockedActions / totalActions) : 0;

  const decisionMetrics = analytics.decisionMetrics || {};
  const prMergeRate = decisionMetrics.mergeRate || 0;

  return {
    hoursSaved: Number(hoursSaved.toFixed(1)),
    preventionRate: Number(preventionRate.toFixed(4)),
    blockedActions,

    visitorToPaidRate: Number((visitorToPaidRate * 100).toFixed(2)),
    ctaToPaidRate: Number((ctaToPaidRate * 100).toFixed(2)),

    monthlyRevenue: Number(monthlyRevenue.toFixed(2)),
    paidOrders,

    monthlyRevenueTarget: 3000, 
    revenueProgress: monthlyRevenue > 0 ? (monthlyRevenue / 3000 * 100).toFixed(1) : 0,

    prMergeRate: Number((prMergeRate * 100).toFixed(1)),
  };
}

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
    mcpServerRunning: true, 
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
  const checkoutKeys = new Set(checkoutStartEntries.map((x) => resolveJourneyKey(x)).filter(Boolean));
  const acquisitionKeys = new Set(acquisitionEntries.map((x) => resolveJourneyKey(x)).filter(Boolean));
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
    firstPartyTrafficQuality: telemetry.trafficQuality || {
      rawEvents: telemetry.totalEvents || 0,
      externalEvents: 0,
      excludedEvents: 0,
      exclusionRate: 0,
      byAudience: {},
      byExclusionReason: {},
      external: {
        uniqueVisitors: 0,
        pageViews: 0,
        checkoutStarts: 0,
      },
      verdict: 'missing',
    },
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
  const byType = {};
  const byService = {};
  let promptBlocks = 0;

  for (const entry of secretEntries) {
    if (entry.step === 'user_prompt_submit') {
      promptBlocks += 1;
    }
    const metaType = entry.metadata?.type ? String(entry.metadata.type) : null;
    const metaService = entry.metadata?.serviceGuess
      ? String(entry.metadata.serviceGuess)
      : null;
    if (metaType) {
      byType[metaType] = (byType[metaType] || 0) + 1;
    }
    if (metaService) {
      byService[metaService] = (byService[metaService] || 0) + 1;
    }
    const violations = Array.isArray(entry.diagnosis?.violations)
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
    preventedLeaks: secretEntries.length,
    promptBlocks,
    byType,
    byService,
    topConstraint: topConstraint ? { key: topConstraint[0], count: topConstraint[1] } : null,
    recent: secretEntries
      .slice(-5)
      .reverse()
      .map((entry) => ({
        step: entry.step || null,
        source: entry.source || null,
        type: entry.metadata?.type || null,
        serviceGuess: entry.metadata?.serviceGuess || null,
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

function computeAgentFileAudit(projectRoot = PROJECT_ROOT) {
  const auditResults = {
    totalAgentFiles: 0,
    auditPassCount: 0,
    auditFailCount: 0,
    files: [],
    lastAuditAt: new Date().toISOString(),
  };

  const agentFilePatterns = [
    '.mcp.json',
    '.cursor/mcp.json',
    '.claude/claude.json',
    '.gemini/rules.json',
  ];

  const agentFiles = [];

  for (const pattern of agentFilePatterns) {
    const fullPath = path.join(projectRoot, pattern);
    if (fs.existsSync(fullPath)) {
      agentFiles.push({ path: pattern, fullPath });
    }
  }

  const adaptersDir = path.join(projectRoot, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    const entries = fs.readdirSync(adaptersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mcpPath = path.join(adaptersDir, entry.name, '.mcp.json');
        if (fs.existsSync(mcpPath)) {
          agentFiles.push({ path: `adapters/${entry.name}/.mcp.json`, fullPath: mcpPath });
        }
      }
    }
  }

  const pluginsDir = path.join(projectRoot, 'plugins');
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mcpPath = path.join(pluginsDir, entry.name, '.mcp.json');
        if (fs.existsSync(mcpPath)) {
          agentFiles.push({ path: `plugins/${entry.name}/.mcp.json`, fullPath: mcpPath });
        }
      }
    }
  }

  auditResults.totalAgentFiles = agentFiles.length;

  for (const file of agentFiles) {
    try {
      const content = fs.readFileSync(file.fullPath, 'utf-8');
      const config = JSON.parse(content);

      let auditPass = true;
      const issues = [];

      if (!config.permissions && !config.allowAllPermissions) {
      }

      if (config.mcpServers) {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          if (!server.command) {
            auditPass = false;
            issues.push(`Server ${name} missing command`);
          }
          if (server.cwd && !path.isAbsolute(server.cwd)) {
            auditPass = false;
            issues.push(`Server ${name} has relative cwd`);
          }
        }
      }

      auditResults.auditPassCount += auditPass ? 1 : 0;
      auditResults.auditFailCount += auditPass ? 0 : 1;
      auditResults.files.push({
        path: file.path,
        auditPass,
        issues: auditPass ? [] : issues,
        size: fs.statSync(file.fullPath).size,
      });
    } catch (err) {
      auditResults.auditFailCount += 1;
      auditResults.files.push({
        path: file.path,
        auditPass: false,
        issues: [`Parse error: ${err.message}`],
        size: 0,
      });
    }
  }

  const serverCardPath = path.join(projectRoot, '.well-known', 'mcp', 'server-card.json');
  if (fs.existsSync(serverCardPath)) {
    auditResults.serverCard = {
      present: true,
      path: '.well-known/mcp/server-card.json',
    };
  }

  return auditResults;
}

function computeAgentFileAuditFromFeedback(feedbackDir, options = {}) {
  const readiness = options.readiness || generateAgentReadinessReport({ projectRoot: PROJECT_ROOT });
  const auditResults = computeAgentFileAudit();

  return {
    totalAgentFiles: auditResults.totalAgentFiles,
    audited: auditResults.auditPassCount === auditResults.totalAgentFiles,
    highRiskCount: auditResults.auditFailCount,
    readinessScore: readiness.score || 0,
    lastAuditAt: auditResults.lastAuditAt,
    details: auditResults.files.map(f => ({
      path: f.path,
      safe: f.auditPass,
      issues: f.issues,
    })),
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
  const quality = telemetry.trafficQuality || analytics.firstPartyTrafficQuality || {};
  const external = quality.external || {};
  const cli = telemetry.cli || {};
  const plausibleExportConfigured = Boolean(
    process.env.PLAUSIBLE_API_KEY && (process.env.PLAUSIBLE_SITE_ID || process.env.PLAUSIBLE_DOMAIN)
  );
  const posthogExportConfigured = Boolean(
    (process.env.POSTHOG_PERSONAL_API_KEY || process.env.POSTHOG_API_KEY) && process.env.POSTHOG_PROJECT_ID
  );
  const ga4ExportConfigured = Boolean(
    process.env.GA4_PROPERTY_ID && (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLIENT_EMAIL)
  );
  const dashboardGradeExportReady = plausibleExportConfigured || posthogExportConfigured || ga4ExportConfigured;

  return {
    plausibleConfigured: /plausible\.io\/js\/script(?:\.tagged-events)?\.js|\/js\/analytics\.js/.test(landingPage),
    ga4Configured: Boolean(runtimeConfig.gaMeasurementId),
    googleSearchConsoleConfigured: Boolean(runtimeConfig.googleSiteVerification),
    softwareApplicationSchemaPresent: /"@type": "SoftwareApplication"/.test(landingPage),
    faqSchemaPresent: /"@type": "FAQPage"/.test(landingPage),
    telemetryEventsPresent: (telemetry.totalEvents || 0) > 0,
    uniqueVisitorsTracked: visitors.uniqueVisitors || 0,
    rawTelemetryEvents: quality.rawEvents || telemetry.totalEvents || 0,
    externalTelemetryEvents: quality.externalEvents || 0,
    excludedTelemetryEvents: quality.excludedEvents || 0,
    externalVisitorsTracked: external.uniqueVisitors || 0,
    externalPageViewsTracked: external.pageViews || 0,
    externalCheckoutStartsTracked: external.checkoutStarts || 0,
    externalVisitorPathsTracked: Array.isArray(external.visitorPaths) ? external.visitorPaths.length : 0,
    internalTestPollutionRate: quality.exclusionRate || 0,
    trafficQualityVerdict: quality.verdict || 'missing',
    topExcludedTrafficReason: quality.topExclusionReason || null,
    plausibleExportConfigured,
    posthogExportConfigured,
    ga4ExportConfigured,
    dashboardGradeExportReady,
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
    ? Object.keys(parsed.mcpServers).sort((left, right) => left.localeCompare(right))
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
    ...(() => {
      const audit = computeAgentFileAuditFromFeedback(feedbackDir, options);
      return {
        totalAgentFiles: audit.totalAgentFiles,
        audited: audit.audited,
        highRiskCount: audit.highRiskCount,
        lastAuditAt: audit.lastAuditAt,
      };
    })(),
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

function collectAllFeedbackEntries(feedbackDir) {
  if (shouldAggregateFeedback()) {
    return collectAggregateLogEntries('feedback-log.jsonl', {
      feedbackDir,
      maxLines: DEFAULT_JSONL_MAX_ENTRIES,
      maxBytes: DEFAULT_JSONL_MAX_BYTES,
    }).entries;
  }

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

  mergeFrom(path.join(feedbackDir, 'feedback-log.jsonl'));

  const projectsDir = path.join(feedbackDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    try {
      for (const project of fs.readdirSync(projectsDir)) {
        mergeFrom(path.join(projectsDir, project, 'feedback-log.jsonl'));
      }
    } catch {  }
  }

  const homeThumbgate = path.join(process.env.HOME || '/tmp', '.thumbgate');
  const projectLocalDir = path.join(PROJECT_ROOT, '.thumbgate');
  if (
    path.resolve(feedbackDir) === path.resolve(homeThumbgate) &&
    projectLocalDir !== feedbackDir &&
    fs.existsSync(projectLocalDir)
  ) {
    mergeFrom(path.join(projectLocalDir, 'feedback-log.jsonl'));
  }

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
  const entries = selectDashboardFeedback(collectAllFeedbackEntries(feedbackDir), options.humanOnly);
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
  const gateStats = mergeRepeatMetricIntoGateStats(computeGateStats(feedbackDir));
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
  const feedbackAnalysis = analyzeFeedback(path.join(feedbackDir, 'feedback-log.jsonl'), {
    entries,
    humanOnly: options.humanOnly,
    maxLines: DEFAULT_JSONL_MAX_ENTRIES,
    maxBytes: DEFAULT_JSONL_MAX_BYTES,
  });
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

  let tokenSavings = null;
  try {
    const { computeTokenSavings } = require('./token-savings');
    tokenSavings = computeTokenSavings({
      blockedCalls: Number(gateStats.blocked) || 0,
    });
  } catch {  }

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
  const todayOverview = computeTodayOverview(feedbackDir, {
    entries,
    memoryEntries,
    auditEntries,
    gateStats,
    gateAudit,
    gates,
    now: options.now,
    tier: options.tier,
    authContext: options.authContext,
    firstBlockAt: options.firstBlockAt,
    activationRecorded: options.activationRecorded,
    cliHeartbeat: options.cliHeartbeat,
    setupSignalKnown: options.setupSignalKnown,
  });
  const agentRegister = buildAgentRegister({
    dataDir: feedbackDir,
    windowDays: 30,
    now: options.now,
  });

  const roiSummary = computeRoiSummary(gateStats, prevention, analytics, billingSummary);
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
    agentRegister,
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
    todayOverview,
    lessonPipeline: {
      stages: lessonPipeline.stages,
      rates: lessonPipeline.rates,
    },
  };
}

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
  console.log(`  External Visitors: ${instrumentation.externalVisitorsTracked}`);
  console.log(`  Sessions         : ${analytics.trafficMetrics.sessions}`);
  console.log(`  Page Views       : ${analytics.trafficMetrics.pageViews}`);
  console.log(`  External Views   : ${instrumentation.externalPageViewsTracked}`);
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
  console.log(`  Data Quality     : ${analytics.firstPartyTrafficQuality.verdict} (${instrumentation.excludedTelemetryEvents}/${instrumentation.rawTelemetryEvents} excluded)`);
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
  console.log(`  Clean Visitors   : ${instrumentation.externalVisitorsTracked} external (${Math.round((instrumentation.internalTestPollutionRate || 0) * 100)}% internal/test/bot events)`);
  console.log(`  Clean Paths      : ${instrumentation.externalVisitorPathsTracked} first-party paths`);
  if (instrumentation.topExcludedTrafficReason) {
    console.log(`  Top Exclusion    : ${instrumentation.topExcludedTrafficReason.key} (${instrumentation.topExcludedTrafficReason.count}\u00D7)`);
  }
  console.log(`  Plausible Export : ${instrumentation.plausibleExportConfigured ? 'configured' : 'missing API credentials'}`);
  console.log(`  PostHog Export   : ${instrumentation.posthogExportConfigured ? 'configured' : 'missing API credentials'}`);
  console.log(`  GA4 Export       : ${instrumentation.ga4ExportConfigured ? 'configured' : 'missing API credentials'}`);
  console.log(`  Visitor Paths    : ${instrumentation.dashboardGradeExportReady ? 'export-ready' : 'not dashboard-grade in repo'}`);
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

module.exports = {
  generateDashboard,
  buildReviewSnapshot,
  readDashboardReviewState,
  writeDashboardReviewState,
  printDashboard,
  computeApprovalStats,
  computeDecisionMetrics,
  computeGateStats,
  computeTodayOverview,
  isPaidSetupTier,
  CLI_ACTIVATION_EVENTS,
  loadAccountActivations,
  recordHostedFirstBlock,
  backfillHostedAccountActivations,
  computeLessonStorageSummary,
  computePreventionImpact,
  computeRoiSummary,
  computeSessionTrend,
  computeSystemHealth,
  computeEfficiencyMetrics,
  computeHarnessOverview,
  getInterventionPolicySummary,
  computeAnalyticsSummary,
  computeSecretGuardStats,
  computeObservabilityStats,
  computeAgentFileAudit,
  computeAgentSurfaceInventory,
  readJSONL,
  readTextTail,
  readJsonFile,
  collectAllFeedbackEntries,
  DEFAULT_JSONL_MAX_BYTES,
  DEFAULT_JSONL_MAX_ENTRIES,
};

if (require.main === module) {
  const { getFeedbackPaths } = require('./feedback-loop');
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = generateDashboard(FEEDBACK_DIR);
  printDashboard(data);
}
