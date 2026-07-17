'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PAYPAL_REPORTING_MAX_LAG_MINUTES,
  auditGithubMarketplaceCsvEvidence,
  auditGithubMarketplaceLedgerEvidence,
  auditPayPalLiveEvidence,
  collectVerifiedIndividualPayments,
  collectGithubMarketplaceLedgerCandidate,
  collectGithubMarketplaceCsvSnapshot,
  collectPayPalCandidateSnapshot,
  collectPayPalRecentPaymentSnapshot,
  exactMoneyToCents,
  localMidnightToUtc,
  parsePayPalTransactions,
  parseCsvRows,
  resolvePayPalConfig,
} = require('../scripts/provider-live-evidence');
const { digestBuyerEmail } = require('../scripts/provider-revenue-evidence');

const NOW = '2026-07-15T16:00:00.000Z';
const TIME_ZONE = 'America/New_York';

function rules(overrides = {}) {
  return {
    invoiceIdPrefixes: ['thumbgate-'],
    ownerIdentifiersReviewed: true,
    ownerAccountIds: ['OWNER-PAYER'],
    ownerEmails: ['owner@example.com'],
    subscriptionsEnabled: false,
    ...overrides,
  };
}

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    THUMBGATE_PAYPAL_CLIENT_ID: 'paypal-client-id',
    THUMBGATE_PAYPAL_CLIENT_SECRET: 'paypal-client-secret-value',
    THUMBGATE_PAYPAL_API_BASE_URL: 'https://paypal.test',
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify(rules()),
    ...overrides,
  };
}

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => payload,
  };
}

function paypalRow({
  id = 'PAYMENT-1',
  code = 'T0007',
  status = 'S',
  value = '10.00',
  currency = 'USD',
  initiatedAt = '2026-07-15T14:00:00Z',
  invoiceId = 'thumbgate-assessment-1',
  referenceId = null,
  accountId = 'EXTERNAL-PAYER',
  email = 'buyer@example.com',
} = {}) {
  return {
    transaction_info: {
      transaction_id: id,
      transaction_event_code: code,
      transaction_status: status,
      transaction_initiation_date: initiatedAt,
      transaction_amount: { currency_code: currency, value },
      invoice_id: invoiceId,
      ...(referenceId ? { paypal_reference_id: referenceId } : {}),
    },
    payer_info: { account_id: accountId, email_address: email },
  };
}

function paypalRecentEvent(overrides = {}) {
  return {
    id: 'WH-EVENT-1',
    create_time: '2026-07-15T15:00:00.000Z',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-1',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '10.00' },
      custom_id: 'thumbgate-assessment-1',
      supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
    },
    ...overrides,
  };
}

function paypalWebhookLedgerRow(event = paypalRecentEvent(), overrides = {}) {
  const body = Buffer.from(JSON.stringify(event));
  return {
    schemaVersion: 1,
    provider: 'paypal',
    receivedAt: event.create_time,
    eventId: event.id,
    eventType: event.event_type,
    eventCreatedAt: event.create_time,
    webhookId: 'WEBHOOK1',
    transmissionId: `TRANSMISSION-${event.id}`,
    verificationStatus: 'SUCCESS',
    verificationSource: 'paypal_verify_webhook_signature_api',
    payloadSha256: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
    rawBodyBase64: body.toString('base64'),
    ...overrides,
  };
}

function paypalRecentEnv(ledgerPath, overrides = {}) {
  return env({
    THUMBGATE_PAYPAL_WEBHOOK_ID: 'WEBHOOK1',
    THUMBGATE_PAYPAL_WEBHOOK_URL: 'https://thumbgate.example/v1/billing/paypal-webhook',
    THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH: ledgerPath,
    ...overrides,
  });
}

function paypalRecentCapture(overrides = {}) {
  return {
    id: 'CAPTURE-1',
    status: 'COMPLETED',
    create_time: '2026-07-15T14:00:00.000Z',
    amount: { currency_code: 'USD', value: '10.00' },
    custom_id: 'thumbgate-assessment-1',
    invoice_id: 'thumbgate-assessment-1',
    supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
    ...overrides,
  };
}

function paypalRecentOrder(overrides = {}) {
  return {
    id: 'ORDER-1',
    status: 'COMPLETED',
    payment_source: { paypal: { account_id: 'EXTERNAL-PAYER', email_address: 'buyer@example.com' } },
    purchase_units: [{
      custom_id: 'thumbgate-assessment-1',
      payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } }] },
    }],
    ...overrides,
  };
}

