'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HIGH_RISK_TERMS = [
  'charge',
  'refund',
  'invoice',
  'billing',
  'payment',
  'delete',
  'disable',
  'close',
  'cancel',
  'transfer',
  'payout',
  'password',
  'reset',
  'account',
  'admin',
  'crm',
  'bigquery',
];

const SENSITIVE_PARAMETER_PATTERNS = [
  /api[_-]?key/i,
  /access[_-]?token/i,
  /secret/i,
  /password/i,
  /ssn/i,
  /social[_-]?security/i,
  /card[_-]?number/i,
  /credit[_-]?card/i,
  /routing[_-]?number/i,
  /bank[_-]?account/i,
];

const DEFAULT_OPTIONS = {
  blockThreshold: 0.8,
  reviewThreshold: 0.45,
  highAmount: 500,
  maxContextLength: 2000,
};

function clampScore(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== '')),
    blockThreshold: Number(options.blockThreshold ?? options['block-threshold'] ?? DEFAULT_OPTIONS.blockThreshold),
    reviewThreshold: Number(options.reviewThreshold ?? options['review-threshold'] ?? DEFAULT_OPTIONS.reviewThreshold),
    highAmount: Number(options.highAmount ?? options['high-amount'] ?? DEFAULT_OPTIONS.highAmount),
    maxContextLength: Number(options.maxContextLength ?? options['max-context-length'] ?? DEFAULT_OPTIONS.maxContextLength),
  };
}

function getNested(object, pathSegments) {
  let cursor = object;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function normalizeParameters(payload = {}) {
  const camelCaseParameters = getNested(payload, ['sessionInfo', 'parameters']);
  const snakeCaseParameters = getNested(payload, ['session_info', 'parameters']);
  return Object.assign({}, camelCaseParameters, snakeCaseParameters);
}

function normalizeMessages(payload = {}) {
  const text = [
    getNested(payload, ['text']),
    getNested(payload, ['transcript']),
    getNested(payload, ['queryResult', 'text']),
    getNested(payload, ['intentInfo', 'displayName']),
    getNested(payload, ['intent_info', 'display_name']),
    getNested(payload, ['pageInfo', 'currentPage']),
    getNested(payload, ['page_info', 'current_page']),
  ].filter(Boolean).join(' ');
  return String(text || '').trim();
}

function normalizeDialogflowWebhook(payload = {}) {
  const parameters = normalizeParameters(payload);
  const fulfillmentTag = String(
    getNested(payload, ['fulfillmentInfo', 'tag'])
    || getNested(payload, ['fulfillment_info', 'tag'])
    || parameters.fulfillmentTag
    || parameters.action
    || ''
  );
  const currentPage = String(
    getNested(payload, ['pageInfo', 'currentPage'])
    || getNested(payload, ['page_info', 'current_page'])
    || ''
  );
  const session = String(payload.session || payload.detectIntentResponseId || payload.detect_intent_response_id || '');
  const languageCode = String(payload.languageCode || payload.language_code || '');
  const conversationText = normalizeMessages(payload);

  return {
    source: 'dialogflow-cx-webhook',
    session,
    fulfillmentTag,
    currentPage,
    languageCode,
    parameters,
    conversationText,
  };
}

function parameterEntries(parameters = {}) {
  return Object.entries(parameters || {}).flatMap(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return [[key, JSON.stringify(value)]];
    }
    return [[key, value]];
  });
}

