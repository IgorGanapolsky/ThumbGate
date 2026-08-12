#!/usr/bin/env node
/**
 * hermes-mobile-launch-strategy.js — FUTRFND 90-day execution + demand validation.
 *
 * Source: futrfnd-launch-strategy-hermes-mobile.pdf (2026-08-12)
 *
 * #1 priority: validate user demand before scaling monetization.
 * Signal metrics:
 *   - User feedback rating (interview + in-app)
 *   - Free-trial → paid conversion (Bayesian Beta-Binomial for low-N)
 * Risks mitigated:
 *   - Misaligned features
 *   - Inadequate feedback loop (auto-promote pain points → rules)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILENAME = 'hermes-mobile-launch.json';
const TARGET_INTERVIEWS = 10;
const FEEDBACK_RATING_GO = 3.5;
const MIN_INTERVIEWS_FOR_MONETIZE = 5;
const MIN_TRIALS_FOR_CONVERSION_SIGNAL = 5;

/** Primary interview channels from FUTRFND plan. */
const COMMUNITY_CHANNELS = Object.freeze([
  {
    id: 'hermes-discord',
    name: 'Hermes Agent Discord / community',
    purpose: 'Observe remote-control pain; soft invite to 15-min interview',
  },
  {
    id: 'reddit-selfhosted-ai',
    name: 'r/selfhosted + r/LocalLLaMA',
    purpose: 'Value-first posts on mobile agent control; never spam',
  },
  {
    id: 'hn-show',
    name: 'Hacker News / Show HN',
    purpose: 'Launch note after demand validated (Days 31-60)',
  },
  {
    id: 'linkedin-ops',
    name: 'LinkedIn AI ops founders',
    purpose: 'Targeted outreach for interviews and design partners',
  },
]);

/** 15-minute interview script (FUTRFND primary channel). */
const INTERVIEW_SCRIPT = Object.freeze({
  durationMinutes: 15,
  offer: 'Free ThumbGate Leash trial in exchange for candid feedback',
  questions: [
    'Walk me through the last time you needed to control or approve a Hermes agent while away from your Mac.',
    'What breaks today when you try remote control (pairing, network, approvals, secrets)?',
    'Which single mobile feature would make you pay monthly — and which would you never pay for?',
    'On a scale of 1–5, how well does Hermes Mobile match your real workflow today?',
    'Who else in your org / community hits the same remote-control problem?',
  ],
});

function getStateFilePath(customStateDir = null) {
  const dir = customStateDir || process.env.THUMBGATE_STATE_DIR || path.join(process.cwd(), '.thumbgate');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, STATE_FILENAME);
}

function createEmptyLaunchState(startDateIso = new Date().toISOString()) {
  return {
    version: '1.1.0',
    startDate: startDateIso,
    strategySource: 'futrfnd-launch-strategy-hermes-mobile.pdf',
    // Honest empty defaults — no seed conversions (demand must be measured, not invented).
    outreach: [],
    trials: [],
    inAppRatings: [],
    communityTouches: [],
    analytics: {
      inAppEventsTracked: true,
      feedbackLoopActive: true,
      signalMetrics: ['user_feedback_rating', 'free_trial_to_paid'],
    },
  };
}

function loadLaunchState(customStateDir = null) {
  const filePath = getStateFilePath(customStateDir);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...createEmptyLaunchState(parsed.startDate || new Date().toISOString()),
        ...parsed,
        outreach: Array.isArray(parsed.outreach) ? parsed.outreach : [],
        trials: Array.isArray(parsed.trials) ? parsed.trials : [],
        inAppRatings: Array.isArray(parsed.inAppRatings) ? parsed.inAppRatings : [],
        communityTouches: Array.isArray(parsed.communityTouches) ? parsed.communityTouches : [],
      };
    } catch (_) {
      // Fall through to empty state.
    }
  }
  return createEmptyLaunchState();
}

function saveLaunchState(state, customStateDir = null) {
  const filePath = getStateFilePath(customStateDir);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  return filePath;
}

/**
 * Calculates the current 90-day execution sequence phase based on start date.
 */