function paypalRecentFetch({ event = paypalRecentEvent(), capture = paypalRecentCapture(), order = paypalRecentOrder(), links = [] } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/oauth2/token') return response(200, { access_token: 'recent-access-token' }, { 'paypal-debug-id': 'oauth-recent' });
    if (parsed.pathname === '/v1/notifications/webhooks/WEBHOOK1') {
      return response(200, {
        id: 'WEBHOOK1',
        url: 'https://thumbgate.example/v1/billing/paypal-webhook',
        event_types: [...['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED']].map((name) => ({ name })),
      }, { 'paypal-debug-id': 'registration-debug' });
    }
    if (parsed.pathname === '/v1/notifications/webhooks-events') {
      return response(200, { events: [event], links }, { 'paypal-debug-id': 'events-debug' });
    }
    if (parsed.pathname === '/v2/payments/captures/CAPTURE-1') return response(200, capture, { 'paypal-debug-id': 'capture-debug' });
    if (parsed.pathname === '/v2/checkout/orders/ORDER-1') return response(200, order, { 'paypal-debug-id': 'order-debug' });
    throw new Error(`unexpected PayPal test URL: ${parsed}`);
  };
}

function signedGithubLedgerRow({
  secret = 'github-secret',
  deliveryId = 'delivery-1',
  action = 'purchased',
  accountId = 77,
  bodyOverride = null,
} = {}) {
  const body = bodyOverride || Buffer.from(JSON.stringify({
    action,
    marketplace_purchase: {
      id: 9001,
      account: { type: 'Organization', id: accountId },
      billing_cycle: 'monthly',
      plan: { id: 5, monthly_price_in_cents: 4900, yearly_price_in_cents: 49000 },
    },
  }));
  return {
    schemaVersion: 1,
    receivedAt: NOW,
    deliveryId,
    eventName: 'marketplace_purchase',
    signature: `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`,
    payloadSha256: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
    rawBodyBase64: body.toString('base64'),
  };
}

test('PayPal config is capability-aware and rejects incomplete credential, attribution, owner, and subscription packaging', () => {
  assert.match(resolvePayPalConfig({}).gap, /client ID and secret/i);
  assert.match(resolvePayPalConfig(env({ THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: '' })).gap, /rules/i);
  assert.match(resolvePayPalConfig(env({
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify(rules({ invoiceIdPrefixes: [] })),
  })).gap, /attribution matcher/i);
  assert.match(resolvePayPalConfig(env({
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify(rules({ ownerIdentifiersReviewed: false })),
  })).gap, /ownerIdentifiersReviewed/i);
  assert.match(resolvePayPalConfig(env({
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify(rules({ subscriptionsEnabled: true })),
  })).gap, /subscriptionsEnabled=false/i);
});

test('money parsing uses exact integer cents and rejects floating or over-precision ambiguity', () => {
  assert.equal(exactMoneyToCents('10'), 1000);
  assert.equal(exactMoneyToCents('10.05'), 1005);
  assert.equal(exactMoneyToCents('-2.5'), -250);
  assert.equal(exactMoneyToCents('1.001'), null);
  assert.equal(exactMoneyToCents('NaN'), null);
});

test('local midnight conversion respects New York daylight-saving offsets', () => {
  assert.equal(localMidnightToUtc('2026-01-15', TIME_ZONE).toISOString(), '2026-01-15T05:00:00.000Z');
  assert.equal(localMidnightToUtc('2026-07-15', TIME_ZONE).toISOString(), '2026-07-15T04:00:00.000Z');
});

test('PayPal parser reconciles merchant refunds to original cohorts and excludes owner/unrelated rows', () => {
  const config = resolvePayPalConfig(env());
  const parsed = parsePayPalTransactions([
    paypalRow(),
    paypalRow({ id: 'REFUND-1', code: 'T1107', value: '-2.50', invoiceId: '', referenceId: 'PAYMENT-1' }),
    paypalRow({ id: 'OWNER-1', accountId: 'OWNER-PAYER', email: 'owner@example.com' }),
    paypalRow({ id: 'OTHER-1', invoiceId: 'other-product' }),
  ], config);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].grossCents, 1000);
  assert.equal(parsed.transactions[0].refundedCents, 250);
  assert.equal(parsed.transactions[0].status, 'partially_refunded');
  assert.equal(parsed.transactions[0].invoiceId, 'thumbgate-assessment-1');
  assert.equal(parsed.transactions[0].buyerEmailDigest, digestBuyerEmail('buyer@example.com'));
  assert.equal(parsed.diagnostics.ownerRowsExcluded, 1);
  assert.equal(parsed.diagnostics.unrelatedRowsExcluded, 1);
  assert.match(parsed.transactions[0].customerId, /^paypal_[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(parsed).includes('buyer@example.com'), false);
});

