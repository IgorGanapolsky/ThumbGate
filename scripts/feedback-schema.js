#!/usr/bin/env node
/**
 * Feedback Schema Validator
 *
 * Implements three reliability patterns:
 *   1. Typed schemas — enforce structure on every feedback memory
 *   2. Action schemas — discriminated union of allowed feedback actions
 *   3. Validation at boundaries — reject bad data before storage
 */

const GENERIC_TAGS = new Set(['feedback', 'positive', 'negative']);
const MIN_CONTENT_LENGTH = 20;
const MAX_TITLE_DESCRIPTION_LENGTH = 120;
const VALID_TITLE_PREFIXES = ['SUCCESS:', 'MISTAKE:', 'LEARNING:', 'PREFERENCE:'];
const VALID_CATEGORIES = new Set(['error', 'learning', 'preference']);

/**
 * Truncate text at a word boundary to avoid cutting mid-word.
 * Falls back to hard truncation if no suitable space is found
 * past the halfway point of maxLen.
 */
function truncateAtWord(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  var truncated = text.slice(0, maxLen);
  var lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}
const {
  assessFeedbackActionability,
  normalizeFeedbackText,
} = require('./feedback-quality');

const INFERRED_TAG_RULES = [
  { tag: 'thumbgate', keywords: ['thumbgate', 'rlhf', 'statusline', 'dashboard', 'mcp'] },
  { tag: 'testing', keywords: ['test', 'testing', 'jest', 'coverage', 'verify', 'verification'] },
  { tag: 'security', keywords: ['security', 'secret', 'credential', 'token', 'auth'] },
  { tag: 'performance', keywords: ['perf', 'performance', 'latency', 'slow'] },
  { tag: 'ui-components', keywords: ['ui', 'component', 'layout', 'style', 'figma'] },
  { tag: 'api-integration', keywords: ['api', 'endpoint', 'request', 'response', 'server'] },
  { tag: 'git-workflow', keywords: ['git', 'commit', 'branch', 'pr', 'pull request'] },
  { tag: 'documentation', keywords: ['doc', 'docs', 'readme'] },
  { tag: 'debugging', keywords: ['debug', 'debugging', 'error', 'bug', 'fix'] },
  { tag: 'architecture', keywords: ['design', 'architecture', 'system'] },
  { tag: 'data-modeling', keywords: ['schema', 'data', 'model', 'migration'] },
];

