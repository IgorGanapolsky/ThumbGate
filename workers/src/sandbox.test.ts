import test from 'node:test';
import assert from 'node:assert/strict';

import type { Env, SandboxDispatchEnvelope } from './types';
import { handleSandboxExecute, verifySandboxSignature } from './sandbox';

class MemoryKv {
  public readonly records = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.records.has(key) ? this.records.get(key)! : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.records.set(key, value);
  }
}

async function sign(body: string, secret: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function createEnv(secret = 'worker-secret') {
  const memory = new MemoryKv();
  const env = {
    MEMORY_KV: memory as unknown as KVNamespace,
    KEYS_KV: memory as unknown as KVNamespace,
    GATES_KV: memory as unknown as KVNamespace,
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    STRIPE_PRICE_ID: '',
    FREE_DAILY_LIMIT: '5',
    SANDBOX_SHARED_SECRET: secret,
  } satisfies Env;

  return { env, memory };
}

function buildEnvelope(): SandboxDispatchEnvelope {
  return {
    executionId: 'cfw_test_123',
    provider: 'cloudflare_dynamic_worker',
    workloadType: 'history_distillation',
    tier: 'team',
    tenantId: 'team_thumbgate',
    traceId: 'trace_123',
    requestedAt: '2026-04-03T12:00:00.000Z',
    networkPolicy: {
      mode: 'allow_list',
      allowedHosts: ['api.anthropic.com'],
    },
    bindings: ['MEMORY_KV', 'GATES_KV'],
    limits: {
      maxRuntimeMs: 30000,
      maxContextTokens: 120000,
    },
    bootstrap: {
      invocation: {
        threadId: 'api-thread',
        intentId: 'improve_response_quality',
      },
      reviewerLane: {
        enabled: true,
      },
    },
  };
}

test('verifySandboxSignature accepts a valid request body', async () => {
  const body = JSON.stringify(buildEnvelope());
  const timestamp = new Date().toISOString();
  const signature = await sign(body, 'worker-secret', timestamp);
  const ok = await verifySandboxSignature(body, timestamp, signature, 'worker-secret');
  assert.equal(ok, true);
});

test('handleSandboxExecute stores an accepted sandbox dispatch envelope', async () => {
  const { env, memory } = createEnv();
  const envelope = buildEnvelope();
  const body = JSON.stringify(envelope);
  const timestamp = new Date().toISOString();
  const signature = await sign(body, env.SANDBOX_SHARED_SECRET, timestamp);
  const request = new Request('https://worker.example.com/sandbox/execute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-thumbgate-sandbox-timestamp': timestamp,
      'x-thumbgate-sandbox-signature': signature,
    },
    body,
  });

  const response = await handleSandboxExecute(request, env);
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.accepted, true);
  assert.equal(payload.executionId, envelope.executionId);
  assert.equal(memory.records.has(`sandbox:${envelope.executionId}`), true);
});

test('handleSandboxExecute rejects an invalid signature', async () => {
  const { env } = createEnv();
  const body = JSON.stringify(buildEnvelope());
  const request = new Request('https://worker.example.com/sandbox/execute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-thumbgate-sandbox-timestamp': new Date().toISOString(),
      'x-thumbgate-sandbox-signature': 'deadbeef',
    },
    body,
  });

  const response = await handleSandboxExecute(request, env);
  assert.equal(response.status, 401);
});
