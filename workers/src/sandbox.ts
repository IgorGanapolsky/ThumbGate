import type { Env, SandboxDispatchEnvelope, SandboxQueueRecord } from './types';

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifySandboxSignature(
  bodyText: string,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
): Promise<boolean> {
  const issuedAt = Date.parse(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(now - issuedAt) > maxSkewMs) return false;
  const expected = await hmacHex(`${timestamp}.${bodyText}`, secret);
  return timingSafeEqualHex(expected, signature);
}

function problemJson(status: number, detail: string): Response {
  return Response.json({
    type: 'https://thumbgate.dev/problems/cloudflare-sandbox',
    title: status === 401 ? 'Unauthorized' : 'Bad Request',
    status,
    detail,
  }, { status });
}

function normalizeEnvelope(raw: Partial<SandboxDispatchEnvelope>): SandboxDispatchEnvelope {
  return {
    executionId: String(raw.executionId || '').trim(),
    provider: raw.provider === 'cloudflare_dynamic_worker' ? raw.provider : 'cloudflare_dynamic_worker',
    workloadType: String(raw.workloadType || '').trim(),
    tier: raw.tier === 'team' || raw.tier === 'enterprise' || raw.tier === 'pro' || raw.tier === 'free'
      ? raw.tier
      : 'pro',
    tenantId: raw.tenantId ? String(raw.tenantId).trim() : null,
    traceId: String(raw.traceId || raw.executionId || '').trim(),
    requestedAt: String(raw.requestedAt || '').trim(),
    networkPolicy: raw.networkPolicy || { mode: 'deny_all', allowedHosts: [] },
    bindings: Array.isArray(raw.bindings) ? raw.bindings.map((entry) => String(entry)) : [],
    limits: raw.limits || { maxRuntimeMs: 30000, maxContextTokens: null },
    bootstrap: raw.bootstrap || null,
  };
}

export async function handleSandboxExecute(request: Request, env: Env): Promise<Response> {
  const secret = env.SANDBOX_SHARED_SECRET;
  if (!secret) {
    return problemJson(503, 'SANDBOX_SHARED_SECRET is not configured.');
  }

  const signature = request.headers.get('x-thumbgate-sandbox-signature') || '';
  const timestamp = request.headers.get('x-thumbgate-sandbox-timestamp') || '';
  if (!signature || !timestamp) {
    return problemJson(401, 'Missing sandbox dispatch signature headers.');
  }

  const bodyText = await request.text();
  const verified = await verifySandboxSignature(bodyText, timestamp, signature, secret);
  if (!verified) {
    return problemJson(401, 'Invalid or expired sandbox dispatch signature.');
  }

  const payload = normalizeEnvelope(JSON.parse(bodyText));
  if (!payload.executionId || !payload.workloadType) {
    return problemJson(400, 'executionId and workloadType are required.');
  }

  const storageKey = `sandbox:${payload.executionId}`;
  const record: SandboxQueueRecord = {
    executionId: payload.executionId,
    tenantId: payload.tenantId,
    workloadType: payload.workloadType,
    provider: payload.provider,
    queuedAt: new Date().toISOString(),
    traceId: payload.traceId,
    bindings: payload.bindings,
    networkPolicy: payload.networkPolicy,
    bootstrapSummary: payload.bootstrap ? {
      threadId: payload.bootstrap.invocation.threadId,
      intentId: payload.bootstrap.invocation.intentId,
      reviewerLaneEnabled: payload.bootstrap.reviewerLane.enabled,
    } : null,
  };

  await env.MEMORY_KV.put(storageKey, stableStringify(record));

  return Response.json({
    accepted: true,
    storageKey,
    executionId: payload.executionId,
    provider: payload.provider,
    workloadType: payload.workloadType,
    tenantId: payload.tenantId,
    networkPolicy: payload.networkPolicy,
    bindings: payload.bindings,
  });
}