function evaluateDialogflowCxWebhook(payload = {}, options = {}) {
  const opts = normalizeOptions(options);
  const normalized = normalizeDialogflowWebhook(payload);
  const reasons = [];
  let riskScore = 0;

  const actionText = `${normalized.fulfillmentTag} ${normalized.currentPage}`.toLowerCase();
  const matchedTerms = HIGH_RISK_TERMS.filter((term) => actionText.includes(term));
  if (matchedTerms.length > 0) {
    riskScore += 0.35;
    reasons.push({
      code: 'high_risk_fulfillment',
      severity: 'review',
      detail: `fulfillment/page references risky action: ${matchedTerms.slice(0, 5).join(', ')}`,
    });
  }

  for (const [key, value] of parameterEntries(normalized.parameters)) {
    if (SENSITIVE_PARAMETER_PATTERNS.some((pattern) => pattern.test(key))) {
      riskScore += 0.4;
      reasons.push({
        code: 'sensitive_parameter_name',
        severity: 'block',
        detail: `parameter name looks sensitive: ${key}`,
      });
    }

    const text = String(value ?? '');
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b4\d{3}([ -]?\d{4}){3}\b/.test(text)) {
      riskScore += 0.4;
      reasons.push({
        code: 'sensitive_parameter_value',
        severity: 'block',
        detail: `parameter value looks like regulated personal/payment data: ${key}`,
      });
    }
  }

  const amount = Number(
    normalized.parameters.amount
    ?? normalized.parameters.refundAmount
    ?? normalized.parameters.chargeAmount
    ?? normalized.parameters.paymentAmount
    ?? 0
  );
  if (Number.isFinite(amount) && amount >= opts.highAmount) {
    riskScore += 0.25;
    reasons.push({
      code: 'high_value_transaction',
      severity: 'review',
      detail: `amount ${amount} meets or exceeds ${opts.highAmount}`,
    });
  }

  if (normalized.conversationText.length > opts.maxContextLength) {
    riskScore += 0.15;
    reasons.push({
      code: 'large_unreviewed_context',
      severity: 'review',
      detail: `conversation context length ${normalized.conversationText.length} exceeds ${opts.maxContextLength}`,
    });
  }

  const explicitRepeat = normalized.parameters.thumbgatePreviousBlock === true
    || normalized.parameters.previousBlock === true
    || normalized.parameters.repeatAttempt === true;
  if (explicitRepeat) {
    riskScore += 0.35;
    reasons.push({
      code: 'repeat_attempt',
      severity: 'block',
      detail: 'request is marked as a repeat attempt after a prior block',
    });
  }

  riskScore = clampScore(riskScore);
  const hasBlockingReason = reasons.some((reason) => reason.severity === 'block');
  let decision = 'allow';
  if (riskScore >= opts.blockThreshold || hasBlockingReason) {
    decision = 'block';
  } else if (riskScore >= opts.reviewThreshold) {
    decision = 'review';
  }

  return {
    ok: true,
    source: normalized.source,
    decision,
    allowed: decision === 'allow',
    riskScore,
    thresholds: {
      review: opts.reviewThreshold,
      block: opts.blockThreshold,
    },
    reasons,
    normalized,
    response: buildDialogflowCxResponse({ decision, riskScore, reasons }),
  };
}

function buildDialogflowCxResponse({ decision, riskScore, reasons }) {
  const firstReason = reasons[0]?.detail || 'no risky fulfillment pattern detected';
  let text = 'ThumbGate allowed this fulfillment.';
  if (decision === 'review') {
    text = `ThumbGate requires review before fulfillment: ${firstReason}.`;
  } else if (decision === 'block') {
    text = `ThumbGate blocked this fulfillment before side effects: ${firstReason}.`;
  }

  return {
    fulfillment_response: {
      messages: [
        {
          text: {
            text: [text],
          },
        },
      ],
    },
    session_info: {
      parameters: {
        thumbgate_decision: decision,
        thumbgate_allowed: decision === 'allow',
        thumbgate_risk_score: Number(riskScore.toFixed(3)),
        thumbgate_reason_codes: reasons.map((reason) => reason.code),
      },
    },
  };
}

function readPayloadFromFileOrStdin({ inputPath, stdinText = '' } = {}) {
  const text = inputPath
    ? fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8')
    : stdinText;
  if (!String(text || '').trim()) {
    throw new Error('No webhook JSON provided. Pass --input=<file> or pipe JSON on stdin.');
  }
  return JSON.parse(text);
}

module.exports = {
  DEFAULT_OPTIONS,
  buildDialogflowCxResponse,
  evaluateDialogflowCxWebhook,
  normalizeDialogflowWebhook,
  readPayloadFromFileOrStdin,
};