test('PayPal parser fails closed on unsupported attributed movements, ambiguous refunds, non-USD, pending, and duplicate rows', () => {
  const config = resolvePayPalConfig(env());
  assert.match(parsePayPalTransactions([paypalRow({ code: 'T1205' })], config).gap, /unsupported revenue event code/i);
  assert.match(parsePayPalTransactions([
    paypalRow(),
    paypalRow({ id: 'REFUND-X', code: 'T1107', value: '-1.00', referenceId: 'MISSING', invoiceId: 'thumbgate-refund' }),
  ], config).gap, /exactly one attributed payment/i);
  assert.match(parsePayPalTransactions([paypalRow({ currency: 'EUR' })], config).gap, /not USD/i);
  assert.match(parsePayPalTransactions([paypalRow({ status: 'P' })], config).gap, /pending/i);
  const duplicate = paypalRow();
  assert.match(parsePayPalTransactions([duplicate, duplicate], config).gap, /malformed or duplicated/i);
  assert.match(parsePayPalTransactions([
    paypalRow(), paypalRow({ code: 'T0006', initiatedAt: '2026-07-15T14:01:00Z' }),
  ], config).gap, /duplicated across provider rows/i);
});

test('PayPal collector authenticates, paginates every page, hashes customer identity, and never returns credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/oauth2/token')) {
      return response(200, { access_token: 'access-token-secret' }, { 'paypal-debug-id': 'oauth-debug' });
    }
    const page = new URL(url).searchParams.get('page');
    if (page === '1') {
      return response(200, {
        transaction_details: [paypalRow()],
        total_pages: 2,
        total_items: 2,
        last_refreshed_datetime: '2026-07-15T15:55:00Z',
      }, { 'paypal-debug-id': 'report-page-1' });
    }
    return response(200, {
      transaction_details: [paypalRow({ id: 'REFUND-1', code: 'T1107', value: '-2.50', invoiceId: '', referenceId: 'PAYMENT-1' })],
      total_pages: 2,
      total_items: 2,
    }, { 'paypal-debug-id': 'report-page-2' });
  };
  const result = await collectPayPalCandidateSnapshot({ env: env(), fetchImpl, now: NOW, timeZone: TIME_ZONE });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.pageCount, 2);
  assert.equal(result.snapshot.transactions[0].refundedCents, 250);
  assert.equal(result.snapshot.scope.completeness, 'provider_reporting_lagged');
  assert.equal(result.snapshot.scope.maximumReportingLagMinutes, PAYPAL_REPORTING_MAX_LAG_MINUTES);
  assert.equal(new URL(calls[1].url).searchParams.get('page_size'), '500');
  assert.equal(new URL(calls[1].url).searchParams.get('fields'), 'all');
  assert.equal(calls[1].options.headers['PayPal-Enforce-ISO8601-Format'], 'true');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('paypal-client-secret-value'), false);
  assert.equal(serialized.includes('access-token-secret'), false);
  assert.equal(serialized.includes('buyer@example.com'), false);
});

