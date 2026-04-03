'use strict';

const GENERIC_PHRASE_RULES = {
  positive: [
    /^up$/,
    /^thumbs?\s*up$/,
    /^thumbs\s+up$/,
    /^that worked$/,
    /^it worked$/,
    /^worked$/,
    /^looks good$/,
    /^looked good$/,
    /^good job$/,
    /^good work$/,
    /^nice work$/,
    /^perfect$/,
    /^approved$/,
    /^lgtm$/,
  ],
  negative: [
    /^down$/,
    /^thumbs?\s*down$/,
    /^thumbs\s+down$/,
    /^that failed$/,
    /^it failed$/,
    /^failed$/,
    /^that was wrong$/,
    /^wrong$/,
    /^bad$/,
    /^fix this$/,
    /^broken$/,
  ],
};

const CLARIFICATION_CONFIG = {
  positive: {
    prompt: 'What specifically worked that should be repeated?',
    example: 'Example: "The agent showed test output before claiming done."',
    missingFields: ['whatWorked'],
  },
  negative: {
    prompt: 'What failed and what should change next time?',
    example: 'Example: "It skipped tests and should run npm test before closing the task."',
    missingFields: ['whatWentWrong', 'whatToChange'],
  },
};

function normalizeFeedbackSignal(signal) {
  const normalized = normalizeFeedbackText(signal);
  if (['negative', 'down', 'thumbs down', 'thumbsdown', 'bad'].includes(normalized)) {
    return 'negative';
  }
  return 'positive';
}

function normalizeFeedbackText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericFeedbackText(value, signal) {
  const normalized = normalizeFeedbackText(value);
  if (!normalized) return false;
  const rules = GENERIC_PHRASE_RULES[signal] || [];
  return rules.some((pattern) => pattern.test(normalized));
}

function assessFeedbackActionability(params = {}) {
  const signal = normalizeFeedbackSignal(params.signal);
  const primaryFields = signal === 'positive'
    ? [
      { name: 'whatWorked', value: params.whatWorked },
      { name: 'context', value: params.context },
    ]
    : [
      { name: 'whatWentWrong', value: params.whatWentWrong },
      { name: 'context', value: params.context },
    ];

  const populated = primaryFields.filter((field) => normalizeFeedbackText(field.value));
  const specific = populated.find((field) => !isGenericFeedbackText(field.value, signal));

  if (specific) {
    return {
      promotable: true,
      signal,
      sourceField: specific.name,
      prompt: null,
      example: null,
      missingFields: [],
      issue: null,
      isGenericContext: false,
    };
  }

  const config = CLARIFICATION_CONFIG[signal];
  const issue = populated.length > 0 ? 'generic' : 'missing';

  return {
    promotable: false,
    signal,
    sourceField: null,
    prompt: config.prompt,
    example: config.example,
    missingFields: config.missingFields,
    issue,
    isGenericContext: populated.some((field) => field.name === 'context'),
  };
}

function buildClarificationMessage(params = {}) {
  const assessment = assessFeedbackActionability(params);
  if (assessment.promotable) return null;

  const intro = assessment.signal === 'positive'
    ? 'Positive signal logged, but it is not specific enough to promote to reusable memory.'
    : 'Negative signal logged, but it is not specific enough to promote to reusable memory.';

  return {
    needsClarification: true,
    prompt: assessment.prompt,
    example: assessment.example,
    missingFields: assessment.missingFields,
    message: `${intro} ${assessment.prompt}`,
  };
}

module.exports = {
  GENERIC_PHRASE_RULES,
  normalizeFeedbackSignal,
  normalizeFeedbackText,
  isGenericFeedbackText,
  assessFeedbackActionability,
  buildClarificationMessage,
};
