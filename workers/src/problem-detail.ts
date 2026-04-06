/**
 * RFC 9457 Problem Detail for AI-agent-friendly error responses.
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export const PROBLEM_TYPES = {
  RATE_LIMIT: 'urn:thumbgate:error:rate-limit-exceeded',
  UNAUTHORIZED: 'urn:thumbgate:error:unauthorized',
  FORBIDDEN: 'urn:thumbgate:error:forbidden',
  NOT_FOUND: 'urn:thumbgate:error:not-found',
  BAD_REQUEST: 'urn:thumbgate:error:bad-request',
  INVALID_JSON: 'urn:thumbgate:error:invalid-json',
  PAYMENT_REQUIRED: 'urn:thumbgate:error:payment-required',
  INTERNAL: 'urn:thumbgate:error:internal-server-error',
  WEBHOOK_INVALID: 'urn:thumbgate:error:webhook-invalid-signature',
  SERVICE_UNAVAILABLE: 'urn:thumbgate:error:service-unavailable',
  INVALID_REQUEST: 'urn:thumbgate:error:invalid-request',
  METHOD_NOT_FOUND: 'urn:thumbgate:error:method-not-found',
  INVALID_PARAMS: 'urn:thumbgate:error:invalid-params',
} as const;

export function problemResponse(opts: ProblemDetail): Response {
  const body: ProblemDetail = {
    type: opts.type,
    title: opts.title,
    status: opts.status,
  };
  if (opts.detail) body.detail = opts.detail;
  if (opts.instance) body.instance = opts.instance;
  // Copy extensions
  for (const [k, v] of Object.entries(opts)) {
    if (!['type', 'title', 'status', 'detail', 'instance'].includes(k)) {
      body[k] = v;
    }
  }
  return new Response(JSON.stringify(body), {
    status: opts.status,
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
  });
}