test('PayPal collector reports auth failure without reflecting secrets or provider bodies', async () => {
  const result = await collectPayPalCandidateSnapshot({
    env: env(),
    fetchImpl: async () => response(401, { error_description: 'paypal-client-secret-value' }, { 'paypal-debug-id': 'safe-debug-id' }),
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(result.ok, false);
  assert.match(result.gap, /HTTP 401/);
  assert.equal(JSON.stringify(result).includes('paypal-client-secret-value'), false);
  assert.equal(result.diagnostics.paypalDebugId, 'safe-debug-id');
});

test('PayPal collector rejects malformed and oversized pagination instead of truncating evidence', async () => {
  let calls = 0;
  const malformed = await collectPayPalCandidateSnapshot({
    env: env(),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(200, { access_token: 'token' }) : response(200, { total_pages: 1 });
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.match(malformed.gap, /malformed JSON/i);

  calls = 0;
  const oversized = await collectPayPalCandidateSnapshot({
    env: env(),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response(200, { access_token: 'token' })
        : response(200, { transaction_details: [], total_pages: 21, total_items: 10001 });
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.match(oversized.gap, /too large|invalid pagination/i);
});

test('recent PayPal reconciliation verifies registration, event history, capture, order, local delivery, and payer privacy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-evidence-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const calls = [];
  const providerFetch = paypalRecentFetch();
  const result = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return providerFetch(url, options); },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.transactions.length, 1);
  assert.deepEqual(result.snapshot.transactions[0], {
    id: 'paypal-recent:CAPTURE-1',
    providerTransactionId: 'CAPTURE-1',
    status: 'completed',
    createdAt: '2026-07-15T14:00:00.000Z',
    grossCents: 1000,
    refundedCents: 0,
    customerId: result.snapshot.transactions[0].customerId,
    buyerEmailDigest: digestBuyerEmail('buyer@example.com'),
    customerClassification: 'external',
    ownerTest: false,
    productAttribution: { verified: true, product: 'thumbgate' },
    invoiceId: 'thumbgate-assessment-1',
  });
  assert.match(result.snapshot.transactions[0].customerId, /^paypal_[a-f0-9]{24}$/);
  assert.equal(result.diagnostics.registeredWebhookVerified, true);
  assert.equal(result.diagnostics.locallyMatchedEventCount, 1);
  assert.equal(result.diagnostics.missedLocalWebhookCount, 0);
  assert.equal(result.diagnostics.financialTransactionsComplete, false);
  const historyUrl = new URL(calls.find((call) => call.url.includes('/webhooks-events')).url);
  assert.equal(historyUrl.searchParams.get('page_size'), '100');
  assert.equal(historyUrl.searchParams.get('start_time'), '2026-07-15T12:50:00.000Z');
  assert.equal(new URL(calls.find((call) => call.url.includes('/v2/checkout/orders/')).url).searchParams.get('fields'), 'payment_source');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('buyer@example.com'), false);
  assert.equal(serialized.includes('recent-access-token'), false);
  assert.equal(serialized.includes('paypal-client-secret-value'), false);
});

test('recent PayPal reconciliation reports missed local delivery but still requires authoritative provider detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-missed-ledger-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, '');
  const result = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath), fetchImpl: paypalRecentFetch(), now: NOW, timeZone: TIME_ZONE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.transactions.length, 1);
  assert.equal(result.diagnostics.locallyMatchedEventCount, 0);
  assert.equal(result.diagnostics.missedLocalWebhookCount, 1);
});

test('recent PayPal reconciliation fails closed on tampering, webhook drift, unsafe pagination, and order disagreement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-adversarial-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  const row = paypalWebhookLedgerRow();
  fs.writeFileSync(ledgerPath, `${JSON.stringify({ ...row, payloadSha256: `sha256:${'0'.repeat(64)}` })}\n`);
  let calls = 0;
  const tampered = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath), fetchImpl: async () => { calls += 1; throw new Error('must not call'); }, now: NOW,
  });
  assert.match(tampered.gap, /digest/i);
  assert.equal(calls, 0);

  fs.writeFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
  const baseFetch = paypalRecentFetch();
  const drifted = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/v1/notifications/webhooks/WEBHOOK1') {
        return response(200, { id: 'WEBHOOK1', url: 'https://attacker.example/hook', event_types: [] });
      }
      return baseFetch(url, options);
    },
    now: NOW,
  });
  assert.match(drifted.gap, /does not match/i);

  const unsafe = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({ links: [{ rel: 'next', href: 'https://attacker.example/v1/notifications/webhooks-events?page=2' }] }),
    now: NOW,
  });
  assert.match(unsafe.gap, /unsafe next-page URL/i);

  const driftedWindow = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({ links: [{
      rel: 'next',
      href: 'https://paypal.test/v1/notifications/webhooks-events?start_time=2020-01-01T00:00:00Z&end_time=2026-07-15T16:00:00.000Z&page_size=100&move_to=next',
    }] }),
    now: NOW,
  });
  assert.match(driftedWindow.gap, /unsafe next-page URL/i);

  const disagreed = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({
      order: paypalRecentOrder({
        purchase_units: [{ custom_id: 'thumbgate-assessment-1', payments: { captures: [{
          id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '9.99' },
        }] } }],
      }),
    }),
    now: NOW,
  });
  assert.match(disagreed.gap, /disagrees with order/i);

  const attributionDisagreed = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({
      order: paypalRecentOrder({
        purchase_units: [{
          custom_id: 'thumbgate-assessment-1',
          invoice_id: 'thumbgate-conflicting-invoice',
          payments: { captures: [{
            id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' },
          }] },
        }],
      }),
    }),
    now: NOW,
  });
  assert.match(attributionDisagreed.gap, /attribution disagrees with order/i);
});

