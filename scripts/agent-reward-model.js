#!/usr/bin/env node
'use strict';

/**
 * Agent Reward Model — deterministic RL-style scoring for ThumbGate episodes.
 *
 * This turns session episodes into state/action/outcome/reward records so the
 * loop can prioritize gates, create preference pairs, and spend deeper
 * verification only when the next action is actually risky.
 */

const path = require('node:path');
const { loadEpisodes } = require('./session-episode-store');

const HIGH_RISK_TAGS = new Set([
  'billing',
  'checkout',
  'data-loss',
  'deploy',
  'deploy-prod',
  'destructive',
  'force-push-main',
  'payments',
  'production',
  'public-post',
  'secrets',
  'stripe',
]);

const ACTION_KEYWORDS = [
  { pattern: /\b(deploy|railway|production|prod)\b/i, tag: 'deploy-prod' },
  { pattern: /\b(delete|remove|rm -rf|drop|truncate|destructive)\b/i, tag: 'destructive' },
  { pattern: /\b(secret|token|api[_ -]?key|credential|password)\b/i, tag: 'secrets' },
  { pattern: /\b(stripe|checkout|payment|price|billing|subscription)\b/i, tag: 'payments' },
  { pattern: /\b(post|reply|comment|tweet|linkedin|bluesky|threads|reddit)\b/i, tag: 'public-post' },
  { pattern: /\b(force push|force-push|main branch)\b/i, tag: 'force-push-main' },
];

const ROUND_TO = 1000;

function normalizeTags(values) {
  return Array.from(new Set((values || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)));
}

function deriveActionTags(episode = {}) {
  const tags = new Set(normalizeTags([...(episode.tags || []), ...(episode.categories || [])]));
  const haystack = [
    episode.recommendation,
    ...(episode.errorFingerprints || []),
    ...(episode.signals || []).map((signal) => `${signal.signal || ''} ${signal.severity || ''}`),
  ].filter(Boolean).join(' ');

  for (const { pattern, tag } of ACTION_KEYWORDS) {
    if (pattern.test(haystack)) tags.add(tag);
  }
  return Array.from(tags);
}

function computeEpisodeReward(episode = {}, options = {}) {
  const score = clamp(Number(episode.score ?? 50), 0, 100);
  const grade = String(episode.grade || 'unknown').toLowerCase();
  const negativeCount = Math.max(0, Number(episode.negativeCount || 0));
  const positiveCount = Math.max(0, Number(episode.positiveCount || 0));
  const errorCount = Array.isArray(episode.errorFingerprints) ? episode.errorFingerprints.length : 0;
  const actionTags = deriveActionTags(episode);
  const highRiskCount = actionTags.filter((tag) => HIGH_RISK_TAGS.has(tag)).length;
  const durationPenalty = computeDurationPenalty(episode.durationMs);
  const preventedRepeatBonus = Number(episode.preventedRepeatCount || 0) * 0.25;

  const components = {
    health: round((score - 50) / 50),
    grade: grade === 'healthy' ? 0.35 : grade === 'degraded' ? -0.35 : grade === 'critical' ? -0.8 : 0,
    positiveFeedback: round(positiveCount * 0.15),
    negativeFeedback: round(negativeCount * -0.45),
    recurringErrors: round(errorCount * -0.25),
    highRiskExposure: round(highRiskCount * -0.2),
    duration: round(durationPenalty),
    preventedRepeat: round(preventedRepeatBonus),
  };

  const rawTotal = Object.values(components).reduce((sum, value) => sum + value, 0);
  const scale = Number(options.scale || 1);
  const total = round(clamp(rawTotal * scale, -3, 3));

  return {
    total,
    label: rewardLabel(total),
    components,
    actionTags,
    evidence: {
      score,
      grade,
      negativeCount,
      positiveCount,
      errorCount,
      highRiskCount,
      durationMs: episode.durationMs ?? null,
    },
  };
}