function getExecutionPhase(startDateIso, currentDateIso = new Date().toISOString()) {
  const start = new Date(startDateIso).getTime();
  const current = new Date(currentDateIso).getTime();
  const diffDays = Math.max(0, Math.floor((current - start) / (1000 * 60 * 60 * 24)));

  if (diffDays <= 30) {
    return {
      phase: 'DAYS_1_30_FOUNDATION',
      dayNumber: diffDays + 1,
      title: 'Days 1-30: Foundation & Demand Validation',
      objectives: [
        'Conduct targeted user interviews with Hermes Agent operators',
        'Validate remote control & safety pain points',
        'Set up in-app feedback & analytics tracking',
      ],
    };
  }
  if (diffDays <= 60) {
    return {
      phase: 'DAYS_31_60_LAUNCH_LEARN',
      dayNumber: diffDays + 1,
      title: 'Days 31-60: Launch + Learn',
      objectives: [
        'Implement product refinements based on interview feedback',
        'Begin targeted outreach to broader Hermes Agent community',
        'Launch early adopter trial-to-paid promo offer',
      ],
    };
  }
  if (diffDays <= 90) {
    return {
      phase: 'DAYS_61_90_OPTIMIZE_GROW',
      dayNumber: diffDays + 1,
      title: 'Days 61-90: Optimize + Grow',
      objectives: [
        'Analyze user conversion data & onboarding bottlenecks',
        'Refine trial conversion tactics',
        'Expand community outreach channels',
      ],
    };
  }

  return {
    phase: 'DAYS_90_PLUS_SCALE',
    dayNumber: diffDays + 1,
    title: 'Days 90+: Scale & Sustainable Growth',
    objectives: [
      'Scale Hermes Mobile only after demand metrics clear go thresholds',
      'Maintain feedback loop retention and rules auto-promotion',
    ],
  };
}

/**
 * Map thumbs up/down + optional 1–5 score into a 1–5 feedback rating.
 */
function mapSignalToRating(signal, explicitScore) {
  if (typeof explicitScore === 'number' && Number.isFinite(explicitScore)) {
    return Math.min(5, Math.max(1, explicitScore));
  }
  if (signal === 'up') return 5;
  if (signal === 'down') return 2;
  return 3;
}

/**
 * Computes signal metrics (User Feedback Rating & Bayesian Trial-to-Paid conversion).
 */
function calculateSignalMetrics(state) {
  const outreach = state.outreach || [];
  const trials = state.trials || [];
  const inAppRatings = state.inAppRatings || [];

  const scoredInterviews = outreach.filter((o) => typeof o.featureAlignmentScore === 'number');
  const interviewScores = scoredInterviews.map((o) => o.featureAlignmentScore);
  const inAppScores = inAppRatings
    .map((r) => (typeof r.score === 'number' ? r.score : null))
    .filter((n) => n !== null);
  const allScores = interviewScores.concat(inAppScores);
  const totalScore = allScores.reduce((sum, n) => sum + n, 0);
  const rawAvgFeedbackRating = allScores.length > 0 ? totalScore / allScores.length : 0;

  // Bayesian smoothing prior (prior rating = 4.0 out of 5.0, prior weight = 2)
  const priorRating = 4.0;
  const priorWeight = 2;
  const bayesianFeedbackRating = allScores.length > 0
    ? (totalScore + priorRating * priorWeight) / (allScores.length + priorWeight)
    : priorRating;

  const convertedCount = trials.filter((t) => t.convertedToPaid === true).length;
  const totalTrials = trials.length;
  const nonConvertedCount = Math.max(0, totalTrials - convertedCount);

  // Prior Beta(1, 2) — ~33% baseline conversion expectation for low-N
  const alpha = 1 + convertedCount;
  const beta = 2 + nonConvertedCount;
  const meanConversionRate = alpha / (alpha + beta);
  const conversionPercentage = (meanConversionRate * 100).toFixed(1);

  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
  const stdDev = Math.sqrt(variance);
  const ciLower = Math.max(0, meanConversionRate - 1.96 * stdDev);
  const ciUpper = Math.min(1, meanConversionRate + 1.96 * stdDev);

  const interviewedCount = outreach.filter(
    (o) => o.status === 'interviewed' || o.status === 'converted_paid' || o.featureAlignmentScore > 0,
  ).length;
  const interviewProgressPct = Math.min(100, Math.round((interviewedCount / TARGET_INTERVIEWS) * 100));

  return {
    userFeedbackRating: {
      rawAverage: Number(rawAvgFeedbackRating.toFixed(2)),
      bayesianSmoothed: Number(bayesianFeedbackRating.toFixed(2)),
      totalScoredInterviews: scoredInterviews.length,
      totalInAppRatings: inAppScores.length,
      totalScores: allScores.length,
      maxScale: 5.0,
    },
    freeTrialToPaidConversion: {
      convertedCount,
      totalTrials,
      empiricalRatePct: totalTrials > 0 ? Number(((convertedCount / totalTrials) * 100).toFixed(1)) : 0,
      bayesianMeanPct: Number(conversionPercentage),
      credibleInterval95Pct: [
        Number((ciLower * 100).toFixed(1)),
        Number((ciUpper * 100).toFixed(1)),
      ],
    },
    interviewTargetProgress: {
      interviewedCount,
      targetInterviews: TARGET_INTERVIEWS,
      progressPct: interviewProgressPct,
    },
  };
}