test('recent PayPal reconciliation excludes owner payments and validates partial-refund arithmetic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-owner-refund-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const owner = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({
      order: paypalRecentOrder({ payment_source: { paypal: { account_id: 'OWNER-PAYER', email_address: 'owner@example.com' } } }),
    }),
    now: NOW,
  });
  assert.equal(owner.ok, true);
  assert.equal(owner.snapshot.transactions.length, 0);
  assert.equal(owner.diagnostics.ownerRowsExcluded, 1);

  const capture = paypalRecentCapture({
    status: 'PARTIALLY_REFUNDED',
    seller_receivable_breakdown: { total_refunded_amount: { currency_code: 'USD', value: '2.50' } },
  });
  const order = paypalRecentOrder({
    purchase_units: [{ custom_id: 'thumbgate-assessment-1', payments: { captures: [{
      id: 'CAPTURE-1', status: 'PARTIALLY_REFUNDED', amount: { currency_code: 'USD', value: '10.00' },
    }] } }],
  });
  const partial = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath), fetchImpl: paypalRecentFetch({ capture, order }), now: NOW,
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.snapshot.transactions[0].status, 'partially_refunded');
  assert.equal(partial.snapshot.transactions[0].refundedCents, 250);
});

test('recent PayPal reconciliation never counts a provider-reversed capture as positive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-reversal-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  const event = paypalRecentEvent({ event_type: 'PAYMENT.CAPTURE.REVERSED' });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow(event))}\n`);
  const result = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath), fetchImpl: paypalRecentFetch({ event }), now: NOW, timeZone: TIME_ZONE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.transactions.length, 0);
  assert.equal(result.diagnostics.reversalRowsExcluded, 1);
  assert.equal(result.diagnostics.locallyMatchedEventCount, 1);
});

test('recent PayPal reconciliation detects financial disagreement between provider history and the verified local event', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-event-collision-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  const localEvent = paypalRecentEvent({
    resource: { ...paypalRecentEvent().resource, amount: { currency_code: 'USD', value: '9.99' } },
  });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow(localEvent))}\n`);
  const result = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath), fetchImpl: paypalRecentFetch(), now: NOW, timeZone: TIME_ZONE,
  });
  assert.equal(result.ok, false);
  assert.match(result.gap, /disagrees with the locally verified delivery/i);
});

test('recent PayPal reconciliation rejects event attribution that disagrees with current capture detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-attribution-collision-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  const event = paypalRecentEvent({
    resource: { ...paypalRecentEvent().resource, custom_id: 'thumbgate-conflicting-attribution' },
  });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow(event))}\n`);
  const result = await collectPayPalRecentPaymentSnapshot({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: paypalRecentFetch({ event }),
    now: NOW,
    timeZone: TIME_ZONE,
  });

  assert.equal(result.ok, false);
  assert.match(result.gap, /event attribution disagrees with current capture/i);
});

test('live PayPal audit adds a fresh event missing from lagged reporting but never upgrades global completeness', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-audit-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const providerFetch = paypalRecentFetch();
  const result = await auditPayPalLiveEvidence({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/v1/reporting/transactions') {
        return response(200, { transaction_details: [], total_pages: 1, total_items: 0 }, { 'paypal-debug-id': 'reporting-debug' });
      }
      return providerFetch(url, options);
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(result.audited, false);
  assert.equal(result.revenue, null);
  assert.equal(result.status, 'provider_api_and_recent_events_collected_but_incomplete');
  assert.equal(result.individualPayments.length, 1);
  assert.equal(result.individualPayments[0].netCents, 1000);
  assert.equal(result.diagnostics.recentPaymentReconciliation.registeredWebhookVerified, true);
  assert.match(result.gap, /global revenue remains incomplete/i);
});

test('live PayPal audit rejects invoice disagreement between reporting and current capture detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-invoice-disagreement-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const providerFetch = paypalRecentFetch();
  const result = await auditPayPalLiveEvidence({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/v1/reporting/transactions') {
        return response(200, {
          transaction_details: [paypalRow({
            id: 'CAPTURE-1',
            initiatedAt: '2026-07-15T14:00:00.000Z',
            invoiceId: 'thumbgate-reporting-conflict',
          })],
          total_pages: 1,
          total_items: 1,
        });
      }
      return providerFetch(url, options);
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });

  assert.equal(result.audited, false);
  assert.equal(result.individualPayments.length, 0);
  assert.match(result.gap, /reporting and recent detail disagree/i);
});

