import type { Env, AuthResult, ApiKeyRecord } from './types';

/**
 * Validate an API key from the Authorization header.
 * Free-tier callers can omit the header entirely.
 */
export async function validateAuth(
  request: Request,
  env: Env,
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: true, tier: 'free', customerId: null };
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    return { valid: true, tier: 'free', customerId: null };
  }

  const record = await env.KEYS_KV.get<ApiKeyRecord>(
    `key:${apiKey}`,
    'json',
  );

  if (!record) {
    return { valid: false, tier: 'free', customerId: null };
  }

  if (!record.active) {
    return { valid: false, tier: 'free', customerId: record.customerId };
  }

  return {
    valid: true,
    tier: record.tier,
    customerId: record.customerId,
  };
}

/**
 * Require pro tier — returns a 402 JSON-RPC error if not subscribed.
 */
export function requirePro(auth: AuthResult): { code: number; message: string } | null {
  if (auth.tier === 'pro' && auth.valid) {
    return null;
  }
  return {
    code: -32001,
    message:
      'Payment required. This tool requires an active Pro purchase ($49 one-time). Visit /billing/checkout to upgrade.',
  };
}
