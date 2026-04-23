import Stripe from 'stripe';
import type { Env, ApiKeyRecord } from './types';
import { problemResponse, PROBLEM_TYPES } from './problem-detail';

function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Generate a cryptographically random API key */
function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'mmg_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /billing/checkout
 * Creates a Stripe Checkout session for the $19/mo Pro subscription.
 */
export async function handleCheckout(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return problemResponse({
      type: PROBLEM_TYPES.SERVICE_UNAVAILABLE,
      title: 'Service Unavailable',
      status: 503,
      detail: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.',
    });
  }
  const stripe = getStripe(env);
  const url = new URL(request.url);
  const origin = url.origin;

  let email: string | undefined;
  try {
    const body = await request.json<{ email?: string }>();
    email = body.email;
  } catch {
    // No body is fine
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    ...(email ? { customer_email: email } : {}),
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
    metadata: {
      product: 'thumbgate',
    },
  });

  return Response.json({ url: session.url, sessionId: session.id });
}

/**
 * POST /billing/webhook
 * Handles Stripe webhook events for purchase provisioning and legacy revocation paths.
 */
export async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const stripe = getStripe(env);
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return problemResponse({
      type: PROBLEM_TYPES.WEBHOOK_INVALID,
      title: 'Missing Webhook Signature',
      status: 400,
      detail: 'The stripe-signature header is required.',
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return problemResponse({
      type: PROBLEM_TYPES.WEBHOOK_INVALID,
      title: 'Invalid Webhook Signature',
      status: 400,
      detail: 'Webhook signature verification failed.',
    });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await provisionApiKey(env, session);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await disableApiKey(env, subscription.id);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      if (subscription.status !== 'active') {
        await disableApiKey(env, subscription.id);
      }
      break;
    }
  }

  return Response.json({ received: true });
}

/**
 * Provision a new API key after successful checkout.
 * Stores the key in KEYS_KV and also stores a reverse lookup by billing reference.
 */
async function provisionApiKey(
  env: Env,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const apiKey = generateApiKey();
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? 'unknown';
  const billingReferenceId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.id;

  const record: ApiKeyRecord = {
    customerId,
    billingReferenceId,
    tier: 'pro',
    active: true,
    createdAt: new Date().toISOString(),
  };

  // Store API key -> record
  await env.KEYS_KV.put(`key:${apiKey}`, JSON.stringify(record));

  // Reverse lookup: billing reference -> API key.
  await env.KEYS_KV.put(`billing:${billingReferenceId}`, apiKey);

  // Store customer -> API key (for retrieval)
  await env.KEYS_KV.put(`customer:${customerId}:apikey`, apiKey);
}

/**
 * Disable API key when a stored billing reference is revoked.
 */
async function disableApiKey(env: Env, billingReferenceId: string): Promise<void> {
  const apiKey = await env.KEYS_KV.get(`billing:${billingReferenceId}`);
  if (!apiKey) return;

  const record = await env.KEYS_KV.get<ApiKeyRecord>(`key:${apiKey}`, 'json');
  if (!record) return;

  record.active = false;
  record.tier = 'free';
  await env.KEYS_KV.put(`key:${apiKey}`, JSON.stringify(record));
}