test('live PayPal audit rejects buyer-identity disagreement between reporting and current order detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-buyer-disagreement-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const providerFetch = paypalRecentFetch();
  const result = await auditPayPalLiveEvidence({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/v1/reporting/transactions') {
        return response(200, {
          transaction_details: [paypalRow({
            id: 'CAPTURE-1',
            initiatedAt: '2026-07-15T14:00:00.000Z',
            email: 'different@example.com',
          })],
          total_pages: 1,
          total_items: 1,
        });
      }
      return providerFetch(url, options);
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });

  assert.equal(result.audited, false);
  assert.equal(result.individualPayments.length, 0);
  assert.match(result.gap, /reporting and recent detail disagree/i);
});

test('current PayPal capture detail removes a fully refunded payment still shown as paid by lagged reporting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recent-refund-audit-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(paypalWebhookLedgerRow())}\n`);
  const capture = paypalRecentCapture({
    status: 'REFUNDED',
    seller_receivable_breakdown: { total_refunded_amount: { currency_code: 'USD', value: '10.00' } },
  });
  const order = paypalRecentOrder({
    purchase_units: [{ custom_id: 'thumbgate-assessment-1', payments: { captures: [{
      id: 'CAPTURE-1', status: 'REFUNDED', amount: { currency_code: 'USD', value: '10.00' },
    }] } }],
  });
  const providerFetch = paypalRecentFetch({ capture, order });
  const result = await auditPayPalLiveEvidence({
    env: paypalRecentEnv(ledgerPath),
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/v1/reporting/transactions') {
        return response(200, {
          transaction_details: [paypalRow({ id: 'CAPTURE-1', initiatedAt: '2026-07-15T14:00:00.000Z' })],
          total_pages: 1,
          total_items: 1,
        });
      }
      return providerFetch(url, options);
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(result.audited, false);
  assert.equal(result.revenue, null);
  assert.equal(result.individualPayments.length, 0);
  assert.equal(result.diagnostics.verifiedIndividualPaymentCount, 0);
});

test('live PayPal collection remains audit-incomplete until the documented three-hour lag is covered', async () => {
  let calls = 0;
  const result = await auditPayPalLiveEvidence({
    env: env(),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response(200, { access_token: 'token' })
        : response(200, { transaction_details: [paypalRow()], total_pages: 1, total_items: 1 });
    },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(result.audited, false);
  assert.equal(result.status, 'provider_api_collected_but_incomplete');
  assert.equal(result.diagnostics.collected, true);
  assert.equal(result.individualPayments.length, 1);
  assert.equal(result.individualPayments[0].netCents, 1000);
  assert.equal(result.individualPayments[0].localDate, '2026-07-15');
  assert.equal(result.individualPayments[0].invoiceId, 'thumbgate-assessment-1');
  assert.equal(result.individualPayments[0].buyerEmailDigest, digestBuyerEmail('buyer@example.com'));
  assert.equal(result.individualPayments[0].evidenceVerified, true);
  assert.match(result.individualPayments[0].evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.gap, /lag by up to three hours/i);
  assert.equal(result.revenue, null);
});

test('individual PayPal payment proof accepts only positive external attributed rows and never upgrades global completeness', () => {
  const base = {
    schemaVersion: 1,
    provider: 'paypal',
    generatedAt: NOW,
    source: { kind: 'provider_api_live', reference: 'paypal-debug-ids:debug-1' },
    currency: 'usd',
    transactions: parsePayPalTransactions([paypalRow()], resolvePayPalConfig(env())).transactions,
  };
  const accepted = collectVerifiedIndividualPayments(base, { now: NOW, timeZone: TIME_ZONE });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.payments.length, 1);
  assert.equal(accepted.payments[0].invoiceId, 'thumbgate-assessment-1');
  assert.equal(accepted.payments[0].buyerEmailDigest, digestBuyerEmail('buyer@example.com'));
  assert.equal(accepted.payments[0].customerId.includes('@'), false);

  const refunded = structuredClone(base);
  refunded.transactions[0].status = 'refunded';
  refunded.transactions[0].refundedCents = refunded.transactions[0].grossCents;
  const refundedResult = collectVerifiedIndividualPayments(refunded, { now: NOW, timeZone: TIME_ZONE });
  assert.equal(refundedResult.payments.length, 0);
  assert.equal(refundedResult.states.length, 1);
  assert.equal(refundedResult.states[0].netCents, 0);
  assert.equal(refundedResult.states[0].status, 'refunded');

  const forged = structuredClone(base);
  forged.transactions[0].ownerTest = true;
  const rejected = collectVerifiedIndividualPayments(forged, { now: NOW, timeZone: TIME_ZONE });
  assert.equal(rejected.ok, false);
  assert.match(rejected.gap, /malformed or unverified/i);

  const unbound = structuredClone(base);
  delete unbound.transactions[0].buyerEmailDigest;
  const unboundResult = collectVerifiedIndividualPayments(unbound, { now: NOW, timeZone: TIME_ZONE });
  assert.equal(unboundResult.ok, false);
  assert.match(unboundResult.gap, /malformed or unverified/i);
});

