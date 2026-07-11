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

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) dp[i][0] = i;
  for (let j = 0; j <= right.length; j++) dp[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[left.length][right.length];
}

function isNearThumbToken(token) {
  const value = String(token || '');
  if (value.length < 4) return false;
  return editDistance(value, 'thumb') <= 1 || editDistance(value, 'thumbs') <= 2;
}

function isNearUpToken(token) {
  const value = String(token || '');
  return value === 'up' || editDistance(value, 'up') <= 1;
}

function isNearDownToken(token) {
  const value = String(token || '');
  if (value.length < 2) return false;
  return editDistance(value, 'down') <= 1;
}

function detectFeedbackSignal(value) {
  const raw = String(value || '');
  const leading = raw.trimStart();
  if (/^["'`]/.test(leading)) return null;
  if (/^👎(?:🏻|🏼|🏽|🏾|🏿)?/u.test(leading)) return { signal: 'down', confidence: 'emoji', match: '👎' };
  if (/^👍(?:🏻|🏼|🏽|🏾|🏿)?/u.test(leading)) return { signal: 'up', confidence: 'emoji', match: '👍' };

  const normalized = normalizeFeedbackText(raw);
  if (!normalized) return null;

  const exactDown = [
    /^thumbs?\s*down\b/,
    /^thumbs?down\b/,
    /^that failed\b/,
    /^it failed\b/,
    /^that was wrong\b/,
  ];
  if (exactDown.some((pattern) => pattern.test(normalized))) {
    return { signal: 'down', confidence: 'exact', match: normalized };
  }

  const exactUp = [
    /^thumbs?\s*up\b/,
    /^thumbs?up\b/,
    /^that worked\b/,
    /^it worked\b/,
    /^looks good\b/,
    /^good job\b/,
    /^good work\b/,
    /^nice work\b/,
    /^perfect\b/,
    /^lgtm\b/,
  ];
  if (exactUp.some((pattern) => pattern.test(normalized))) {
    return { signal: 'up', confidence: 'exact', match: normalized };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (!isNearThumbToken(words[0])) return null;
  if (isNearDownToken(words[1])) {
    return { signal: 'down', confidence: 'fuzzy', match: `${words[0]} ${words[1]}` };
  }
  if (isNearUpToken(words[1])) {
    return { signal: 'up', confidence: 'fuzzy', match: `${words[0]} ${words[1]}` };
  }

  return null;
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
  detectFeedbackSignal,
  normalizeFeedbackSignal,
  normalizeFeedbackText,
  isGenericFeedbackText,
  assessFeedbackActionability,
  buildClarificationMessage,
};
