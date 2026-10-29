'use strict';

/**
 * GitHub Universe 2026 format, local to ThumbGate.
 *
 * Completed work is the unit: a feature, a bug fix, or a security fix that
 * names how it was verified. A learned automation stays a proposal until a
 * person approves it. A session that continues another surface names the goal
 * and the last verified outcome. A lite review does not close a high-blast
 * change. A paid Copilot or GitHub plan is denied. An open-ended token route is denied.
 *
 * Does not clone Copilot, call GitHub, or record a vendor benchmark as a
 * ThumbGate measurement. InfoQ's Code-as-truth line counts as one verification
 * token. This module does not replace that command.
 */

const DONE_CLAIM_RE = /(?:\b(?:this|it|the task|the work|the pr|the change|the fix)\s+is\s+(?:done|shipped|deployed|live)\b|\b(?:shipped|deployed)\s+to\s+(?:prod(?:uction)?|railway|main)\b|\bcrisis over\b|\bkill-switch complete\b|\b(?:deliveryStatus|deliveryClaim)\s*[:=]\s*['"]?(?:done|shipped|deployed)\b)/i;

const VERIFY_RE = /(?:\bnode\s+--test\b|\bnpm\s+test\b|\bVERIFIED\s*:|\bCode as truth\s*:|\bProvenance\s*:|tests\/[A-Za-z0-9_./-]+\.test\.js\b)/;

const HIGH_BLAST_RE = /(?:\bgit\s+push\b[^\n]*--force\b|\bnpm\s+publish\b|\brailway\s+(?:up|deploy)\b|\b(?:ALTER|CREATE|DROP)\s+TABLE\b[\s\S]{0,80}\bprod(?:uction)?\b|\bprod(?:uction)?\b[\s\S]{0,80}\b(?:ALTER|CREATE|DROP)\s+TABLE\b)/i;

const LITE_REVIEW_RE = /(?:\b(?:reviewDepth|review)\s*[:=]\s*['"]?lite\b|\blite review\b)/i;

const DEEP_CHECK_RE = /(?:\breviewDepth\s*[:=]\s*['"]?(?:balanced|max)\b|\b(?:balanced|max)\s+review\b|\bnode\s+--test\b|\bnpm\s+test\b|\bisolated verifier\b|\bVERIFIED\s*:)/i;

const AUTO_APPLY_RE = /(?:\b(?:autoApply|applyLearning)\s*[:=]\s*(?:true|1|yes)\b|"autoApply"\s*:\s*true|"applyLearning"\s*:\s*true)/i;

const REVIEW_APPROVED_RE = /(?:\breviewApproved\s*[:=]\s*(?:true|1|yes)\b|"reviewApproved"\s*:\s*true)/i;

const CONTINUITY_RE = /(?:\bcontinu(?:e|es|ing)\s+(?:the\s+)?(?:work\s+)?from\s+(?:claude|cursor|codex|copilot|grok|antigravity|gemini|another surface|another session)\b|\bsessionContinuity\s*[:=]\s*(?:true|1|yes)\b|"sessionContinuity"\s*:\s*true|\bcontinuesSurface\s*[:=]\s*\S+)/i;

const GOAL_RE = /\bgoal\s*[:=]\s*\S+/i;

const LAST_VERIFIED_RE = /(?:\blastVerifiedOutcome\s*[:=]\s*\S+|\blast verified outcome\s*[:=]\s*\S+|\bVERIFIED\s*:\s*\S+)/i;

const DONE_WORDS = new Set(['done', 'shipped', 'deployed']);

function payloadText(toolName, toolInput) {
  const command = toolInput && typeof toolInput === 'object'
    ? String(toolInput.command || toolInput.cmd || '')
    : '';
  let encoded = '';
  try {
    encoded = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {});
  } catch {
    encoded = '';
  }
  return `${toolName || ''}\n${command}\n${encoded}`;
}

function flagTrue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'yes';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function firstWord(text, words) {
  const pattern = new RegExp(`\\b(?:${words.join('|')})\\b`, 'i');
  const match = pattern.exec(text);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

function mentionsPaidPlan(text) {
  const verb = firstWord(text, ['subscribe', 'purchase', 'buy', 'upgrade']);
  if (!verb) return false;
  const afterVerb = text.slice(verb.index, verb.index + 120);
  const product = firstWord(afterVerb, ['copilot', 'github']);
  if (!product || product.index > 80) return false;
  const fromProduct = verb.index + product.index;
  const afterProduct = text.slice(fromProduct, fromProduct + 80);
  const tier = firstWord(afterProduct, ['pro\\+', 'pro', 'enterprise', 'business', 'plan']);
  return Boolean(tier) && tier.index <= 40;
}

function mentionsUncapped(text) {
  const marker = firstWord(text, ['uncapped', 'unlimited', 'no cap', 'without a cap']);
  if (!marker) return false;
  const afterMarker = text.slice(marker.index, marker.index + 80);
  const target = firstWord(afterMarker, ['model', 'route', 'spend', 'budget', 'tokens']);
  if (target && target.index <= 48) return true;
  return /\b(?:maxTokens|max_tokens|tokenCap|spendCapUsd)\s*[:=]\s*['"]?(?:unlimited|uncapped|none)['"]?/i.test(text)
    || /"maxTokens"\s*:\s*null/.test(text);
}

function evaluateUniverseDeliveryPretool({ toolName = '', toolInput = {} } = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const blob = payloadText(toolName, toolInput);
  const blockers = [];

  const status = String(input.deliveryStatus || input.deliveryClaim || '').toLowerCase();
  const claimsDone = DONE_CLAIM_RE.test(blob) || DONE_WORDS.has(status);
  if (claimsDone && !VERIFY_RE.test(blob)) {
    blockers.push('universe_done_claim_missing_verification');
  }

  const highBlast = HIGH_BLAST_RE.test(blob) || flagTrue(input.highBlast);
  const lite = LITE_REVIEW_RE.test(blob) || String(input.reviewDepth || '').toLowerCase() === 'lite';
  const deep = DEEP_CHECK_RE.test(blob)
    || ['balanced', 'max'].includes(String(input.reviewDepth || '').toLowerCase());
  if (highBlast && lite && !deep) {
    blockers.push('universe_lite_review_cannot_close_high_blast');
  }

  const autoApply = AUTO_APPLY_RE.test(blob) || flagTrue(input.autoApply) || flagTrue(input.applyLearning);
  const approved = REVIEW_APPROVED_RE.test(blob) || flagTrue(input.reviewApproved);
  if (autoApply && !approved) {
    blockers.push('universe_learning_auto_apply_needs_review');
  }

  const continuity = CONTINUITY_RE.test(blob) || flagTrue(input.sessionContinuity) || Boolean(input.continuesSurface);
  if (continuity) {
    const hasGoal = GOAL_RE.test(blob) || (typeof input.goal === 'string' && input.goal.trim().length > 0);
    const hasLast = LAST_VERIFIED_RE.test(blob)
      || (typeof input.lastVerifiedOutcome === 'string' && input.lastVerifiedOutcome.trim().length > 0);
    if (!hasGoal || !hasLast) {
      blockers.push('universe_continuity_missing_goal_or_last_verified_outcome');
    }
  }

  if (mentionsPaidPlan(blob) || flagTrue(input.subscribeCopilot) || flagTrue(input.subscribeGithubPlan)) {
    blockers.push('universe_paid_plan_subscribe_denied');
  }

  const uncappedField = flagTrue(input.uncappedRoute)
    || (hasOwn(input, 'maxTokens') && (input.maxTokens === null || input.maxTokens === 'unlimited' || input.maxTokens === 'uncapped'));
  if (mentionsUncapped(blob) || uncappedField) {
    blockers.push('universe_uncapped_model_route_denied');
  }

  return {
    ok: blockers.length === 0,
    blockers,
    source: 'github-universe-2026',
  };
}

module.exports = {
  evaluateUniverseDeliveryPretool,
};