test('missing PayPal credentials cause zero network calls and explicit unknown—not audited zero', async () => {
  let calls = 0;
  const result = await auditPayPalLiveEvidence({
    env: {},
    fetchImpl: async () => { calls += 1; throw new Error('should not be called'); },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(calls, 0);
  assert.equal(result.audited, false);
  assert.equal(result.revenue, null);
  assert.match(result.gap, /not configured/i);
});

test('partially configured PayPal recent-payment evidence fails before any network request', async () => {
  let calls = 0;
  const result = await auditPayPalLiveEvidence({
    env: env({ THUMBGATE_PAYPAL_WEBHOOK_ID: 'WEBHOOK1' }),
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(calls, 0);
  assert.equal(result.audited, false);
  assert.equal(result.revenue, null);
  assert.match(result.gap, /partially configured/i);
});

test('signed GitHub Marketplace ledger is re-verified from raw payload bytes but stays financial-incomplete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-marketplace-evidence-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(signedGithubLedgerRow())}\n`);
  const candidate = collectGithubMarketplaceLedgerCandidate({
    ledgerPath,
    secret: 'github-secret',
    now: NOW,
    timeZone: TIME_ZONE,
  });
  assert.equal(candidate.ok, true);
  assert.equal(candidate.diagnostics.signaturesVerified, true);
  assert.equal(candidate.diagnostics.deliveryCount, 1);
  assert.equal(candidate.diagnostics.financialTransactionsComplete, false);
  assert.equal(candidate.snapshot.scope.completeness, 'subscription_events_only');

  const audit = auditGithubMarketplaceLedgerEvidence({ ledgerPath, secret: 'github-secret', now: NOW, timeZone: TIME_ZONE });
  assert.equal(audit.audited, false);
  assert.equal(audit.revenue, null);
  assert.match(audit.gap, /Transactions CSV export/i);
});

test('GitHub ledger verification rejects wrong secrets, payload tampering, duplicate delivery IDs, and missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-marketplace-adversarial-'));
  const ledgerPath = path.join(dir, 'deliveries.jsonl');
  const row = signedGithubLedgerRow();
  fs.writeFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
  assert.match(collectGithubMarketplaceLedgerCandidate({ ledgerPath, secret: 'wrong', now: NOW }).gap, /HMAC/i);

  const tampered = { ...row, rawBodyBase64: Buffer.from('tampered').toString('base64') };
  fs.writeFileSync(ledgerPath, `${JSON.stringify(tampered)}\n`);
  assert.match(collectGithubMarketplaceLedgerCandidate({ ledgerPath, secret: 'github-secret', now: NOW }).gap, /digest or HMAC/i);

  fs.writeFileSync(ledgerPath, `${JSON.stringify(row)}\n${JSON.stringify(row)}\n`);
  assert.match(collectGithubMarketplaceLedgerCandidate({ ledgerPath, secret: 'github-secret', now: NOW }).gap, /malformed or duplicated/i);
  assert.match(collectGithubMarketplaceLedgerCandidate({ ledgerPath: path.join(dir, 'missing'), secret: 'github-secret', now: NOW }).gap, /could not be read/i);
  assert.match(collectGithubMarketplaceLedgerCandidate({ ledgerPath, secret: '', now: NOW }).gap, /secret is not configured/i);
});

function githubCsv(rows) {
  const header = 'date,app_name,user_login,user_id,user_type,country,amount_in_cents,renewal_frequency,marketplace_listing_plan_id,region,postal_code';
  return `${header}\n${rows.join('\n')}\n`;
}

