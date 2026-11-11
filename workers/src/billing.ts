import Stripe from 'stripe';
import type { Env, ApiKeyRecord } from './types';
import { problemResponse, PROBLEM_TYPES } from './problem-detail';

export interface StripeCheckoutClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
}

function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Generate a cryptographically random API key */
function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'mmg_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const BOT_UA_PATTERN =
  /(?:googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|anthropic-ai|perplexitybot|ccbot|facebookexternalhit|linkedinbot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|headlesschrome|phantomjs|playwright|puppeteer|selenium|\bcurl\b|\bwget\b|python-requests|python-httpx|aiohttp|go-http-client|node-fetch|\baxios\b|postmanruntime|\bbot\b|\bcrawler\b|\bspider\b)|^mozilla\/5\.0\s*$/i;

export function isAutomatedCheckoutRequest(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) return true;
  return BOT_UA_PATTERN.test(ua);
}

/**
 * Linear-time email syntax validation (RFC 5321 length cap, no polynomial regexes).
 */
export function normalizeValidCheckoutEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 254) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 32 || code === 127) return null;
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@')) return null;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length > 64 || domain.length < 3) return null;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= domain.length - 2) return null;
  return trimmed;
}

function extractRequestedEmail(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if ('customerEmail' in payload) {
    const normalized = normalizeValidCheckoutEmail(payload.customerEmail);
    if (normalized) return normalized;
  }
  if ('email' in payload) {
    const normalized = normalizeValidCheckoutEmail(payload.email);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * POST /billing/checkout
 * Creates a Stripe Checkout session for the $19/mo Pro subscription.
 * Refuses bot/scanner user-agents and anonymous emailless requests so automated
 * probes cannot mint unrecoverable Stripe sessions.
 */
export async function handleCheckout(
  request: Request,
  env: Env,
  stripeFactory: (workerEnv: Env) => StripeCheckoutClient = getStripe,
): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return problemResponse({
      type: PROBLEM_TYPES.SERVICE_UNAVAILABLE,
      title: 'Service Unavailable',
      status: 503,
      detail: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.',
    });
  }

  if (isAutomatedCheckoutRequest(request)) {
    return problemResponse({
      type: PROBLEM_TYPES.FORBIDDEN,
      title: 'Forbidden',
      status: 403,
      detail: 'Automated crawlers and scanners cannot create Stripe Checkout sessions.',
    });
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = await request.json();
  } catch {
    parsedBody = null;
  }

  const customerEmail = extractRequestedEmail(parsedBody);
  if (!customerEmail) {
    return problemResponse({
      type: PROBLEM_TYPES.BAD_REQUEST,
      title: 'Bad Request',
      status: 400,
      detail: 'customerEmail (or email) must be a valid email address.',
    });
  }

  const stripe = stripeFactory(env);
  const url = new URL(request.url);
  const origin = url.origin;

  const basePayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [
      {
        price: env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    customer_email: customerEmail,
    allow_promotion_codes: true,
    after_expiration: {
      recovery: {
        enabled: true,
        allow_promotion_codes: true,
      },
    },
    consent_collection: {
      promotions: 'auto',
    },
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
    metadata: {
      product: 'thumbgate',
    },
  };

  let session: { id: string; url: string | null };
  try {
    session = await stripe.checkout.sessions.create(basePayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('consent_collection')) {
      throw err;
    }
    const { consent_collection: _ignored, ...fallbackPayload } = basePayload;
    session = await stripe.checkout.sessions.create(fallbackPayload);
  }

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
  } catch {
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
