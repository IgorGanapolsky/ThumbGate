#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { sanitizeToolInput } = require('./audit-trail');
const { ensureDir } = require('./fs-utils');

const DECISION_LOG_FILENAME = 'decision-journal.jsonl';
const DEFAULT_DAY_COUNT = 14;
const RESOLVED_OUTCOMES = new Set(['accepted', 'completed', 'overridden', 'rolled_back', 'blocked', 'aborted']);
const DECISION_OUTCOMES = new Set([...RESOLVED_OUTCOMES, 'warned']);

function getDecisionLogPath(feedbackDir) {
  return path.join(resolveFeedbackDir({ feedbackDir }), DECISION_LOG_FILENAME);
}


function buildActionId(prefix = 'decision') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function readDecisionLog(logPath) {
  const targetPath = logPath || getDecisionLogPath();
  if (!fs.existsSync(targetPath)) return [];
  const raw = fs.readFileSync(targetPath, 'utf8').trim();
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

function appendDecisionRecord(record, feedbackDir) {
  const logPath = getDecisionLogPath(feedbackDir);
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function toLocalDayKey(value) {
  const ts = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeOutcome(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (DECISION_OUTCOMES.has(normalized)) return normalized;
  return 'completed';
}

function inferActualDecision(outcome, fallback) {
  if (fallback) return String(fallback);
  if (outcome === 'blocked') return 'deny';
  if (outcome === 'warned') return 'warn';
  return 'allow';
}

function median(values) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function summarizeBlastRadius(report = {}) {
  const blastRadius = report.blastRadius || {};
  return {
    severity: blastRadius.severity || 'low',
    fileCount: Number(blastRadius.fileCount || 0),
    surfaceCount: Number(blastRadius.surfaceCount || 0),
    releaseSensitiveCount: Array.isArray(blastRadius.releaseSensitiveFiles) ? blastRadius.releaseSensitiveFiles.length : 0,
    protectedWithoutApprovalCount: Array.isArray(blastRadius.unapprovedProtectedFiles) ? blastRadius.unapprovedProtectedFiles.length : 0,
    summary: blastRadius.summary || '',
  };
}

function normalizeRecommendation(report = {}) {
  const control = report.decisionControl || {};
  return {
    decision: report.decision || 'allow',
    riskScore: Number(report.riskScore || 0),
    riskBand: report.band || 'low',
    executionMode: control.executionMode || (report.decision === 'deny' ? 'blocked' : report.decision === 'warn' ? 'checkpoint_required' : 'auto_execute'),
    decisionOwner: control.decisionOwner || (report.decision === 'allow' ? 'agent' : 'shared'),
    reversibility: control.reversibility || 'reviewable',
    requiresHumanApproval: control.requiresHumanApproval === true,
    summary: report.summary || '',
    recommendedAction: control.recommendedAction || (report.decision === 'deny' ? 'halt' : report.decision === 'warn' ? 'review' : 'proceed'),
  };
}

function recordDecisionEvaluation(report, params = {}, options = {}) {
  const actionId = params.actionId || buildActionId();
  const changedFiles = Array.isArray(params.changedFiles)
    ? params.changedFiles.slice()
    : Array.isArray(report && report.blastRadius && report.blastRadius.affectedFiles)
      ? report.blastRadius.affectedFiles.slice()
      : [];
  const record = {
    recordType: 'evaluation',
    actionId,
    timestamp: params.timestamp || new Date().toISOString(),
    source: params.source || 'workflow-sentinel',
    toolName: params.toolName || report.toolName || 'unknown',
    toolInput: sanitizeToolInput(params.toolInput || {}),
    changedFiles,
    recommendation: normalizeRecommendation(report),
    blastRadius: summarizeBlastRadius(report),
    learnedPolicy: report.learnedPolicy && report.learnedPolicy.enabled
      ? {
        label: report.learnedPolicy.prediction && report.learnedPolicy.prediction.label || null,
        confidence: Number((report.learnedPolicy.prediction && report.learnedPolicy.prediction.confidence) || 0),
      }
      : null,
    topRemediations: Array.isArray(report.remediations)
      ? report.remediations.slice(0, 3).map((entry) => ({ id: entry.id, title: entry.title }))
      : [],
    evidence: Array.isArray(report.evidence) ? report.evidence.slice(0, 4) : [],
  };
  return appendDecisionRecord(record, options.feedbackDir);
}

function recordDecisionOutcome(params = {}, options = {}) {
  const actionId = params.actionId || buildActionId('decision_outcome');
  const entries = readDecisionLog(getDecisionLogPath(options.feedbackDir));
  const evaluation = [...entries]
    .reverse()
    .find((entry) => entry && entry.recordType === 'evaluation' && entry.actionId === actionId) || null;
  const outcome = normalizeOutcome(params.outcome);
  const timestamp = params.timestamp || new Date().toISOString();
  const latencyMs = Number.isFinite(params.latencyMs)
    ? Number(params.latencyMs)
    : evaluation && evaluation.timestamp
      ? Math.max(0, new Date(timestamp).getTime() - new Date(evaluation.timestamp).getTime())
      : null;
  const record = {
    recordType: 'outcome',
    actionId,
    timestamp,
    source: params.source || 'api',
    actor: params.actor || 'human',
    outcome,
    actualDecision: inferActualDecision(outcome, params.actualDecision),
    notes: params.notes || '',
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    recommendation: evaluation ? evaluation.recommendation : (params.recommendation || null),
    toolName: evaluation ? evaluation.toolName : (params.toolName || 'unknown'),
    changedFiles: evaluation ? evaluation.changedFiles : (Array.isArray(params.changedFiles) ? params.changedFiles.slice() : []),
  };
  return appendDecisionRecord(record, options.feedbackDir);
}

function collapseDecisionTimeline(records) {
  const actions = new Map();
  for (const record of records) {
    if (!record || !record.actionId) continue;
    if (!actions.has(record.actionId)) {
      actions.set(record.actionId, { actionId: record.actionId, evaluation: null, outcomes: [] });
    }
    const bucket = actions.get(record.actionId);
    if (record.recordType === 'evaluation') {
      bucket.evaluation = record;
    } else if (record.recordType === 'outcome') {
      bucket.outcomes.push(record);
    }
  }
  for (const bucket of actions.values()) {
    bucket.outcomes.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  }
  return [...actions.values()].sort((left, right) => {
    const leftTs = left.evaluation ? new Date(left.evaluation.timestamp).getTime() : 0;
    const rightTs = right.evaluation ? new Date(right.evaluation.timestamp).getTime() : 0;
    return leftTs - rightTs;
  });
}

function resolveNow(now) {
  if (now instanceof Date) return new Date(now.getTime());
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now);
  if (typeof now === 'string' && now) {
    const parsed = new Date(now);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function initializeDaySeries(dayCount, now) {
  const today = resolveNow(now);
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    days.push({
      dayKey: toLocalDayKey(day),
      evaluations: 0,
      fastPath: 0,
      checkpoint: 0,
      blockedRecommendations: 0,
      overrides: 0,
      rollbacks: 0,
      completions: 0,
      blockedOutcomes: 0,
      latencies: [],
    });
  }
  return days;
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function computeDecisionMetrics(feedbackDir, options = {}) {
  const dayCount = Number.isInteger(options.dayCount) ? options.dayCount : DEFAULT_DAY_COUNT;
  const records = readDecisionLog(getDecisionLogPath(feedbackDir));
  const actions = collapseDecisionTimeline(records).filter((entry) => entry.evaluation);
  const series = initializeDaySeries(dayCount, options.now);
  const dayMap = new Map(series.map((day) => [day.dayKey, day]));
  const outcomeCounts = {
    accepted: 0,
    completed: 0,
    overridden: 0,
    rolled_back: 0,
    blocked: 0,
    aborted: 0,
    warned: 0,
  };

  let fastPathCount = 0;
  let checkpointCount = 0;
  let blockedRecommendationCount = 0;
  let overrideCount = 0;
  let rollbackCount = 0;
  let resolvedCount = 0;
  const latencyValues = [];

  for (const action of actions) {
    const evaluation = action.evaluation;
    const recommendation = evaluation.recommendation || {};
    const evalDay = dayMap.get(toLocalDayKey(evaluation.timestamp));
    if (evalDay) {
      evalDay.evaluations += 1;
      if (recommendation.executionMode === 'auto_execute') evalDay.fastPath += 1;
      if (recommendation.executionMode === 'checkpoint_required') evalDay.checkpoint += 1;
      if (recommendation.executionMode === 'blocked') evalDay.blockedRecommendations += 1;
    }

    if (recommendation.executionMode === 'auto_execute') fastPathCount += 1;
    if (recommendation.executionMode === 'checkpoint_required') checkpointCount += 1;
    if (recommendation.executionMode === 'blocked') blockedRecommendationCount += 1;

    const hasOverride = action.outcomes.some((outcome) => outcome.outcome === 'overridden');
    const hasRollback = action.outcomes.some((outcome) => outcome.outcome === 'rolled_back');
    if (hasOverride) overrideCount += 1;
    if (hasRollback) rollbackCount += 1;

    const latestOutcome = action.outcomes.length > 0 ? action.outcomes[action.outcomes.length - 1] : null;
    if (latestOutcome) {
      outcomeCounts[latestOutcome.outcome] = (outcomeCounts[latestOutcome.outcome] || 0) + 1;
      const outcomeDay = dayMap.get(toLocalDayKey(latestOutcome.timestamp));
      if (outcomeDay) {
        if (latestOutcome.outcome === 'overridden') outcomeDay.overrides += 1;
        if (latestOutcome.outcome === 'rolled_back') outcomeDay.rollbacks += 1;
        if (latestOutcome.outcome === 'completed' || latestOutcome.outcome === 'accepted') outcomeDay.completions += 1;
        if (latestOutcome.outcome === 'blocked') outcomeDay.blockedOutcomes += 1;
      }
      if (RESOLVED_OUTCOMES.has(latestOutcome.outcome)) {
        resolvedCount += 1;
      }
      if (Number.isFinite(latestOutcome.latencyMs)) {
        latencyValues.push(latestOutcome.latencyMs);
        if (outcomeDay) outcomeDay.latencies.push(latestOutcome.latencyMs);
      }
    }
  }

  const days = series.map((day) => ({
    dayKey: day.dayKey,
    evaluations: day.evaluations,
    fastPath: day.fastPath,
    checkpoint: day.checkpoint,
    blockedRecommendations: day.blockedRecommendations,
    overrides: day.overrides,
    rollbacks: day.rollbacks,
    completions: day.completions,
    blockedOutcomes: day.blockedOutcomes,
    medianLatencyMs: median(day.latencies),
  }));

  return {
    evaluationCount: actions.length,
    resolvedCount,
    fastPathCount,
    checkpointCount,
    blockedRecommendationCount,
    overrideCount,
    rollbackCount,
    outcomeCounts,
    fastPathRate: safeRate(fastPathCount, actions.length),
    checkpointRate: safeRate(checkpointCount, actions.length),
    overrideRate: safeRate(overrideCount, resolvedCount || actions.length),
    rollbackRate: safeRate(rollbackCount, resolvedCount || actions.length),
    followRate: safeRate(Math.max(0, resolvedCount - overrideCount), resolvedCount || actions.length),
    medianLatencyMs: median(latencyValues),
    averageLatencyMs: latencyValues.length > 0
      ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
      : 0,
    dayCount,
    days,
    activeDays: days.filter((day) => {
      return day.evaluations > 0 || day.overrides > 0 || day.rollbacks > 0 || day.completions > 0 || day.blockedOutcomes > 0;
    }).length,
  };
}

const WEEKLY_PRICE_DOLLARS = new Set([19, 149, 499]);

function weeklyBase(extra) {
  return {
    allow: false,
    networkCall: false,
    merge: false,
    sent: false,
    originStory: null,
    waitlistUrl: null,
    followUp: { text: '', sent: false },
    ...extra,
  };
}

function ownChildren(value) {
  if (Array.isArray(value)) return value;
  const children = [];
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    children.push(value[key]);
  }
  return children;
}

function textBlob(value, depth, seen) {
  if (value == null || depth > 5) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  return ownChildren(value)
    .map((child) => textBlob(child, depth + 1, seen))
    .filter(Boolean)
    .join('\n');
}

function dollarAmounts(blob) {
  const prices = [];
  const pattern = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g;
  let match = pattern.exec(blob);
  while (match) {
    prices.push(Number(match[1].replace(/,/g, '')));
    match = pattern.exec(blob);
  }
  return prices;
}

function nicheVerdict(value) {
  if (value == null || String(value).trim() === '') return { ok: true, niche: null };
  const niche = String(value).trim();
  if (/\beveryone\b|\ball\s+(?:developers?|athletes?|users?|teams?|customers?|people)\b/i.test(niche)) {
    return { ok: false };
  }
  return { ok: true, niche };
}

function publishedRef(shipped) {
  if (!shipped || typeof shipped !== 'object' || Array.isArray(shipped)) return '';
  if (shipped.published !== true) return '';
  const ref = String(shipped.ref || shipped.commit || shipped.pr || '').trim();
  if (!ref || /\b(?:plan|todo|idea|will ship|next week)\b/i.test(ref)) return '';
  return ref;
}

function coachingNotes(source) {
  if (source.scorecard && typeof source.scorecard === 'object') return ['scorecard', 'extra'];
  const notes = [];
  if (Array.isArray(source.insights)) {
    for (const item of source.insights) {
      const text = String(item || '').trim();
      if (text) notes.push(text);
    }
  } else if (source.insights && typeof source.insights === 'object') {
    return ['scorecard', 'extra'];
  }
  if (typeof source.insight === 'string' && source.insight.trim()) notes.push(source.insight.trim());
  return notes;
}

function oneNext(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, reason: 'missing_next' };
  if (/[\r\n]/.test(value)) return { ok: false, reason: 'next_is_one_line' };
  return { ok: true, text: value.trim() };
}

function isMoneyKind(kind) {
  return /revenue|booked|dollar|usd|charge|price/i.test(String(kind || ''));
}

function assessWeeklyShipRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return weeklyBase({ reason: 'not_a_record' });
  }
  if (input.writeOriginStory === true) {
    return weeklyBase({ reason: 'human_writes_origin' });
  }
  const niche = nicheVerdict(input.niche);
  if (!niche.ok) return weeklyBase({ reason: 'broad_niche' });
  const blob = textBlob(input, 0, new Set());
  const prices = dollarAmounts(blob);
  if (prices.some((amount) => !WEEKLY_PRICE_DOLLARS.has(amount))) {
    return weeklyBase({ reason: 'forbidden_price', prices });
  }
  if (input.waitlistUrl || input.waitlist || /waitlist|\/go\/bundle-49|\/go\/pro-direct|overskill/i.test(blob)) {
    return weeklyBase({ reason: 'waitlist_refused' });
  }
  if (input.assignTo || input.delegateTo || input.teamMember || input.assignee) {
    return weeklyBase({ reason: 'no_team' });
  }
  const shipped = publishedRef(input.shipped);
  if (!shipped) return weeklyBase({ reason: 'not_published' });
  const number = input.number;
  if (!number || typeof number !== 'object' || Array.isArray(number)) {
    return weeklyBase({ reason: 'missing_number' });
  }
  if (typeof number.value !== 'number' || !Number.isFinite(number.value)) {
    return weeklyBase({ reason: 'not_a_number' });
  }
  if (number.invented === true) return weeklyBase({ reason: 'invented_number' });
  const source = typeof number.source === 'string' ? number.source.trim() : '';
  if (!source) return weeklyBase({ reason: 'unsourced_number' });
  if (isMoneyKind(number.kind) && WEEKLY_PRICE_DOLLARS.has(number.value)) {
    return weeklyBase({ reason: 'price_is_not_revenue' });
  }
  const notes = coachingNotes(input);
  if (notes.length > 1) return weeklyBase({ reason: 'too_many_insights' });
  const next = oneNext(input.next);
  if (!next.ok) return weeklyBase({ reason: next.reason });
  const follow = input.followUp;
  let draft = '';
  if (typeof follow === 'string') draft = follow.trim();
  else if (follow && typeof follow === 'object') {
    draft = String(follow.text || follow.draft || '').trim();
  }
  return {
    allow: true,
    reason: 'weekly_ship',
    shipped,
    number: {
      value: number.value,
      source,
      kind: typeof number.kind === 'string' && number.kind.trim() ? number.kind.trim() : null,
    },
    next: next.text,
    niche: niche.niche,
    insight: notes[0] || null,
    followUp: { text: draft, sent: false },
    networkCall: false,
    merge: false,
    sent: false,
    originStory: null,
    waitlistUrl: null,
  };
}

module.exports = {
  DECISION_LOG_FILENAME,
  RESOLVED_OUTCOMES,
  assessWeeklyShipRecord,
  buildActionId,
  collapseDecisionTimeline,
  computeDecisionMetrics,
  getDecisionLogPath,
  normalizeOutcome,
  readDecisionLog,
  recordDecisionEvaluation,
  recordDecisionOutcome,
};

if (require.main === module) {
  console.log(JSON.stringify(computeDecisionMetrics(process.argv[2]), null, 2));
}
