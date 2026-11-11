import test from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

import type { Env } from './types';
import {
  handleCheckout,
  isAutomatedCheckoutRequest,
  normalizeValidCheckoutEmail,
  type StripeCheckoutClient,
} from './billing';

class MemoryKv {
  public readonly records = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.records.has(key) ? this.records.get(key)! : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.records.set(key, value);
  }
}

function createWorkerEnv(stripeSecret = 'sk_test_worker_checkout'): Env {
  const kv = new MemoryKv() as unknown as KVNamespace;
  return {
    MEMORY_KV: kv,
    KEYS_KV: kv,
    GATES_KV: kv,
    STRIPE_SECRET_KEY: stripeSecret,
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_ID: 'price_pro_monthly_19',
    FREE_DAILY_LIMIT: '3',
    SANDBOX_SHARED_SECRET: 'worker-secret',
  };
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('normalizeValidCheckoutEmail validates real addresses in linear time', () => {
  assert.equal(normalizeValidCheckoutEmail('  Buyer@Example.com '), 'buyer@example.com');
  assert.equal(normalizeValidCheckoutEmail(''), null);
  assert.equal(normalizeValidCheckoutEmail('not-an-email'), null);
  assert.equal(normalizeValidCheckoutEmail('bad@domain'), null);
  assert.equal(normalizeValidCheckoutEmail('has space@example.com'), null);
  assert.equal(normalizeValidCheckoutEmail(null), null);
});

test('isAutomatedCheckoutRequest blocks missing, bare Mozilla/5.0, and crawler UAs', () => {
  assert.equal(
    isAutomatedCheckoutRequest(new Request('https://mcp.thumbgate.ai/billing/checkout', { method: 'POST' })),
    true,
  );
  assert.equal(
    isAutomatedCheckoutRequest(
      new Request('https://mcp.thumbgate.ai/billing/checkout', {
        method: 'POST',
        headers: { 'user-agent': 'Mozilla/5.0' },
      }),
    ),
    true,
  );
  assert.equal(
    isAutomatedCheckoutRequest(
      new Request('https://mcp.thumbgate.ai/billing/checkout', {
        method: 'POST',
        headers: { 'user-agent': 'curl/8.7.1' },
      }),
    ),
    true,
  );
  assert.equal(
    isAutomatedCheckoutRequest(
      new Request('https://mcp.thumbgate.ai/billing/checkout', {
        method: 'POST',
        headers: { 'user-agent': BROWSER_UA },
      }),
    ),
    false,
  );
});

test('handleCheckout rejects unconfigured Stripe, bot UAs, and emailless requests without minting sessions', async () => {
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const mockFactory = (): StripeCheckoutClient => ({
    checkout: {
      sessions: {
        async create(params) {
          created.push(params);
          return { id: 'cs_worker_1', url: 'https://checkout.stripe.com/c/pay/cs_worker_1' };
        },
      },
    },
  });

  const unconfiguredRes = await handleCheckout(
    new Request('https://mcp.thumbgate.ai/billing/checkout', {
      method: 'POST',
      headers: { 'user-agent': BROWSER_UA },
      body: JSON.stringify({ customerEmail: 'buyer@acme.io' }),
    }),
    createWorkerEnv(''),
    mockFactory,
  );
  assert.equal(unconfiguredRes.status, 503);

  const botRes = await handleCheckout(
    new Request('https://mcp.thumbgate.ai/billing/checkout', {
      method: 'POST',
      headers: { 'user-agent': 'Googlebot/2.1', 'content-type': 'application/json' },
      body: JSON.stringify({ customerEmail: 'buyer@acme.io' }),
    }),
    createWorkerEnv(),
    mockFactory,
  );
  assert.equal(botRes.status, 403);

  for (const invalidBody of ['{}', '{"email":""}', '{"customerEmail":"invalid"}', 'not-json']) {
    const badRes = await handleCheckout(
      new Request('https://mcp.thumbgate.ai/billing/checkout', {
        method: 'POST',
        headers: { 'user-agent': BROWSER_UA, 'content-type': 'application/json' },
        body: invalidBody,
      }),
      createWorkerEnv(),
      mockFactory,
    );
    assert.equal(badRes.status, 400);
  }

  assert.equal(created.length, 0);
});

test('handleCheckout creates recoverable Stripe session with email and falls back if consent_collection is rejected', async () => {
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  let rejectConsentOnce = false;
  const mockFactory = (): StripeCheckoutClient => ({
    checkout: {
      sessions: {
        async create(params) {
          created.push(params);
          if (rejectConsentOnce && params.consent_collection) {
            rejectConsentOnce = false;
            throw new Error('Invalid parameter consent_collection.promotions');
          }
          return {
            id: `cs_worker_${created.length}`,
            url: `https://checkout.stripe.com/c/pay/cs_worker_${created.length}`,
          };
        },
      },
    },
  });

  const okRes = await handleCheckout(
    new Request('https://mcp.thumbgate.ai/billing/checkout', {
      method: 'POST',
      headers: { 'user-agent': BROWSER_UA, 'content-type': 'application/json' },
      body: JSON.stringify({ customerEmail: 'RealBuyer@Acme.io' }),
    }),
    createWorkerEnv(),
    mockFactory,
  );
  assert.equal(okRes.status, 200);
  const okBody = (await okRes.json()) as { sessionId: string; url: string };
  assert.equal(okBody.sessionId, 'cs_worker_1');
  assert.equal(created[0]?.customer_email, 'realbuyer@acme.io');
  assert.equal(created[0]?.allow_promotion_codes, true);
  assert.equal(created[0]?.after_expiration?.recovery?.enabled, true);
  assert.deepEqual(created[0]?.consent_collection, { promotions: 'auto' });

  rejectConsentOnce = true;
  const fallbackRes = await handleCheckout(
    new Request('https://mcp.thumbgate.ai/billing/checkout', {
      method: 'POST',
      headers: { 'user-agent': BROWSER_UA, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'legacy@acme.io' }),
    }),
    createWorkerEnv(),
    mockFactory,
  );
  assert.equal(fallbackRes.status, 200);
  assert.equal(created.length, 3);
  assert.equal(created[2]?.consent_collection, undefined);
});
