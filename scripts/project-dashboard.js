'use strict';

const { readProjectRows, readProjectGates, buildProjectCatalog } = require('./project-catalog');

// When the caller names the project folder, count feedback exactly as the status line does
// (same stores, same human filter), so "this project" and the dashboard cannot disagree.
function projectFeedback(keyedRows, options) {
  if (options.projectDir && options.projectKey && options.projectKey !== 'unassigned') {
    const env = { ...(options.env || process.env) };
    delete env.THUMBGATE_FEEDBACK_DIR;
    delete env.THUMBGATE_PROJECT_DIR;
    const counted = require('./statusline-human-counts').collectHumanRows({ cwd: options.projectDir, projectDir: options.projectDir, env });
    if (counted.projectKey === options.projectKey) {
      const isUp = (row) => ['up', 'positive', 'thumbs_up'].includes(String(row.signal || row.feedback).toLowerCase());
      return counted.rows.map((row) => ({ ...row, signal: isUp(row) ? 'positive' : 'negative' }));
    }
  }
  return keyedRows.filter((row) => !options.humanOnly || !row.reviewOrigin || row.reviewOrigin === 'human');
}

function generateProjectDashboard(feedbackDir, options = {}) {
  const dashboard = require('./dashboard');
  options = { ...options, attribution: options.attribution || require('./project-catalog').accountAttribution(feedbackDir, options) };
  const rows = (file) => readProjectRows(feedbackDir, file, options);
  const feedback = projectFeedback(rows('feedback-log.jsonl'), options);
  const memories = rows('memory-log.jsonl');
  const audit = rows('audit-trail.jsonl');
  const gates = readProjectGates(feedbackDir, options).filter((gate) => gate.active !== false && gate.enabled !== false).map((gate) => ({ ...gate, name: gate.name || gate.id, scopeLabel: gate.scope === 'global' ? 'Global' : 'Project' }));
  const byGate = {};
  const gateStats = { totalGates: gates.length, manualCount: gates.filter((g) => g.scope === 'global').length, autoCount: gates.filter((g) => g.scope === 'project').length, blocked: 0, warned: 0, passed: 0, byGate };
  for (const row of audit) {
    const metric = ['deny', 'block'].includes(row.decision) ? 'blocked' : row.decision === 'warn' ? 'warned' : row.decision === 'allow' ? 'passed' : null;
    if (!metric) continue;
    gateStats[metric]++;
    const bucket = byGate[row.gateId || 'unknown'] ||= { blocked: 0, warned: 0, passed: 0 };
    bucket[metric]++;
  }
  const now = new Date(options.now || Date.now());
  const dayKey = (stamp) => { const date = new Date(stamp); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null; };
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - i);
    const key = dayKey(date);
    const signals = feedback.filter((row) => dayKey(row.timestamp) === key);
    days.push({ dayKey: key, positive: signals.filter((r) => ['positive', 'up'].includes(r.signal)).length, negative: signals.filter((r) => ['negative', 'down'].includes(r.signal)).length, total: signals.length, lessons: memories.filter((r) => dayKey(r.timestamp) === key).length });
  }
  const auditDays = days.slice(-14).map(({ dayKey: key }) => {
    const entries = audit.filter((row) => dayKey(row.timestamp) === key);
    const allow = entries.filter((r) => r.decision === 'allow').length;
    const deny = entries.filter((r) => ['deny', 'block'].includes(r.decision)).length;
    const warn = entries.filter((r) => r.decision === 'warn').length;
    return { dayKey: key, allow, deny, warn, intercepted: deny + warn, total: allow + deny + warn };
  });
  const reviewSnapshot = dashboard.buildReviewSnapshot(feedbackDir, { feedbackEntries: feedback, memoryEntries: memories, auditEntries: audit, projectRoot: null, reviewedAt: now.toISOString() });
  const baseline = dashboard.readDashboardReviewState(feedbackDir, options);
  const project = buildProjectCatalog(feedbackDir, options).projects.find((item) => item.projectKey === options.projectKey) || { projectKey: options.projectKey, projectName: options.projectKey === 'unassigned' ? 'Unassigned' : 'Project' };
  const unavailableMetrics = ['analytics', 'billing', 'prevention', 'harness', 'health', 'delegation', 'observability', 'instrumentation', 'readiness', 'agentSurfaceInventory', 'backgroundAgents', 'regulatedProof', 'interventionPolicy', 'decisions', 'settingsStatus', 'team', 'templateLibrary', 'predictive', 'tokenSavings'];
  const data = Object.fromEntries(unavailableMetrics.map((name) => [name, null]));
  const today = auditDays.at(-1);
  const feedbackAnalysis = require('./feedback-loop').analyzeFeedback(require('node:path').join(feedbackDir, 'feedback-log.jsonl'), { ...options, entries: feedback, humanOnly: false });
  return {
    ...data, projectKey: options.projectKey, project, unavailableMetrics,
    operational: { source: 'project-records' }, approval: dashboard.computeApprovalStats(feedback), gateStats, gates,
    trend: dashboard.computeSessionTrend(feedback, 10),
    gateAudit: { dayCount: 14, days: auditDays, totals: auditDays.reduce((sum, row) => { for (const key of ['allow', 'deny', 'warn', 'total', 'intercepted']) sum[key] += row[key]; return sum; }, { allow: 0, deny: 0, warn: 0, total: 0, intercepted: 0 }) },
    diagnostics: require('./failure-diagnostics').aggregateFailureDiagnostics([...feedback, ...rows('diagnostic-log.jsonl')]),
    secretGuard: dashboard.computeSecretGuardStats(rows('diagnostic-log.jsonl')),
    feedbackAnalysis,
    actionableRemediations: feedbackAnalysis.actionableRemediations || [],
    agentRegister: require('./agent-action-inventory').buildAgentRegister({ ...options, dataDir: feedbackDir }),
    reviewDelta: dashboard.summarizeReviewDelta(feedback, memories, audit, baseline, reviewSnapshot),
    feedbackTimeSeries: { days, dayCount: 30, totals: { positive: feedback.filter((r) => r.signal === 'positive').length, negative: feedback.filter((r) => r.signal === 'negative').length, total: feedback.length, lessons: memories.length } },
    todayOverview: { gateStatusChips: { blockedToday: today.deny, warnedToday: today.warn, activeGates: gates.length }, lessonStorage: { lessonCount: memories.length, location: null, bytes: null, label: 'Project lessons' }, upNext: null },
    lessonPipeline: { stages: [{ id: 'feedback', label: 'Feedback Signals', count: feedback.length }, { id: 'lessons', label: 'Lessons Distilled', count: memories.length }, { id: 'gates', label: 'Project Gates', count: gateStats.autoCount }, { id: 'blocked', label: 'Actions Blocked', count: gateStats.blocked }], rates: { feedbackToLesson: feedback.length ? Math.round(memories.length / feedback.length * 100) : 0, lessonToGate: memories.length ? Math.round(gateStats.autoCount / memories.length * 100) : 0 } },
  };
}
module.exports = { generateProjectDashboard, projectFeedback };