test('CSV parser preserves commas and quotes inside GitHub Marketplace fields', () => {
  const rows = parseCsvRows('a,b\r\n"ThumbGate, Inc.","a ""quoted"" value"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['ThumbGate, Inc.', 'a "quoted" value']]);
  assert.throws(() => parseCsvRows('a,"unterminated'), /unterminated/i);
});

test('official GitHub Marketplace Transactions CSV converts to attributed revenue without fabricating MRR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-marketplace-csv-'));
  const csvPath = path.join(dir, 'transactions.csv');
  fs.writeFileSync(csvPath, githubCsv([
    '2026-07-15,ThumbGate,buyer,77,Organization,USA,4900,Monthly,5,NY,10001',
    '2026-07-14,ThumbGate,owner,1,User,USA,9900,Monthly,5,NY,10001',
    '2026-07-13,ThumbGate,cancelled,88,User,USA,0,Yearly,5,CA,94107',
    '2026-05-01,ThumbGate,old,99,User,USA,4900,Monthly,5,TX,78701',
  ]));
  const mtime = new Date('2026-07-15T15:55:00.000Z');
  fs.utimesSync(csvPath, mtime, mtime);
  const options = {
    csvPath,
    expectedAppName: 'ThumbGate',
    ownerAccountIds: ['1'],
    ownerIdentifiersReviewed: true,
    exportScope: 'all',
    now: NOW,
    timeZone: TIME_ZONE,
  };
  const candidate = collectGithubMarketplaceCsvSnapshot(options);
  assert.equal(candidate.ok, true);
  assert.equal(candidate.snapshot.transactions.length, 1);
  assert.equal(candidate.snapshot.transactions[0].grossCents, 4900);
  assert.equal(candidate.snapshot.scope.subscriptionsCompleteness, 'not_audited');
  assert.equal(candidate.diagnostics.ownerRowsExcluded, 1);
  assert.equal(candidate.diagnostics.zeroAmountRows, 1);
  assert.equal(JSON.stringify(candidate).includes('buyer'), false);

  const audit = auditGithubMarketplaceCsvEvidence(options);
  assert.equal(audit.audited, true);
  assert.equal(audit.revenue.todayGrossRevenueCents, 4900);
  assert.equal(audit.revenue.externalMrrCents, null);
  assert.equal(audit.revenue.activeExternalSubscriptions, null);
  assert.match(audit.evidenceSource, /provider_api_export:github-marketplace-transactions-csv/);
});

test('GitHub Transactions CSV fails closed on missing scope, stale files, wrong app, negative amounts, and duplicate rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-marketplace-csv-adversarial-'));
  const csvPath = path.join(dir, 'transactions.csv');
  const validRow = '2026-07-15,ThumbGate,buyer,77,Organization,USA,4900,Monthly,5,NY,10001';
  fs.writeFileSync(csvPath, githubCsv([validRow]));
  const fresh = new Date('2026-07-15T15:55:00.000Z');
  fs.utimesSync(csvPath, fresh, fresh);
  const base = {
    csvPath,
    expectedAppName: 'ThumbGate',
    ownerAccountIds: [],
    ownerIdentifiersReviewed: true,
    exportScope: 'all',
    now: NOW,
    timeZone: TIME_ZONE,
  };
  assert.match(collectGithubMarketplaceCsvSnapshot({ ...base, exportScope: 'month' }).gap, /entire-duration/i);

  fs.writeFileSync(csvPath, githubCsv(['2026-07-15,OtherApp,buyer,77,Organization,USA,4900,Monthly,5,NY,10001']));
  fs.utimesSync(csvPath, fresh, fresh);
  assert.match(collectGithubMarketplaceCsvSnapshot(base).gap, /expected app name/i);

  fs.writeFileSync(csvPath, githubCsv(['2026-07-15,ThumbGate,buyer,77,Organization,USA,-1,Monthly,5,NY,10001']));
  fs.utimesSync(csvPath, fresh, fresh);
  assert.match(collectGithubMarketplaceCsvSnapshot(base).gap, /negative or non-integer/i);

  fs.writeFileSync(csvPath, githubCsv([validRow, validRow]));
  fs.utimesSync(csvPath, fresh, fresh);
  assert.match(collectGithubMarketplaceCsvSnapshot(base).gap, /duplicates another row/i);

  fs.writeFileSync(csvPath, githubCsv([validRow]));
  const stale = new Date('2026-07-10T00:00:00.000Z');
  fs.utimesSync(csvPath, stale, stale);
  const audit = auditGithubMarketplaceCsvEvidence(base);
  assert.equal(audit.audited, false);
  assert.match(audit.gap, /stale/i);
});