function episodeToRlTuple(episode = {}, options = {}) {
  const reward = computeEpisodeReward(episode, options);
  const actionTags = reward.actionTags;
  return {
    id: episode.sessionId || episode.id || null,
    state: {
      hourOfDay: episode.hourOfDay ?? null,
      dayOfWeek: episode.dayOfWeek ?? null,
      categories: normalizeTags(episode.categories || []),
      tags: normalizeTags(episode.tags || []),
      priorGrade: episode.priorGrade || null,
    },
    action: {
      tags: actionTags,
      recommendation: episode.recommendation || null,
      signals: Array.isArray(episode.signals) ? episode.signals : [],
    },
    outcome: {
      score: episode.score ?? null,
      grade: episode.grade || null,
      negativeCount: episode.negativeCount || 0,
      positiveCount: episode.positiveCount || 0,
      errorFingerprints: episode.errorFingerprints || [],
    },
    reward,
    evidence: reward.evidence,
  };
}

function buildPreferencePairFromEpisodes(a, b, options = {}) {
  const tupleA = isRlTuple(a) ? a : episodeToRlTuple(a, options);
  const tupleB = isRlTuple(b) ? b : episodeToRlTuple(b, options);
  const chosen = tupleA.reward.total >= tupleB.reward.total ? tupleA : tupleB;
  const rejected = chosen === tupleA ? tupleB : tupleA;
  const delta = round(chosen.reward.total - rejected.reward.total);

  if (delta <= 0) return null;
  return {
    prompt: inferPreferencePrompt(chosen, rejected),
    chosen: describeEpisodePolicy(chosen),
    rejected: describeEpisodePolicy(rejected),
    metadata: {
      chosenEpisodeId: chosen.id,
      rejectedEpisodeId: rejected.id,
      chosenReward: chosen.reward.total,
      rejectedReward: rejected.reward.total,
      rewardDelta: delta,
      chosenLabel: chosen.reward.label,
      rejectedLabel: rejected.reward.label,
      categories: Array.from(new Set([
        ...chosen.state.categories,
        ...rejected.state.categories,
      ])).slice(0, 12),
    },
  };
}

function isRlTuple(value) {
  return Boolean(value && value.state && value.action && value.outcome && value.reward);
}

function buildPreferencePairs(episodes = [], options = {}) {
  const tuples = episodes
    .map((episode) => episodeToRlTuple(episode, options))
    .sort((a, b) => a.reward.total - b.reward.total);
  if (tuples.length < 2) return [];

  const pairs = [];
  const maxPairs = Math.max(1, Number(options.maxPairs || 10));
  const lows = tuples.slice(0, Math.min(maxPairs, Math.floor(tuples.length / 2)));
  const highs = tuples.slice(Math.max(lows.length, tuples.length - lows.length)).reverse();

  for (let i = 0; i < Math.min(lows.length, highs.length); i++) {
    const pair = buildPreferencePairFromEpisodes(highs[i], lows[i], options);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

function rankGateCandidatesByReward(episodes = [], options = {}) {
  const minOccurrences = Math.max(1, Number(options.minOccurrences || 2));
  const buckets = new Map();

  for (const episode of episodes) {
    const tuple = episodeToRlTuple(episode, options);
    const keys = new Set([
      ...(episode.errorFingerprints || []).map((fp) => `error:${fp}`),
      ...tuple.action.tags.map((tag) => `tag:${tag}`),
      ...(episode.categories || []).map((category) => `category:${String(category).toLowerCase()}`),
    ]);

    for (const key of keys) {
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          occurrences: 0,
          totalReward: 0,
          negativeEpisodes: 0,
          highRiskEpisodes: 0,
          examples: [],
        });
      }
      const bucket = buckets.get(key);
      bucket.occurrences += 1;
      bucket.totalReward += tuple.reward.total;
      if (tuple.reward.total < 0) bucket.negativeEpisodes += 1;
      if (tuple.reward.actionTags.some((tag) => HIGH_RISK_TAGS.has(tag))) bucket.highRiskEpisodes += 1;
      if (bucket.examples.length < 3) bucket.examples.push(tuple.id);
    }
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.occurrences >= minOccurrences)
    .map((bucket) => {
      const averageReward = round(bucket.totalReward / bucket.occurrences);
      const failureRate = bucket.negativeEpisodes / bucket.occurrences;
      const riskBoost = bucket.highRiskEpisodes > 0 ? 0.5 : 0;
      const priorityScore = round((Math.max(0, -averageReward) * 2) + (failureRate * 2) + Math.log2(bucket.occurrences + 1) + riskBoost);
      return {
        ...bucket,
        averageReward,
        failureRate: round(failureRate),
        priorityScore,
        gateId: bucket.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80),
        recommendation: buildGateRecommendation(bucket.key, bucket.occurrences, averageReward),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.occurrences - a.occurrences);
}

