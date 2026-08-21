'use strict';

/**
 * Future AGI steal onto hosted Hermes $10.
 *
 * Ideas kept (from future-agi/future-agi guardrail engine, not their product):
 * - pre-stage vs post-stage around a consequential action
 * - ActionBlock / Warn / Log
 * - score threshold, plus hard Pass=false still triggers
 *
 * Ideas inverted / refused:
 * - FailOpen default → fail-closed on spend/send/customer/production
 * - 6-tool simulate/eval/protect/monitor/optimize platform → no
 * - OTel / their gateway → no
 */

const CONSEQUENTIAL = new Set(['spend', 'send', 'customer', 'production']);
const ACTIONS = new Set(['block', 'warn', 'log']);
const STAGES = new Set(['pre', 'post']);
const CRITIC_OK = new Set(['fully_satisfactory', 'caveats']);

function isConsequential(actionClass) {
  return CONSEQUENTIAL.has(String(actionClass || '').toLowerCase());
}

function normalizeAction(action, actionClass) {
  const value = String(action || '').toLowerCase();
  if (ACTIONS.has(value)) return value;
  return isConsequential(actionClass) ? 'block' : 'log';
}

function shouldTrigger(check, threshold) {
  if (!check || typeof check !== 'object') {
    return { trigger: true, reason: 'missing_check' };
  }
  if (check.error || check.timeout) {
    return { trigger: true, reason: check.timeout ? 'timeout' : 'error' };
  }
  if (check.pass === false) {
    return { trigger: true, reason: 'hard_fail' };
  }
  if (typeof check.score === 'number' && Number.isFinite(threshold) && check.score > threshold) {
    return { trigger: true, reason: 'threshold' };
  }
  if (check.pass !== true && typeof check.score !== 'number') {
    return { trigger: true, reason: 'unknown' };
  }
  return { trigger: false, reason: null };
}

function receiptOf(stage, actionClass, blocked, triggered, live) {
  return {
    stage,
    actionClass,
    blocked: Boolean(blocked),
    live: Boolean(live),
    triggered: triggered.map((row) => ({
      name: row.name,
      score: row?.score ?? null,
      threshold: row.threshold,
      action: row.action,
      message: row.message,
      reason: row.reason,
    })),
  };
}

const UNRELIABLE_REASONS = new Set(['timeout', 'error', 'unknown', 'missing_check']);

function isActionBlocked(action, consequential, reason) {
  if (action === 'block') return true;
  if (consequential && action !== 'warn' && action !== 'log') return true;
  if (consequential && UNRELIABLE_REASONS.has(reason)) return true;
  return false;
}

/**
 * Run one pipeline stage.
 * @param {{stage:'pre'|'post', actionClass:string, threshold?:number, checks:Array}} input
 */
function runStage(input = {}) {
  const stage = String(input?.stage || '').toLowerCase();
  if (!STAGES.has(stage)) {
    throw new Error('stage must be pre or post');
  }
  const actionClass = String(input?.actionClass || '').toLowerCase();
  const threshold = Number.isFinite(Number(input?.threshold)) ? Number(input.threshold) : 0;
  const checks = Array.isArray(input?.checks) ? input.checks : [];
  const consequential = isConsequential(actionClass);
  const triggered = [];
  let blocked = false;

  if (consequential && checks.length === 0) {
    blocked = true;
    triggered.push({
      name: 'pipeline',
      score: null,
      threshold,
      action: 'block',
      message: 'missing eval',
      reason: 'missing_check',
    });
  }

  for (const check of checks) {
    const decision = shouldTrigger(check, threshold);
    if (!decision.trigger) continue;
    const action = normalizeAction(check.action, actionClass);
    triggered.push({
      name: check.name || 'unnamed',
      score: typeof check.score === 'number' ? check.score : null,
      threshold,
      action,
      message: check.message || decision.reason,
      reason: decision.reason,
    });
    if (isActionBlocked(action, consequential, decision.reason)) {
      blocked = true;
    }
  }

  return receiptOf(stage, actionClass, blocked, triggered, !blocked);
}

/**
 * Overnight / scheduled-run liveness.
 * Actor may have run; critic + pre/post decide whether we claim live or renew a lease.
 */
function claimLive(input = {}) {
  const critic = input?.critic;
  const pre = input?.pre;
  const post = input?.post;
  const reasons = [];

  if (!CRITIC_OK.has(String(critic || ''))) {
    reasons.push('critic_not_satisfactory');
  }
  if (!pre || pre.blocked) {
    reasons.push('pre_blocked');
  }
  if (post?.blocked) {
    reasons.push('post_blocked');
  }
  if (post?.live === false) {
    reasons.push('post_not_live');
  }

  return {
    live: reasons.length === 0,
    reasons,
    receipt: {
      critic: critic || null,
      preBlocked: Boolean(pre?.blocked),
      postBlocked: Boolean(post?.blocked),
    },
  };
}

function evaluateAction(input = {}) {
  const pre = runStage({
    stage: 'pre',
    actionClass: input.actionClass,
    threshold: input.threshold,
    checks: input.preChecks,
  });
  if (pre.blocked) {
    return { allowed: false, live: false, pre, post: null, claim: claimLive({ critic: input.critic, pre }) };
  }
  const post = runStage({
    stage: 'post',
    actionClass: input.actionClass,
    threshold: input.threshold,
    checks: input.postChecks || [{ name: 'post', pass: true, score: 0 }],
  });
  const claim = claimLive({ critic: input.critic, pre, post });
  return { allowed: true, live: claim.live, pre, post, claim };
}

module.exports = {
  CONSEQUENTIAL: [...CONSEQUENTIAL],
  runStage,
  claimLive,
  evaluateAction,
  isConsequential,
};