function validateFeedbackMemory(memory) {
  const issues = [];

  if (!memory.title || typeof memory.title !== 'string') {
    issues.push('title: required string');
  } else {
    const hasPrefix = VALID_TITLE_PREFIXES.some((p) => memory.title.startsWith(p));
    if (!hasPrefix) {
      issues.push(`title: must start with one of ${VALID_TITLE_PREFIXES.join(', ')}`);
    }
    const afterPrefix = memory.title.replace(/^(SUCCESS|MISTAKE|LEARNING|PREFERENCE):\s*/, '');
    if (afterPrefix.length < 5) {
      issues.push('title: description after prefix too short (min 5 chars)');
    }
  }

  if (!memory.content || typeof memory.content !== 'string') {
    issues.push('content: required string');
  } else if (memory.content.length < MIN_CONTENT_LENGTH) {
    issues.push(`content: too short (${memory.content.length} chars, min ${MIN_CONTENT_LENGTH})`);
  }

  if (!memory.category) {
    issues.push('category: required');
  } else if (!VALID_CATEGORIES.has(memory.category)) {
    issues.push(`category: must be one of ${[...VALID_CATEGORIES].join(', ')} (got "${memory.category}")`);
  }

  if (!Array.isArray(memory.tags) || memory.tags.length === 0) {
    issues.push('tags: at least 1 tag required');
  } else {
    const domainTags = memory.tags.filter((t) => !GENERIC_TAGS.has(t));
    if (domainTags.length === 0) {
      issues.push('tags: at least 1 non-generic tag required');
    }
  }

  if (memory.title && memory.category) {
    const titleIsError = memory.title.startsWith('MISTAKE:');
    const titleIsSuccess = memory.title.startsWith('SUCCESS:') || memory.title.startsWith('LEARNING:');
    if (titleIsError && memory.category !== 'error') {
      issues.push('consistency: MISTAKE title should have category "error"');
    }
    if (titleIsSuccess && memory.category === 'error') {
      issues.push('consistency: SUCCESS/LEARNING title should not have category "error"');
    }
  }

  if (memory.rubricSummary != null) {
    if (typeof memory.rubricSummary !== 'object') {
      issues.push('rubricSummary: must be an object when provided');
    } else {
      const weightedScore = Number(memory.rubricSummary.weightedScore);
      if (!Number.isFinite(weightedScore) || weightedScore < 0 || weightedScore > 1) {
        issues.push('rubricSummary.weightedScore: must be a number between 0 and 1');
      }
      if (!Array.isArray(memory.rubricSummary.failingCriteria)) {
        issues.push('rubricSummary.failingCriteria: must be an array');
      }
      if (!Array.isArray(memory.rubricSummary.failingGuardrails)) {
        issues.push('rubricSummary.failingGuardrails: must be an array');
      }
    }
  }

  if (memory.bayesian != null) {
    if (typeof memory.bayesian !== 'object') {
      issues.push('bayesian: must be an object when provided');
    } else {
      const prior = Number(memory.bayesian.priorProbability);
      if (!Number.isFinite(prior) || prior < 0 || prior > 1) {
        issues.push('bayesian.priorProbability: must be a number between 0 and 1');
      }
      const uncertainty = Number(memory.bayesian.uncertainty);
      if (!Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 1) {
        issues.push('bayesian.uncertainty: must be a number between 0 and 1');
      }
      if (typeof memory.bayesian.observations !== 'number') {
        issues.push('bayesian.observations: must be a number');
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function inferFallbackDomainTag(params = {}) {
  const explicitDomainTags = (params.tags || []).filter((tag) => !GENERIC_TAGS.has(tag));
  if (explicitDomainTags.length > 0) return explicitDomainTags[0];

  const text = normalizeFeedbackText([
    params.context,
    params.whatWorked,
    params.whatWentWrong,
    params.whatToChange,
  ].filter(Boolean).join(' '));

  if (!text) return 'general';

  for (const rule of INFERRED_TAG_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.tag;
    }
  }

  return 'general';
}

function resolveFeedbackAction(params) {
  const {
    signal,
    context,
    whatWentWrong,
    whatToChange,
    whatWorked,
    reasoning,
    visualEvidence,
    tags,
    rubricEvaluation,
  } = params;

  if (!context && !whatWentWrong && !whatWorked) {
    return { type: 'no-action', reason: 'No context provided — cannot create actionable memory' };
  }

  const inferredDomainTag = inferFallbackDomainTag({
    tags,
    context,
    whatWentWrong,
    whatToChange,
    whatWorked,
  });
  const domainTags = [...new Set([
    ...(tags || []).filter((t) => !GENERIC_TAGS.has(t)),
    inferredDomainTag,
  ].filter(Boolean))];
  const rubricSummary = rubricEvaluation
    ? {
      rubricId: rubricEvaluation.rubricId,
      weightedScore: rubricEvaluation.weightedScore,
      failingCriteria: rubricEvaluation.failingCriteria || [],
      failingGuardrails: rubricEvaluation.failingGuardrails || [],
      judgeDisagreements: rubricEvaluation.judgeDisagreements || [],
      blockReasons: rubricEvaluation.blockReasons || [],
    }
    : null;
  const rubricFailureTags = rubricSummary
    ? (rubricSummary.failingCriteria || []).map((criterion) => `rubric-${criterion}`)
    : [];

  if (signal === 'negative') {
    const actionability = assessFeedbackActionability({
      signal: 'negative',
      context,
      whatWentWrong,
    });
    if (!actionability.promotable) {
      const reason = actionability.issue === 'missing'
        ? 'Negative feedback without context — cannot determine what went wrong'
        : 'Negative feedback is too vague to promote — describe what failed in one sentence';
      return { type: 'no-action', reason };
    }

    const content = [
      whatWentWrong ? `What went wrong: ${whatWentWrong}` : `Context: ${context}`,
      whatToChange ? `How to avoid: ${whatToChange}` : 'Action needed: investigate and prevent recurrence',
      reasoning ? `Reasoning: ${reasoning}` : null,
      visualEvidence ? `Visual Evidence: ${visualEvidence}` : null,
    ].filter(Boolean).join('\n');
    const rubricLines = [];
    if (rubricSummary) {
      rubricLines.push(`Rubric weighted score: ${rubricSummary.weightedScore}`);
      if (rubricSummary.failingCriteria.length > 0) {
        rubricLines.push(`Rubric failing criteria: ${rubricSummary.failingCriteria.join(', ')}`);
      }
      if (rubricSummary.failingGuardrails.length > 0) {
        rubricLines.push(`Guardrails failed: ${rubricSummary.failingGuardrails.join(', ')}`);
      }
      if (rubricSummary.judgeDisagreements.length > 0) {
        rubricLines.push('Judge disagreement detected; require manual review');
      }
    }

    const description = truncateAtWord(whatWentWrong || context || '', MAX_TITLE_DESCRIPTION_LENGTH);

    return {
      type: 'store-mistake',
      memory: {
        title: `MISTAKE: ${description}`,
        content: rubricLines.length > 0 ? `${content}\n${rubricLines.join('\n')}` : content,
        category: 'error',
        importance: 'high',
        tags: ['feedback', 'negative', ...domainTags, ...rubricFailureTags],
        rubricSummary,
        bayesian: {
          priorProbability: 0.5,
          uncertainty: 0.5,
          observations: 1,
          lastUpdated: new Date().toISOString(),
        },
      },
    };
  }

  if (signal === 'positive') {
    if (rubricEvaluation && !rubricEvaluation.promotionEligible) {
      const reasons = rubricEvaluation.blockReasons && rubricEvaluation.blockReasons.length > 0
        ? rubricEvaluation.blockReasons.join('; ')
        : 'rubric gate did not pass';
      return { type: 'no-action', reason: `Rubric gate prevented promotion: ${reasons}` };
    }

    const actionability = assessFeedbackActionability({
      signal: 'positive',
      context,
      whatWorked,
    });
    if (!actionability.promotable) {
      const reason = actionability.issue === 'missing'
        ? 'Positive feedback without context — cannot determine what worked'
        : 'Positive feedback is too vague to promote — describe what worked in one sentence';
      return { type: 'no-action', reason };
    }

    const content = [
      whatWorked ? `What worked: ${whatWorked}` : `Approach: ${context}`,
      reasoning ? `Reasoning: ${reasoning}` : null,
      visualEvidence ? `Visual Evidence: ${visualEvidence}` : null,
    ].filter(Boolean).join('\n');
    const rubricLines = [];
    if (rubricSummary) {
      rubricLines.push(`Rubric weighted score: ${rubricSummary.weightedScore}`);
      rubricLines.push(`Rubric criteria passed with no blocking guardrails.`);
    }
    const description = truncateAtWord(whatWorked || context || '', MAX_TITLE_DESCRIPTION_LENGTH);

    return {
      type: 'store-learning',
      memory: {
        title: `SUCCESS: ${description}`,
        content: rubricLines.length > 0 ? `${content}\n${rubricLines.join('\n')}` : content,
        category: 'learning',
        importance: 'normal',
        tags: ['feedback', 'positive', ...domainTags],
        rubricSummary,
        bayesian: {
          priorProbability: 0.7,
          uncertainty: 0.3,
          observations: 1,
          lastUpdated: new Date().toISOString(),
        },
      },
    };
  }

  return { type: 'no-action', reason: `Unknown signal: ${signal}` };
}

function prepareForStorage(memory) {
  const validation = validateFeedbackMemory(memory);
  if (!validation.valid) {
    return { ok: false, issues: validation.issues };
  }
  return { ok: true, memory };
}

/**
 * parseTimestamp — Parse any ISO 8601 timestamp string into a Date object.
 * Handles: Z-suffix ("2026-03-04T12:00:00.000Z"), no-suffix ("2026-03-04T12:00:00"),
 * and UTC offset ("2026-03-04T12:00:00+05:00").
 * Returns null (not NaN) for null, undefined, or unparseable input.
 * NOTE: Do NOT change how timestamps are WRITTEN — new Date().toISOString() already
 * produces correct ISO 8601+Z format. This helper is for READING only.
 * Python's train_from_feedback.py strips Z with .replace("Z","") before fromisoformat().
 * That pattern is safe because Node always writes Z-suffix. Do not alter write behavior.
 * @param {string|null|undefined} ts - Timestamp string to parse
 * @returns {Date|null}
 */
function parseTimestamp(ts) {
  if (ts == null) return null;
  const d = new Date(String(ts).trim());
  return isNaN(d.getTime()) ? null : d;
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

  console.log('\nfeedback-schema.js tests\n');

  const goodError = {
    title: 'MISTAKE: Did not verify before claiming fixed',
    content: 'Always run tests and show evidence before claiming the work is complete.',
    category: 'error',
    tags: ['feedback', 'negative', 'verification'],
  };
  assert(validateFeedbackMemory(goodError).valid, 'valid error memory passes');

  const shortContent = {
    title: 'MISTAKE: Bad fix regression',
    content: 'thumbs down',
    category: 'error',
    tags: ['verification'],
  };
  assert(!validateFeedbackMemory(shortContent).valid, 'short content fails');

  const bareThumbsDown = resolveFeedbackAction({ signal: 'negative' });
  assert(bareThumbsDown.type === 'no-action', 'bare negative feedback becomes no-action');

  const vagueThumbsUp = resolveFeedbackAction({
    signal: 'positive',
    context: 'thumbs up',
    tags: ['verification'],
  });
  assert(vagueThumbsUp.type === 'no-action', 'generic positive context becomes no-action');

  const fullNegative = resolveFeedbackAction({
    signal: 'negative',
    context: 'Pushed code with no tests',
    whatWentWrong: 'Claimed fixed without test output',
    whatToChange: 'Always run tests first',
    tags: ['testing', 'verification'],
  });
  assert(fullNegative.type === 'store-mistake', 'negative feedback creates store-mistake action');

  const prep = prepareForStorage(fullNegative.memory);
  assert(prep.ok, 'store-mistake memory passes storage validation');

  const fullPositive = resolveFeedbackAction({
    signal: 'positive',
    whatWorked: 'Ran tests and included output before final response',
    tags: ['testing', 'verification'],
  });
  assert(fullPositive.type === 'store-learning', 'positive feedback creates store-learning action');

  const blockedPositive = resolveFeedbackAction({
    signal: 'positive',
    whatWorked: 'Manual approval happened without evidence',
    tags: ['testing'],
    rubricEvaluation: {
      promotionEligible: false,
      blockReasons: ['failed_guardrails:testsPassed'],
      failingCriteria: [],
      failingGuardrails: ['testsPassed'],
      weightedScore: 0.82,
      rubricId: 'default-v1',
    },
  });
  assert(blockedPositive.type === 'no-action', 'rubric gate blocks unsafe positive promotion');

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  validateFeedbackMemory,
  resolveFeedbackAction,
  prepareForStorage,
  parseTimestamp,
  truncateAtWord,
  GENERIC_TAGS,
  MIN_CONTENT_LENGTH,
  MAX_TITLE_DESCRIPTION_LENGTH,
  VALID_TITLE_PREFIXES,
  VALID_CATEGORIES,
};

if (require.main === module && process.argv.includes('--test')) {
  runTests();
}