function allocateTestTimeCompute(action = {}) {
  const text = [
    action.command,
    action.intent,
    action.tool,
    action.description,
    ...(action.tags || []),
  ].filter(Boolean).join(' ');
  const tags = normalizeTags([...(action.tags || [])]);

  for (const { pattern, tag } of ACTION_KEYWORDS) {
    if (pattern.test(text)) tags.push(tag);
  }

  const uniqueTags = normalizeTags(tags);
  const highRiskTags = uniqueTags.filter((tag) => HIGH_RISK_TAGS.has(tag));

  if (highRiskTags.some((tag) => ['secrets', 'payments', 'deploy-prod', 'data-loss', 'force-push-main'].includes(tag))) {
    return {
      budget: 'xhigh',
      maxVerifierSteps: 8,
      requiresHumanApproval: highRiskTags.includes('public-post'),
      requiredChecks: [
        'confirm exact target surface',
        'run focused tests',
        'verify rollback path',
        'check secrets and billing impact',
        'capture evidence before claiming done',
      ],
      riskTags: highRiskTags,
    };
  }

  if (highRiskTags.length > 0) {
    return {
      budget: 'deep',
      maxVerifierSteps: 5,
      requiresHumanApproval: highRiskTags.includes('public-post'),
      requiredChecks: [
        'verify target and scope',
        'run focused validation',
        'capture evidence before claiming done',
      ],
      riskTags: highRiskTags,
    };
  }

  if (/\b(test|lint|docs|read|inspect|status)\b/i.test(text)) {
    return {
      budget: 'fast',
      maxVerifierSteps: 2,
      requiresHumanApproval: false,
      requiredChecks: ['run the relevant focused check'],
      riskTags: [],
    };
  }

  return {
    budget: 'standard',
    maxVerifierSteps: 3,
    requiresHumanApproval: false,
    requiredChecks: ['inspect diff', 'run focused validation'],
    riskTags: [],
  };
}

function buildRewardReport(episodes = [], options = {}) {
  const tuples = episodes.map((episode) => episodeToRlTuple(episode, options));
  const rewards = tuples.map((tuple) => tuple.reward.total);
  const averageReward = rewards.length ? round(rewards.reduce((sum, value) => sum + value, 0) / rewards.length) : 0;
  const worstEpisodes = tuples
    .filter((tuple) => tuple.reward.total < 0)
    .sort((a, b) => a.reward.total - b.reward.total)
    .slice(0, Number(options.maxWorst || 5));

  return {
    generatedAt: new Date().toISOString(),
    episodesAnalyzed: episodes.length,
    averageReward,
    rewardDistribution: {
      positive: tuples.filter((tuple) => tuple.reward.total > 0).length,
      neutral: tuples.filter((tuple) => tuple.reward.total === 0).length,
      negative: tuples.filter((tuple) => tuple.reward.total < 0).length,
    },
    worstEpisodes,
    preferencePairs: buildPreferencePairs(episodes, options),
    gateCandidates: rankGateCandidatesByReward(episodes, options).slice(0, Number(options.maxGateCandidates || 10)),
    computePolicy: {
      fast: 'read-only, tests, lint, docs',
      standard: 'ordinary implementation with focused verification',
      deep: 'destructive, public, or production-adjacent work',
      xhigh: 'payments, secrets, deploy-prod, data-loss, force-push-main',
    },
  };
}