/**
 * Go / no-go demand validation report (FUTRFND #1 priority).
 * Do not scale paid acquisition until go thresholds clear.
 */
function getDemandValidationReport(state) {
  const metrics = calculateSignalMetrics(state);
  const interviewed = metrics.interviewTargetProgress.interviewedCount;
  const rating = metrics.userFeedbackRating.bayesianSmoothed;
  const trials = metrics.freeTrialToPaidConversion.totalTrials;
  const conversionPct = metrics.freeTrialToPaidConversion.bayesianMeanPct;

  const checks = [
    {
      id: 'min_interviews',
      passed: interviewed >= MIN_INTERVIEWS_FOR_MONETIZE,
      detail: `${interviewed}/${MIN_INTERVIEWS_FOR_MONETIZE} interviews completed`,
    },
    {
      id: 'feedback_rating_floor',
      passed: metrics.userFeedbackRating.totalScores === 0
        ? false
        : rating >= FEEDBACK_RATING_GO,
      detail: `Bayesian feedback rating ${rating}/5 (need ≥${FEEDBACK_RATING_GO} with ≥1 score)`,
    },
    {
      id: 'trial_sample',
      passed: trials >= MIN_TRIALS_FOR_CONVERSION_SIGNAL,
      detail: `${trials}/${MIN_TRIALS_FOR_CONVERSION_SIGNAL} free trials tracked`,
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const readyToScaleMonetization = checks.every((c) => c.passed);

  return {
    priority: 'VALIDATE_USER_DEMAND',
    readyToScaleMonetization,
    passedCount,
    totalChecks: checks.length,
    checks,
    headline: readyToScaleMonetization
      ? 'Demand validation CLEAR — safe to scale conversion experiments'
      : 'Demand validation INCOMPLETE — prioritize interviews & feedback before paid acquisition',
    signalSnapshot: {
      feedbackRating: rating,
      interviews: interviewed,
      trialConversionBayesianPct: conversionPct,
    },
  };
}

/**
 * Audit launch risks identified in FUTRFND diagnosis.
 */
function auditLaunchRisks(state) {
  const metrics = calculateSignalMetrics(state);
  const risks = [];

  if (
    metrics.userFeedbackRating.bayesianSmoothed < FEEDBACK_RATING_GO
    && metrics.userFeedbackRating.totalScores > 0
  ) {
    risks.push({
      riskId: 'MISALIGNED_FEATURES',
      severity: 'HIGH',
      message: `User Feedback Rating is ${metrics.userFeedbackRating.bayesianSmoothed}/5.0 (below ${FEEDBACK_RATING_GO} threshold). Features may not align with Hermes Agent operator workflows.`,
      recommendation: 'Conduct 3 additional 15-min interview calls specifically targeting remote control usability.',
    });
  }

  if (metrics.userFeedbackRating.totalScoredInterviews < 3) {
    risks.push({
      riskId: 'INADEQUATE_FEEDBACK_LOOP',
      severity: 'MEDIUM',
      message: `Low feedback sample size (${metrics.userFeedbackRating.totalScoredInterviews} interviews recorded). Risk of making decisions on unvalidated demand.`,
      recommendation: 'Expand outreach to Hermes community forums to record at least 5 user interview feedback entries.',
    });
  }

  const demand = getDemandValidationReport(state);
  if (!demand.readyToScaleMonetization) {
    risks.push({
      riskId: 'PREMATURE_MONETIZATION',
      severity: 'MEDIUM',
      message: demand.headline,
      recommendation: 'Finish interview target + in-app rating floor before paid ads or aggressive paywall experiments.',
    });
  }

  return {
    hasHighRisk: risks.some((r) => r.severity === 'HIGH'),
    totalRisksCount: risks.length,
    risks,
    auditPassed: risks.length === 0,
  };
}

function recordOutreach(entry, customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const newEntry = {
    id: `outreach-${Date.now()}`,
    contactName: entry.contactName || 'Anonymous Hermes Operator',
    channel: entry.channel || 'Direct Outreach',
    status: entry.status || 'interviewed',
    featureAlignmentScore: typeof entry.featureAlignmentScore === 'number'
      ? entry.featureAlignmentScore
      : mapSignalToRating(entry.signal, entry.score),
    remoteControlPainPoints: Array.isArray(entry.remoteControlPainPoints)
      ? entry.remoteControlPainPoints
      : [entry.notes || entry.painPoint || 'Remote control safety governance'].filter(Boolean),
    feedbackNotes: entry.feedbackNotes || entry.notes || '',
    date: new Date().toISOString(),
  };

  state.outreach.push(newEntry);
  saveLaunchState(state, customStateDir);
  return newEntry;
}

function recordInAppFeedback(entry, customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const score = mapSignalToRating(entry.signal, entry.score);
  const rating = {
    id: `rating-${Date.now()}`,
    score,
    signal: entry.signal || null,
    source: entry.source || 'in_app',
    context: entry.context || '',
    date: new Date().toISOString(),
  };
  state.inAppRatings.push(rating);
  saveLaunchState(state, customStateDir);
  return rating;
}

function recordTrial(entry, customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const trial = {
    id: entry.id || `trial-${Date.now()}`,
    user: entry.user || entry.userId || 'anonymous',
    status: entry.convertedToPaid ? 'converted' : (entry.status || 'active_trial'),
    convertedToPaid: entry.convertedToPaid === true,
    source: entry.source || 'in_app',
    date: entry.date || new Date().toISOString(),
  };
  state.trials.push(trial);
  saveLaunchState(state, customStateDir);
  return trial;
}

function convertTrial(trialId, customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const trial = state.trials.find((t) => t.id === trialId || t.user === trialId);
  if (!trial) {
    return { found: false, trial: null };
  }
  trial.convertedToPaid = true;
  trial.status = 'converted';
  trial.convertedAt = new Date().toISOString();
  saveLaunchState(state, customStateDir);
  return { found: true, trial };
}

function recordCommunityTouch(entry, customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const touch = {
    id: `community-${Date.now()}`,
    channelId: entry.channelId || entry.channel || 'unknown',
    action: entry.action || 'engage',
    notes: entry.notes || '',
    date: new Date().toISOString(),
  };
  state.communityTouches.push(touch);
  saveLaunchState(state, customStateDir);
  return touch;
}

/**
 * Build a draft interview / trial outreach message with UTMs (not auto-sent).
 */
function buildOutreachDraft(input = {}) {
  const name = input.contactName || 'there';
  const channel = input.channel || 'email';
  const utmCampaign = input.utmCampaign || 'hermes_mobile_interview';
  const baseUrl = (input.baseUrl || 'https://thumbgate.ai/hermes-mobile').replace(/\/+$/, '');
  const trialUrl = `${baseUrl}?utm_source=${encodeURIComponent(channel)}&utm_medium=outreach&utm_campaign=${encodeURIComponent(utmCampaign)}&utm_content=free_trial_for_feedback`;

  const subject = '15 minutes on remote Hermes control? Free trial for feedback';
  const body = [
    `Hi ${name},`,
    '',
    'I am building Hermes Mobile — phone control + approval cards for Hermes agents when you are away from the Mac.',
    '',
    'Would you take a 15-minute call to validate whether this solves a real remote-control pain for you?',
    `In exchange: free ThumbGate Leash trial → ${trialUrl}`,
    '',
    'Three focus areas: pairing reliability, approval latency, and what you would actually pay for.',
    '',
    '— Igor',
  ].join('\n');

  return {
    channel,
    subject,
    body,
    trialUrl,
    interviewScript: INTERVIEW_SCRIPT,
    disclaimer: 'Draft only — never auto-send. Human reviews and delivers.',
  };
}

function listInterviewTargets(state) {
  const existing = (state.outreach || []).map((o) => ({
    contactName: o.contactName,
    channel: o.channel,
    status: o.status,
    score: o.featureAlignmentScore,
  }));
  return {
    targetCount: TARGET_INTERVIEWS,
    completedCount: existing.filter((e) => e.status === 'interviewed' || e.score > 0).length,
    remaining: Math.max(0, TARGET_INTERVIEWS - existing.length),
    channels: COMMUNITY_CHANNELS,
    recorded: existing,
    script: INTERVIEW_SCRIPT,
  };
}

/**
 * Auto-promotes interview pain points into ThumbGate prevention rules.
 */
function autoPromoteHermesFeedback(customStateDir = null) {
  const state = loadLaunchState(customStateDir);
  const dir = customStateDir || process.env.THUMBGATE_STATE_DIR || path.join(process.cwd(), '.thumbgate');
  const rulesPath = path.join(dir, 'rules.json');

  let existingRules = [];
  if (fs.existsSync(rulesPath)) {
    try {
      existingRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      if (!Array.isArray(existingRules)) existingRules = [];
    } catch (_) {
      existingRules = [];
    }
  }

  const promoted = [];
  const painPoints = (state.outreach || []).flatMap((o) => o.remoteControlPainPoints || []);

  for (const point of painPoints) {
    if (!point) continue;
    const ruleId = `hermes-mobile-${String(point).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const exists = existingRules.some((r) => r.id === ruleId || r.pattern === point);
    if (!exists) {
      const newRule = {
        id: ruleId,
        description: `Hermes Mobile safety rule generated from interview feedback: ${point}`,
        pattern: point,
        action: 'block',
        tags: ['hermes', 'hermes-mobile', 'auto-promoted', 'user-interview'],
        created: new Date().toISOString(),
      };
      existingRules.push(newRule);
      promoted.push(newRule);
    }
  }

  if (promoted.length > 0) {
    fs.writeFileSync(rulesPath, JSON.stringify(existingRules, null, 2), 'utf8');
  }

  return {
    promotedCount: promoted.length,
    promotedRules: promoted,
  };
}

/**
 * Single dashboard payload for CLI + REST.
 */
function getLaunchDashboard(customStateDir = null, currentDateIso = new Date().toISOString()) {
  const state = loadLaunchState(customStateDir);
  const phase = getExecutionPhase(state.startDate, currentDateIso);
  const signalMetrics = calculateSignalMetrics(state);
  const riskAudit = auditLaunchRisks(state);
  const demandValidation = getDemandValidationReport(state);
  const interviewTargets = listInterviewTargets(state);

  return {
    success: true,
    strategySource: state.strategySource || 'futrfnd-launch-strategy-hermes-mobile.pdf',
    startDate: state.startDate,
    executionPhase: phase,
    signalMetrics,
    riskAudit,
    demandValidation,
    interviewTargets,
    communityChannels: COMMUNITY_CHANNELS,
    interviewScript: INTERVIEW_SCRIPT,
    counts: {
      outreach: (state.outreach || []).length,
      trials: (state.trials || []).length,
      inAppRatings: (state.inAppRatings || []).length,
      communityTouches: (state.communityTouches || []).length,
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  STATE_FILENAME,
  TARGET_INTERVIEWS,
  FEEDBACK_RATING_GO,
  MIN_INTERVIEWS_FOR_MONETIZE,
  MIN_TRIALS_FOR_CONVERSION_SIGNAL,
  COMMUNITY_CHANNELS,
  INTERVIEW_SCRIPT,
  createEmptyLaunchState,
  loadLaunchState,
  saveLaunchState,
  getExecutionPhase,
  mapSignalToRating,
  calculateSignalMetrics,
  getDemandValidationReport,
  auditLaunchRisks,
  recordOutreach,
  recordInAppFeedback,
  recordTrial,
  convertTrial,
  recordCommunityTouch,
  buildOutreachDraft,
  listInterviewTargets,
  autoPromoteHermesFeedback,
  getLaunchDashboard,
};
