'use strict';

/**
 * tests/billing.test.js
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { startServer } = require('../src/api/server');

let tmpDir;
const billingTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-suite-'));
const testApiKeysPath = path.join(billingTestRoot, 'api-keys.json');
const testFunnelLedgerPath = path.join(billingTestRoot, 'funnel-events.jsonl');
const testRevenueLedgerPath = path.join(billingTestRoot, 'revenue-events.jsonl');
const testLocalCheckoutSessionsPath = path.join(billingTestRoot, 'local-checkout-sessions.json');
const testFeedbackDir = path.join(billingTestRoot, 'feedback');

const savedApiKeysPath = process.env._TEST_API_KEYS_PATH;
const savedFunnelPath = process.env._TEST_FUNNEL_LEDGER_PATH;
const savedRevenuePath = process.env._TEST_REVENUE_LEDGER_PATH;
const savedLocalCheckoutSessionsPath = process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
const savedGithubPlanPricing = process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
const savedStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const savedStripePriceId = process.env.STRIPE_PRICE_ID;
const savedFeedbackDir = process.env.RLHF_FEEDBACK_DIR;

// Initial setup
process.env._TEST_API_KEYS_PATH = testApiKeysPath;
process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
process.env._TEST_REVENUE_LEDGER_PATH = testRevenueLedgerPath;
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = testLocalCheckoutSessionsPath;
process.env.RLHF_FEEDBACK_DIR = testFeedbackDir;
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';

after(() => {
  process.env.STRIPE_SECRET_KEY = savedStripeSecretKey || '';
  process.env.STRIPE_PRICE_ID = savedStripePriceId || '';
  if (savedApiKeysPath === undefined) delete process.env._TEST_API_KEYS_PATH;
  else process.env._TEST_API_KEYS_PATH = savedApiKeysPath;
  if (savedFunnelPath === undefined) delete process.env._TEST_FUNNEL_LEDGER_PATH;
  else process.env._TEST_FUNNEL_LEDGER_PATH = savedFunnelPath;
  if (savedRevenuePath === undefined) delete process.env._TEST_REVENUE_LEDGER_PATH;
  else process.env._TEST_REVENUE_LEDGER_PATH = savedRevenuePath;
  if (savedLocalCheckoutSessionsPath === undefined) delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  else process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedLocalCheckoutSessionsPath;
  if (savedGithubPlanPricing === undefined) delete process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
  else process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = savedGithubPlanPricing;
  if (savedFeedbackDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
  else process.env.RLHF_FEEDBACK_DIR = savedFeedbackDir;
  fs.rmSync(billingTestRoot, { recursive: true, force: true });
});

function setupTempStore() {
  if (fs.existsSync(testApiKeysPath)) fs.rmSync(testApiKeysPath, { force: true });
  return testApiKeysPath;
}

function cleanupTempStore() {
  if (fs.existsSync(testApiKeysPath)) fs.rmSync(testApiKeysPath, { force: true });
}

function requireFreshBilling(stripeKey = '') {
  delete require.cache[require.resolve('../scripts/billing')];
  process.env.STRIPE_SECRET_KEY = stripeKey;
  return require('../scripts/billing');
}

function clearBillingArtifacts() {
  for (const target of [testApiKeysPath, testFunnelLedgerPath, testRevenueLedgerPath, testLocalCheckoutSessionsPath]) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  fs.rmSync(testFeedbackDir, { recursive: true, force: true });
}

function readLedgerEvents() {
  if (!fs.existsSync(testFunnelLedgerPath)) return [];
  return fs.readFileSync(testFunnelLedgerPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

function readRevenueEvents() {
  if (!fs.existsSync(testRevenueLedgerPath)) return [];
  return fs.readFileSync(testRevenueLedgerPath, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

describe('billing.js — provisionApiKey', () => {
  let keyStorePath;
  beforeEach(() => { keyStorePath = setupTempStore(); });
  afterEach(() => { cleanupTempStore(); });

  test('generates a unique key with rlhf_ prefix', () => {
    const billing = requireFreshBilling('');
    assert.equal(billing._API_KEYS_PATH(), keyStorePath);
    const result = billing.provisionApiKey('cus_test_001');
    assert.ok(result.key.startsWith('rlhf_'));
    assert.equal(result.customerId, 'cus_test_001');
    assert.ok(JSON.parse(fs.readFileSync(keyStorePath, 'utf-8')).keys[result.key]);
  });

  test('reuses existing active key for same customerId', () => {
    const billing = requireFreshBilling('');
    const r1 = billing.provisionApiKey('cus_reuse_001');
    const r2 = billing.provisionApiKey('cus_reuse_001');
    assert.equal(r1.key, r2.key);
  });
});

describe('billing.js — funnel ledger', () => {
  beforeEach(() => { 
    clearBillingArtifacts(); 
    delete require.cache[require.resolve('../scripts/billing')];
    process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
    process.env._TEST_REVENUE_LEDGER_PATH = testRevenueLedgerPath;
    delete process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
  });

  test('createCheckoutSession emits acquisition event', async () => {
    const billing = require('../scripts/billing');
    const result = await billing.createCheckoutSession({
      installId: 'inst_123',
      metadata: {
        source: 'website',
        utmSource: 'website',
        utmMedium: 'cta_button',
        utmCampaign: 'test',
      },
    });
    assert.ok(result.sessionId.startsWith('test_session_'));
    assert.match(result.traceId, /^checkout_/);
    const events = readLedgerEvents();
    const acq = events.find(e => e.stage === 'acquisition');
    assert.ok(acq);
    assert.equal(acq.installId, 'inst_123');
    assert.equal(acq.traceId, result.traceId);
    assert.equal(acq.metadata.utmSource, 'website');
    assert.equal(acq.metadata.utmCampaign, 'test');
  });

  test('checkout session status preserves trace id for cross-service lookup', async () => {
    const billing = require('../scripts/billing');
    const checkout = await billing.createCheckoutSession({ installId: 'inst_trace_lookup' });
    const session = await billing.getCheckoutSessionStatus(checkout.sessionId);
    assert.equal(session.found, true);
    assert.equal(session.traceId, checkout.traceId);
  });

  test('recordUsage emits activation only once', () => {
    const billing = require('../scripts/billing');
    const p = billing.provisionApiKey('cus_act');
    billing.recordUsage(p.key);
    billing.recordUsage(p.key);
    const events = readLedgerEvents();
    assert.equal(events.filter(e => e.stage === 'activation').length, 1);
  });

  test('getBillingSummary merges funnel ledger and key store state', () => {
    const billing = require('../scripts/billing');
    const { appendWorkflowSprintLead } = require('../scripts/workflow-sprint-intake');
    const activeKey = billing.provisionApiKey('cus_summary_a', {
      installId: 'inst_summary_a',
      source: 'stripe_webhook_checkout_completed',
    });
    const disabledKey = billing.provisionApiKey('cus_summary_b', {
      installId: 'inst_summary_b',
      source: 'github_marketplace_purchased',
    });

    billing.recordUsage(activeKey.key);
    billing.recordUsage(activeKey.key);
    billing.disableCustomerKeys('cus_summary_b');
    billing.appendFunnelEvent({
      stage: 'acquisition',
      event: 'checkout_session_created',
      installId: 'inst_summary_a',
      evidence: 'sess_summary_a',
      metadata: {
        customerId: 'cus_summary_a',
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
    });
    billing.appendFunnelEvent({
      stage: 'paid',
      event: 'stripe_checkout_completed',
      installId: 'inst_summary_a',
      evidence: 'cs_summary_a',
      traceId: 'trace_summary_a',
      metadata: {
        customerId: 'cus_summary_a',
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
    });
    billing.appendRevenueEvent({
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      customerId: 'cus_summary_a',
      orderId: 'cs_summary_a',
      installId: 'inst_summary_a',
      traceId: 'trace_summary_a',
      amountCents: 4900,
      currency: 'usd',
      amountKnown: true,
      recurringInterval: null,
      attribution: {
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
      metadata: { subscriptionId: 'sub_summary_a' },
    });
    appendWorkflowSprintLead({
      email: 'ops@example.com',
      company: 'Example Co',
      workflow: 'Claude code modernization approvals',
      owner: 'Platform lead',
      blocker: 'Auditors reject deployments without machine-readable proof',
      runtime: 'Claude Code + MCP',
      source: 'linkedin',
      utmSource: 'linkedin',
      utmCampaign: 'workflow_hardening',
      community: 'platform',
    });

    const summary = billing.getBillingSummary();
    assert.equal(summary.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
    assert.equal(summary.coverage.tracksBookedRevenue, true);
    assert.equal(summary.coverage.tracksPaidOrders, true);
    assert.equal(summary.coverage.tracksWorkflowSprintLeads, true);
    assert.equal(summary.funnel.stageCounts.acquisition, 1);
    assert.equal(summary.funnel.stageCounts.activation, 1);
    assert.equal(summary.funnel.stageCounts.paid, 1);
    assert.equal(summary.signups.uniqueLeads, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 4900);
    assert.equal(summary.revenue.amountKnownCoverageRate, 1);
    assert.equal(summary.revenue.paidProviderEvents, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.contactable, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byStatus.new, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byCampaign.workflow_hardening, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byCommunity.platform, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byRuntime['Claude Code + MCP'], 1);
    assert.equal(summary.pipeline.workflowSprintLeads.latestLead.email, 'ops@example.com');
    assert.equal(summary.pipeline.qualifiedWorkflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.qualifiedWorkflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.attribution.acquisitionBySource.reddit, 1);
    assert.equal(summary.attribution.acquisitionByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.acquisitionByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.acquisitionByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.acquisitionByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.acquisitionByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.attribution.paidByCampaign.reddit_launch, 1);
    assert.equal(summary.attribution.paidByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.paidByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.paidByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.paidByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.paidByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.attribution.bookedRevenueBySourceCents.reddit, 4900);
    assert.equal(summary.attribution.bookedRevenueByCommunityCents.ClaudeCode, 4900);
    assert.equal(summary.attribution.bookedRevenueByPostIdCents['1rsudq0'], 4900);
    assert.equal(summary.attribution.bookedRevenueByCommentIdCents.oa9mqjf, 4900);
    assert.equal(summary.attribution.bookedRevenueByCampaignVariantCents.comment_problem_solution, 4900);
    assert.equal(summary.attribution.bookedRevenueByOfferCodeCents['REDDIT-EARLY'], 4900);
    assert.equal(summary.attribution.conversionByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.conversionByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.conversionByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.conversionByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.conversionByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.keys.total, 2);
    assert.equal(summary.keys.active, 1);
    assert.equal(summary.keys.disabled, 1);
    assert.equal(summary.keys.totalUsage, 2);
    assert.equal(summary.keys.activeCustomers, 1);
    assert.equal(summary.keys.bySource.stripe_webhook_checkout_completed, 1);
    assert.equal(summary.keys.bySource.github_marketplace_purchased, 1);
    assert.equal(summary.keys.activeBySource.stripe_webhook_checkout_completed, 1);
    assert.ok(summary.funnel.firstPaidAt);
    assert.equal(summary.funnel.lastPaidEvent.customerId, 'cus_summary_a');
    assert.equal(summary.dataQuality.unreconciledPaidEvents, 0);

    const activeCustomer = summary.customers.find((entry) => entry.customerId === 'cus_summary_a');
    const disabledCustomer = summary.customers.find((entry) => entry.customerId === 'cus_summary_b');
    assert.equal(activeCustomer.activeKeys, 1);
    assert.equal(activeCustomer.usageCount, 2);
    assert.equal(disabledCustomer.activeKeys, 0);
    assert.equal(disabledCustomer.source, 'github_marketplace_purchased');
    assert.equal(disabledKey.customerId, 'cus_summary_b');
  });

  test('handleGithubWebhook records paid order with unknown amount when plan pricing is not configured', () => {
    const billing = require('../scripts/billing');
    billing.handleGithubWebhook({
      action: 'purchased',
      marketplace_purchase: {
        account: { type: 'User', id: 42, login: 'octocat' },
        plan: { id: 1, name: 'Pro' },
      },
    });

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].provider, 'github_marketplace');
    assert.equal(revenueEvents[0].amountKnown, false);
    assert.equal(revenueEvents[0].amountCents, null);
  });

  test('handleGithubWebhook records booked revenue when plan pricing is configured', () => {
    process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = JSON.stringify({
      7: { amountCents: 4900, currency: 'USD', recurringInterval: null },
    });
    const billing = requireFreshBilling('');
    billing.handleGithubWebhook({
      action: 'purchased',
      marketplace_purchase: {
        account: { type: 'Organization', id: 77, login: 'team' },
        plan: { id: 7, name: 'Pro' },
      },
    });

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].amountKnown, true);
    assert.equal(revenueEvents[0].amountCents, 4900);
    assert.equal(revenueEvents[0].currency, 'USD');
    assert.equal(revenueEvents[0].recurringInterval, null);
  });

  test('getBillingSummary derives paid orders from paid provider events when revenue ledger is missing', () => {
    const billing = require('../scripts/billing');
    billing.appendFunnelEvent({
      stage: 'paid',
      event: 'github_marketplace_purchased',
      evidence: 'marketplace_order_derived',
      metadata: {
        provider: 'github_marketplace',
        customerId: 'github_user_derived',
        marketplaceOrderId: 'marketplace_order_derived',
        source: 'github_marketplace',
      },
    });

    const summary = billing.getBillingSummary();
    assert.equal(summary.revenue.paidProviderEvents, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 0);
    assert.equal(summary.revenue.amountKnownCoverageRate, 0);
    assert.equal(summary.revenue.derivedPaidOrders, 1);
    assert.equal(summary.dataQuality.unreconciledPaidEvents, 0);
  });

  test('getBillingSummary applies today window across revenue, telemetry, and sprint leads', () => {
    const billing = require('../scripts/billing');
    const telemetryPath = path.join(testFeedbackDir, 'telemetry-pings.jsonl');
    const leadsPath = path.join(testFeedbackDir, 'workflow-sprint-leads.jsonl');

    billing.provisionApiKey('cus_window_summary', {
      installId: 'inst_window_summary',
      source: 'stripe_webhook_checkout_completed',
    });

    fs.mkdirSync(testFeedbackDir, { recursive: true });
    fs.writeFileSync(testFunnelLedgerPath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        installId: 'inst_old_summary',
        traceId: 'trace_old_summary',
        evidence: 'sess_old_summary',
        metadata: {
          customerId: 'cus_old_summary',
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        evidence: 'sess_window_summary',
        metadata: {
          customerId: 'cus_window_summary',
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:05:00.000Z',
        stage: 'paid',
        event: 'stripe_checkout_completed',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        evidence: 'cs_window_summary',
        metadata: {
          customerId: 'cus_window_summary',
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(testRevenueLedgerPath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:40:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_old_summary',
        evidence: 'cs_old_summary',
        customerId: 'cus_old_summary',
        installId: 'inst_old_summary',
        traceId: 'trace_old_summary',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_window_summary',
        evidence: 'cs_window_summary',
        customerId: 'cus_window_summary',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(leadsPath, [
      JSON.stringify({
        leadId: 'lead_old_summary',
        submittedAt: '2026-03-18T20:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old@example.com',
          company: 'Old Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
      }),
      JSON.stringify({
        leadId: 'lead_window_summary',
        submittedAt: '2026-03-19T11:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today@example.com',
          company: 'Today Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmSource: 'linkedin',
          utmCampaign: 'today_launch',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(telemetryPath, [
      JSON.stringify({
        receivedAt: '2026-03-18T22:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_old_summary',
        visitorId: 'visitor_old_summary',
        sessionId: 'session_old_summary',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T09:55:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        source: 'website',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T10:00:00.000Z',
        eventType: 'checkout_start',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        source: 'website',
        ctaId: 'pricing_pro',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T10:06:00.000Z',
        eventType: 'checkout_paid_confirmed',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        traceId: 'trace_window_summary',
      }),
      '',
    ].join('\n'));

    const summary = billing.getBillingSummary({
      window: 'today',
      timeZone: 'UTC',
      now: '2026-03-19T18:00:00.000Z',
    });

    assert.equal(summary.window.window, 'today');
    assert.equal(summary.window.startLocalDate, '2026-03-19');
    assert.equal(summary.signups.total, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 4900);
    assert.equal(summary.pipeline.workflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.trafficMetrics.pageViews, 1);
    assert.equal(summary.trafficMetrics.checkoutStarts, 1);
    assert.equal(summary.trafficMetrics.checkoutPaidConfirmations, 1);
    assert.equal(summary.keys.scope, 'current_state');
    assert.equal(summary.keys.windowed, false);
  });
});

describe('billing.js — rotateApiKey', () => {
  test('rotateApiKey rotates key and disables old one', () => {
    const keyStorePath = setupTempStore();
    const billing = requireFreshBilling('');
    const p1 = billing.provisionApiKey('cus_rot');
    const oldKey = p1.key;
    const rot = billing.rotateApiKey(oldKey);
    assert.equal(rot.rotated, true);
    assert.ok(rot.key.startsWith('rlhf_'));
    assert.notEqual(rot.key, oldKey);
    assert.equal(billing.validateApiKey(oldKey).valid, false);
    assert.equal(billing.validateApiKey(rot.key).valid, true);
    cleanupTempStore();
  });
});

describe('API server — /v1/billing/* routes', () => {
  let server, port, billing;
  before(async () => {
    process.env.RLHF_ALLOW_INSECURE = 'true';
    process.env._TEST_API_KEYS_PATH = testApiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = testLocalCheckoutSessionsPath;

    delete require.cache[require.resolve('../src/api/server')];
    delete require.cache[require.resolve('../scripts/billing')];
    
    const { startServer: freshStart } = require('../src/api/server');
    const started = await freshStart({ port: 0 });
    server = started.server;
    port = started.port;
    billing = require('../scripts/billing');
  });
  after(async () => {
    await new Promise(r => server.close(r));
    delete process.env.RLHF_ALLOW_INSECURE;
  });

  test('POST /v1/billing/checkout returns sessionId', async () => {
    const res = await fetch(`http://localhost:${port}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId: 'inst_api' })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.ok(body && body.sessionId && body.sessionId.startsWith('test_session_'));
    assert.match(body.traceId, /^checkout_/);
    assert.equal(res.headers.get('x-rlhf-trace-id'), body.traceId);
  });
});