function inferPreferencePrompt(chosen, rejected) {
  const categories = Array.from(new Set([
    ...chosen.state.categories,
    ...rejected.state.categories,
  ])).filter(Boolean);
  const domain = categories.length ? categories.join(', ') : 'agent workflow';
  return `Task domain: ${domain}. Which policy should the agent follow to maximize verified outcomes and avoid repeat mistakes?`;
}

function describeEpisodePolicy(tuple) {
  const tags = tuple.action.tags.length ? tuple.action.tags.join(', ') : 'no explicit action tags';
  const errors = tuple.outcome.errorFingerprints.length
    ? `Errors: ${tuple.outcome.errorFingerprints.slice(0, 3).join('; ')}.`
    : 'No recurring errors recorded.';
  const recommendation = tuple.action.recommendation || 'Use evidence-first execution and verify before claiming completion.';
  return [
    `Reward ${tuple.reward.total} (${tuple.reward.label}).`,
    `Action tags: ${tags}.`,
    `Outcome: ${tuple.outcome.grade || 'unknown'} with score ${tuple.outcome.score ?? 'n/a'}.`,
    errors,
    `Policy: ${recommendation}`,
  ].join(' ');
}

function buildGateRecommendation(key, occurrences, averageReward) {
  const label = key.replace(/^(error|tag|category):/, '');
  if (key.startsWith('error:')) {
    return `Promote recurring error "${label.slice(0, 100)}" into a pre-action prevention rule; ${occurrences} episodes average reward ${averageReward}.`;
  }
  if (key.startsWith('tag:')) {
    return `Add a risk-aware verifier for "${label}" actions; ${occurrences} episodes average reward ${averageReward}.`;
  }
  return `Break "${label}" work into smaller gated steps; ${occurrences} episodes average reward ${averageReward}.`;
}

function computeDurationPenalty(durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const hours = duration / (60 * 60 * 1000);
  if (hours <= 1) return 0;
  return -Math.min(0.5, (hours - 1) * 0.1);
}

function rewardLabel(total) {
  if (total >= 0.75) return 'strong_positive';
  if (total > 0) return 'positive';
  if (total === 0) return 'neutral';
  if (total > -0.75) return 'negative';
  return 'strong_negative';
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function parseArgs(argv) {
  const args = { command: argv[2] || 'report' };
  for (const arg of argv.slice(3)) {
    if (!arg.startsWith('--')) continue;
    const [key, rawValue] = arg.slice(2).split('=');
    args[key] = rawValue === undefined ? true : rawValue;
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const args = parseArgs(process.argv);
  const episodes = loadEpisodes();
  if (args.command === 'report') {
    console.log(JSON.stringify(buildRewardReport(episodes), null, 2));
  } else if (args.command === 'pairs') {
    console.log(JSON.stringify(buildPreferencePairs(episodes), null, 2));
  } else if (args.command === 'gates') {
    console.log(JSON.stringify(rankGateCandidatesByReward(episodes), null, 2));
  } else {
    console.error(`Unknown command: ${args.command}. Use: report, pairs, gates`);
    process.exit(1);
  }
}

module.exports = {
  HIGH_RISK_TAGS,
  allocateTestTimeCompute,
  buildPreferencePairFromEpisodes,
  buildPreferencePairs,
  buildRewardReport,
  computeEpisodeReward,
  deriveActionTags,
  episodeToRlTuple,
  rankGateCandidatesByReward,
};
