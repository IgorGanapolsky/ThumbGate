'use strict';

/**
 * RFC 9457 Problem Detail helper for AI-agent-friendly error responses.
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */

const PROBLEM_TYPES = {
  RATE_LIMIT: 'urn:rlhf:error:rate-limit-exceeded',
  UNAUTHORIZED: 'urn:rlhf:error:unauthorized',
  FORBIDDEN: 'urn:rlhf:error:forbidden',
  NOT_FOUND: 'urn:rlhf:error:not-found',
  BAD_REQUEST: 'urn:rlhf:error:bad-request',
  INVALID_JSON: 'urn:rlhf:error:invalid-json',
  PAYMENT_REQUIRED: 'urn:rlhf:error:payment-required',
  INTERNAL: 'urn:rlhf:error:internal-server-error',
  WEBHOOK_INVALID: 'urn:rlhf:error:webhook-invalid-signature',
  SERVICE_UNAVAILABLE: 'urn:rlhf:error:service-unavailable',
};

/**
 * Build an RFC 9457 problem detail object.
 * @param {object} opts
 * @param {string} opts.type - URN from PROBLEM_TYPES
 * @param {string} opts.title - Short human-readable summary
 * @param {number} opts.status - HTTP status code
 * @param {string} [opts.detail] - Longer explanation
 * @param {string} [opts.instance] - URI reference for this specific occurrence
 * @param {object} [opts.extensions] - Additional fields
 * @returns {object}
 */
function problemDetail({ type, title, status, detail, instance, ...extensions }) {
  const obj = { type, title, status };
  if (detail) obj.detail = detail;
  if (instance) obj.instance = instance;
  return { ...obj, ...extensions };
}

/**
 * Send an RFC 9457 problem detail response via Node http.ServerResponse.
 */
function sendProblem(res, opts, extraHeaders = {}) {
  const problem = problemDetail(opts);
  const body = JSON.stringify(problem);
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

module.exports = { problemDetail, sendProblem, PROBLEM_TYPES };
