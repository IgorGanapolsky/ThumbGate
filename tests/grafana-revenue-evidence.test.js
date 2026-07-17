'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CLAIM_BOUNDARY,
  buildGrafanaDashboard,
  buildLokiPayload,
  buildObservedFunnelFields,
  buildStripeCatalogFields,
  buildRevenueEvidenceSnapshot,
  parseArgs,
  runCli,
  sendLokiPayload,
  validateLokiEndpoint,
  validateRevenueEvidenceLokiPayload,
  validateRevenueEvidenceSnapshot,
} = require('../scripts/grafana-revenue-evidence');

const NOW = '2026-07-16T14:00:00.000Z';

function targetEvidence(overrides = {}) {
  return {
    generatedAt: '2026-07-16T13:49:59.468Z',
    status: 'evidence_incomplete',
    claim: 'The $1,000/hour target is not verified by this evidence snapshot.',
    milestones: {
      firstExternalPayment: { achieved: false, verifiedIndividualPaymentCount: 0 },
      sameDayExternalPayment: { achieved: false, verifiedIndividualPaymentCount: 0 },
      targetWithCurrentControlDeployed: { achieved: false },
    },
    evidence: {
      pipeline: {
        total: 40,
        verifiedPaid: 0,
        bookedRevenueCents: 0,
        evidenceGapCount: 39,
      },
      deployment: {
        healthy: true,
        expectedSha: 'e594d49d1a50d0b8b81b4dd5ab72466166ce7a63',
        deployedSha: 'c0bc017a15565c5c6ee2aa9c1464ae5be6b35b03',
        expectedRevisionDeployed: false,
      },
      providerCoverage: { completeForGlobalClaim: false },
    },
    privateBuyerEmail: 'must-not-export@example.com',
    ...overrides,
  };
}

function remediationEvidence(overrides = {}) {
  return {
    generatedAt: '2026-07-16T13:31:33.000Z',
    summary: {
      total: 40,
      sameDayEvidencePriority: 0,
      sameDayReviewPriority: 2,
      approvalReady: 0,
      internalReady: 0,
    },
    rows: [{ leadId: 'must_not_export', contact: { email: 'private@example.com' } }],
    ...overrides,
  };
}

function billingEvidence(overrides = {}) {
  return {
    generatedAt: '2026-07-16T14:05:00.000Z',
    trafficMetrics: {
      visitors: 331,
      pageViews: 479,
      ctaClicks: 11,
      checkoutStarts: 2,
    },
    ctas: {
      totalClicks: 11,
      checkoutStarts: 2,
      diagnosticCheckoutStarts: 2,
      workflowIntakeClicks: 0,
    },
    pipeline: {
      workflowSprintLeads: {
        total: 1,
        contactable: 1,
        byStatus: { new: 1 },
        latestLead: {
          email: 'buyer-must-not-export@example.com',
          company: 'Private Company',
          leadId: 'lead_must_not_export',
        },
      },
      // This is the legacy production meaning: structurally complete, not
      // lifecycle-qualified. The exporter must not promote it.
      qualifiedWorkflowSprintLeads: { total: 1 },
    },
    intakeQueue: {
      approvalReadyTotal: 1,
      discoveryReadyTotal: 3,
      primaryApprovalAction: {
        approvalToken: 'must-not-export-approval-token',
        draft: 'must-not-export outreach draft',
        checkoutUrl: 'https://example.com/private-checkout',
      },
      leads: [{ contact: { email: 'queue-must-not-export@example.com' } }],
    },
    customers: [{ email: 'customer-must-not-export@example.com' }],
    ...overrides,
  };
}

function stripeCatalogEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
    generatedAt: '2026-07-16T14:10:00.000Z',
    configured: true,
    verified: true,
    summary: {
      expectedOfferCount: 4,
      verifiedOfferCount: 4,
      priceDriftCount: 0,
      expectedPublicPaymentRailCount: 2,
      verifiedPublicPaymentRailCount: 2,
      paymentRailDriftCount: 0,
    },
    offers: [{ priceId: 'price_must_not_export', productId: 'prod_must_not_export' }],
    publicPaymentRails: [{ url: 'https://buy.stripe.com/must-not-export' }],
    ...overrides,
  };
}

function buildSnapshot() {
  return buildRevenueEvidenceSnapshot({
    target: targetEvidence(),
    remediation: remediationEvidence(),
    billing: billingEvidence(),
    stripeCatalog: stripeCatalogEvidence(),
    targetDigest: 'a'.repeat(64),
    remediationDigest: 'b'.repeat(64),
    billingDigest: 'c'.repeat(64),
    stripeCatalogDigest: 'd'.repeat(64),
    generatedAt: NOW,
  });
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-grafana-evidence-'));
}

test('snapshot exports aggregate proof fields without buyer identity or raw rows', () => {
  const snapshot = buildSnapshot();
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.event, 'revenue_evidence');
  assert.equal(snapshot.generatedAt, NOW);
  assert.equal(snapshot.targetStatus, 'evidence_incomplete');
  assert.equal(snapshot.firstExternalPayment, false);
  assert.equal(snapshot.firstExternalPaymentValue, 0);
  assert.equal(snapshot.verifiedPaid, 0);
  assert.equal(snapshot.bookedRevenueDollars, 0);
  assert.equal(snapshot.evidenceGapCount, 39);
  assert.equal(snapshot.sameDayEvidencePriority, 0);
  assert.equal(snapshot.sameDayReviewPriority, 2);
  assert.equal(snapshot.providerCoverageComplete, false);
  assert.equal(snapshot.productionHealthy, true);
  assert.equal(snapshot.expectedRevisionDeployed, false);
  assert.equal(snapshot.observedFunnelAvailable, true);
  assert.equal(snapshot.observedVisitors, 331);
  assert.equal(snapshot.observedPageViews, 479);
  assert.equal(snapshot.observedCtaClicks, 11);
  assert.equal(snapshot.observedCheckoutStarts, 2);
  assert.equal(snapshot.observedDiagnosticCheckoutStarts, 2);
  assert.equal(snapshot.observedIntakeCloseQueueAvailable, true);
  assert.equal(snapshot.observedIntakeCloseQueueAvailableValue, 1);
  assert.equal(snapshot.observedApprovalReadyIntakeCount, 1);
  assert.equal(snapshot.observedDiscoveryReadyIntakeCount, 3);
  assert.equal(snapshot.observedWorkflowSprintIntakeCount, 1);
  assert.equal(snapshot.observedCompleteWorkflowSprintIntakeCount, 1);
  assert.equal(snapshot.observedLifecycleQualifiedWorkflowSprintLeadCount, 0);
  assert.equal(snapshot.stripeCatalogAttached, true);
  assert.equal(snapshot.stripeCatalogVerified, true);
  assert.equal(snapshot.stripeCatalogVerifiedOfferCount, 4);
  assert.equal(snapshot.stripeCatalogPriceDriftCount, 0);
  assert.equal(snapshot.stripeCatalogVerifiedPublicPaymentRailCount, 2);
  assert.equal(snapshot.stripeCatalogPaymentRailDriftCount, 0);
  assert.equal(snapshot.claimBoundary, CLAIM_BOUNDARY);
  assert.doesNotMatch(serialized, /must.not.export|private company|leadId|contact|approvalToken|checkoutUrl|price_must|prod_must/i);
});

test('Stripe catalog source stays explicitly unattached when no audit is supplied', () => {
  const observed = buildStripeCatalogFields();

  assert.equal(observed.sourceGeneratedAt, null);
  assert.equal(observed.fields.stripeCatalogAttached, false);
  assert.equal(observed.fields.stripeCatalogVerified, false);
  assert.equal(observed.fields.stripeCatalogExpectedOfferCount, 0);
});

test('Stripe catalog source rejects inconsistent or incomplete aggregate proof', () => {
  const inconsistent = stripeCatalogEvidence();
  inconsistent.summary.priceDriftCount = 1;
  assert.throws(() => buildStripeCatalogFields(inconsistent), /does not reconcile/i);

  const missing = stripeCatalogEvidence();
  delete missing.summary.verifiedOfferCount;
  assert.throws(() => buildStripeCatalogFields(missing), /non-negative integer/i);

  const forgedVerdict = stripeCatalogEvidence({ verified: false });
  assert.throws(() => buildStripeCatalogFields(forgedVerdict), /verdict does not reconcile/i);
});

test('hosted funnel distinguishes an unavailable reviewed-intake close queue from zero ready actions', () => {
  const withoutQueue = billingEvidence();
  delete withoutQueue.intakeQueue;

  const observed = buildObservedFunnelFields(withoutQueue);

  assert.equal(observed.fields.observedFunnelAvailable, true);
  assert.equal(observed.fields.observedIntakeCloseQueueAvailable, false);
  assert.equal(observed.fields.observedIntakeCloseQueueAvailableValue, 0);
  assert.equal(observed.fields.observedApprovalReadyIntakeCount, 0);
  assert.equal(observed.fields.observedDiscoveryReadyIntakeCount, 0);
});

test('hosted funnel treats lifecycle status as qualification and never form completeness alone', () => {
  const legacy = buildObservedFunnelFields(billingEvidence());
  assert.equal(legacy.fields.observedCompleteWorkflowSprintIntakeCount, 1);
  assert.equal(legacy.fields.observedLifecycleQualifiedWorkflowSprintLeadCount, 0);

  const reviewed = billingEvidence();
  reviewed.pipeline.completeWorkflowSprintIntakes = { total: 1 };
  reviewed.pipeline.workflowSprintLeads.byStatus = { qualified: 1 };
  reviewed.pipeline.qualifiedWorkflowSprintLeads = { total: 1 };
  const qualified = buildObservedFunnelFields(reviewed);
  assert.equal(qualified.fields.observedCompleteWorkflowSprintIntakeCount, 1);
  assert.equal(qualified.fields.observedLifecycleQualifiedWorkflowSprintLeadCount, 1);
});

test('hosted funnel never exposes a diagnostic subset larger than total checkout starts', () => {
  const inconsistent = billingEvidence();
  inconsistent.trafficMetrics.checkoutStarts = 0;
  inconsistent.ctas.checkoutStarts = 0;
  inconsistent.ctas.diagnosticCheckoutStarts = 2;

  const observed = buildObservedFunnelFields(inconsistent);

  assert.equal(observed.fields.observedDiagnosticCheckoutStarts, 2);
  assert.equal(observed.fields.observedCheckoutStarts, 2);
});

test('snapshot normalizes positive revenue without promoting unsupported claims', () => {
  const target = targetEvidence({
    status: 'below_target',
    milestones: {
      firstExternalPayment: { achieved: true, verifiedIndividualPaymentCount: 1 },
      sameDayExternalPayment: { achieved: true, verifiedIndividualPaymentCount: 1 },
      targetWithCurrentControlDeployed: { achieved: false },
    },
  });
  target.evidence.pipeline.verifiedPaid = 1;
  target.evidence.pipeline.bookedRevenueCents = 49900;
  const snapshot = buildRevenueEvidenceSnapshot({
    target,
    remediation: remediationEvidence(),
    generatedAt: NOW,
  });

  assert.equal(snapshot.firstExternalPaymentValue, 1);
  assert.equal(snapshot.sameDayExternalPaymentValue, 1);
  assert.equal(snapshot.verifiedIndividualPaymentCount, 1);
  assert.equal(snapshot.bookedRevenueDollars, 499);
  assert.equal(snapshot.targetAchievedValue, 0);
});

test('snapshot drops untrusted free-text status and revision strings', () => {
  const target = targetEvidence({ status: 'buyer@example.com' });
  target.evidence.deployment.expectedSha = 'private@example.com';
  target.evidence.deployment.deployedSha = 'company-secret';
  const snapshot = buildRevenueEvidenceSnapshot({
    target,
    remediation: remediationEvidence(),
    generatedAt: NOW,
  });
  assert.equal(snapshot.targetStatus, 'unknown');
  assert.equal(snapshot.expectedSha, null);
  assert.equal(snapshot.deployedSha, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /buyer@example|private@example|company-secret/);
});

test('snapshot fails closed on missing evidence envelopes or timestamps', () => {
  assert.throws(() => buildRevenueEvidenceSnapshot({
    target: {},
    remediation: remediationEvidence(),
    generatedAt: NOW,
  }), /missing pipeline, deployment, or provider coverage/);
  assert.throws(() => buildRevenueEvidenceSnapshot({
    target: targetEvidence(),
    remediation: {},
    generatedAt: NOW,
  }), /missing summary/);
  assert.throws(() => buildRevenueEvidenceSnapshot({
    target: targetEvidence({ generatedAt: 'not-a-date' }),
    remediation: remediationEvidence(),
    generatedAt: NOW,
  }), /target.generatedAt must be a valid timestamp/);
});

test('Loki payload contains one aggregate JSON line with deterministic labels and timestamp', () => {
  const snapshot = buildSnapshot();
  const payload = buildLokiPayload(snapshot);
  const stream = payload.streams[0];
  const [timestampNs, line] = stream.values[0];

  assert.deepEqual(stream.stream, {
    service_name: 'thumbgate',
    event: 'revenue_evidence',
    environment: 'production',
    schema_version: '1',
  });
  assert.equal(timestampNs, String(BigInt(Date.parse(NOW)) * 1000000n));
  assert.deepEqual(JSON.parse(line), snapshot);
});

test('Loki payload allowlist rejects extra snapshot fields before send', () => {
  const snapshot = buildSnapshot();
  snapshot.privateBuyerEmail = 'must-not-send@example.com';
  assert.throws(() => validateRevenueEvidenceSnapshot(snapshot), /non-aggregate fields/);

  const payload = buildLokiPayload(buildSnapshot());
  const line = JSON.parse(payload.streams[0].values[0][1]);
  line.rawRows = [{ email: 'must-not-send@example.com' }];
  payload.streams[0].values[0][1] = JSON.stringify(line);
  assert.throws(() => validateRevenueEvidenceLokiPayload(payload), /non-aggregate fields/);
});

test('snapshot validation rejects an impossible diagnostic checkout subset', () => {
  const snapshot = buildSnapshot();
  snapshot.observedCheckoutStarts = 1;
  snapshot.observedDiagnosticCheckoutStarts = 2;

  assert.throws(
    () => validateRevenueEvidenceSnapshot(snapshot),
    /diagnostic checkout starts must be a subset/
  );
});

test('Loki endpoint allowlist rejects non-Grafana, HTTP, query, and wrong paths', () => {
  assert.equal(
    validateLokiEndpoint('https://logs-prod-001.grafana.net/loki/api/v1/push').hostname,
    'logs-prod-001.grafana.net'
  );
  assert.throws(() => validateLokiEndpoint('http://logs-prod-001.grafana.net/loki/api/v1/push'), /must use HTTPS/);
  assert.throws(() => validateLokiEndpoint('https://grafana.net.evil.example/loki/api/v1/push'), /must be grafana.net/);
  assert.throws(() => validateLokiEndpoint('https://logs-prod-001.grafana.net/api/admin'), /must end with/);
  assert.throws(() => validateLokiEndpoint('https://user:secret@logs-prod-001.grafana.net/loki/api/v1/push'), /must not contain credentials/);
  assert.throws(() => validateLokiEndpoint('https://logs-prod-001.grafana.net/loki/api/v1/push?token=secret'), /must not contain credentials/);
  assert.throws(() => validateLokiEndpoint('https://logs-prod-001.grafana.net:8443/loki/api/v1/push'), /default HTTPS port/);
});

test('sender posts only to the allowlisted endpoint and returns no credential material', async () => {
  const payload = buildLokiPayload(buildSnapshot());
  let request = null;
  const delivery = await sendLokiPayload(payload, {
    endpoint: 'https://logs-prod-001.grafana.net/loki/api/v1/push',
    userId: '123456',
    token: 'secret-access-policy-token',
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return { ok: true, status: 204 };
    },
  });

  assert.equal(request.url, 'https://logs-prod-001.grafana.net/loki/api/v1/push');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['content-type'], 'application/json');
  assert.match(request.init.headers.authorization, /^Basic /);
  assert.equal(request.init.redirect, 'error');
  assert.equal(JSON.stringify(delivery).includes('secret-access-policy-token'), false);
  assert.deepEqual(delivery.sent, true);
  assert.equal(delivery.httpStatus, 204);
});

test('sender reports status only when Grafana rejects the payload', async () => {
  await assert.rejects(() => sendLokiPayload(buildLokiPayload(buildSnapshot()), {
    endpoint: 'https://logs-prod-001.grafana.net/loki/api/v1/push',
    userId: '123456',
    token: 'secret-access-policy-token',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }), /HTTP 429/);
});

test('sender rejects ambiguous Basic Auth user IDs before network access', async () => {
  let networkCalled = false;
  await assert.rejects(() => sendLokiPayload(buildLokiPayload(buildSnapshot()), {
    endpoint: 'https://logs-prod-001.grafana.net/loki/api/v1/push',
    userId: '123:456',
    token: 'secret-access-policy-token',
    fetchImpl: async () => {
      networkCalled = true;
      return { ok: true, status: 204 };
    },
  }), /must not contain a colon/);
  assert.equal(networkCalled, false);
});

test('dashboard is importable, datasource-neutral, and queries only aggregate fields', () => {
  const dashboard = buildGrafanaDashboard();
  const serialized = JSON.stringify(dashboard);

  assert.equal(dashboard.uid, 'thumbgate-revenue-evidence');
  assert.equal(dashboard.schemaVersion, 41);
  assert.equal(dashboard.refresh, '5m');
  assert.equal(dashboard.panels.filter((panel) => panel.type === 'stat').length, 27);
  assert.ok(dashboard.panels.some((panel) => panel.title === 'Stripe catalog verified'));
  assert.ok(dashboard.panels.some((panel) => panel.title === 'Stripe payment-rail drift'));
  assert.ok(dashboard.panels.some((panel) => panel.type === 'logs'));
  assert.ok(dashboard.panels.some((panel) => panel.type === 'text' && panel.options.content.includes(CLAIM_BOUNDARY)));
  assert.match(serialized, /\$\{DS_LOKI\}/);
  assert.match(serialized, /firstExternalPaymentValue/);
  assert.match(serialized, /sameDayEvidencePriority/);
  assert.match(serialized, /observedLifecycleQualifiedWorkflowSprintLeadCount/);
  assert.match(serialized, /observedDiagnosticCheckoutStarts/);
  assert.match(serialized, /observedIntakeCloseQueueAvailableValue/);
  assert.match(serialized, /observedApprovalReadyIntakeCount/);
  assert.match(serialized, /observedDiscoveryReadyIntakeCount/);
  assert.doesNotMatch(serialized, /observedDiagnosticCheckoutClicks/);
  assert.doesNotMatch(serialized, /buyerEmail|leadId|contact|approvalToken|checkoutUrl/);
});

test('CLI dry-run writes snapshot and dashboard artifacts without network access', async () => {
  const tempDir = makeTempDir();
  const targetPath = path.join(tempDir, 'target.json');
  const remediationPath = path.join(tempDir, 'remediation.json');
  const billingPath = path.join(tempDir, 'billing.json');
  const stripeCatalogPath = path.join(tempDir, 'stripe-catalog.json');
  const payloadPath = path.join(tempDir, 'payload.json');
  const dashboardPath = path.join(tempDir, 'dashboard.json');
  fs.writeFileSync(targetPath, JSON.stringify(targetEvidence()), 'utf8');
  fs.writeFileSync(remediationPath, JSON.stringify(remediationEvidence()), 'utf8');
  fs.writeFileSync(billingPath, JSON.stringify(billingEvidence()), 'utf8');
  fs.writeFileSync(stripeCatalogPath, JSON.stringify(stripeCatalogEvidence()), 'utf8');
  let networkCalled = false;

  const prepared = await runCli([
    '--target', targetPath,
    '--remediation', remediationPath,
    '--billing', billingPath,
    '--stripe-catalog', stripeCatalogPath,
    '--now', NOW,
    '--out', payloadPath,
  ], {
    env: {},
    fetchImpl: async () => {
      networkCalled = true;
      throw new Error('network must not be called');
    },
  });
  const dashboard = await runCli(['--dashboard', '--out', dashboardPath], { env: {} });

  assert.equal(prepared.status, 'prepared_not_sent');
  assert.equal(dashboard.status, 'dashboard_prepared_not_published');
  assert.equal(networkCalled, false);
  assert.equal(fs.existsSync(payloadPath), true);
  assert.equal(fs.existsSync(dashboardPath), true);
  const written = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  assert.equal(written.snapshot.evidenceGapCount, 39);
  assert.equal(written.snapshot.observedVisitors, 331);
  assert.equal(written.snapshot.stripeCatalogVerified, true);
  assert.match(written.snapshot.sourceDigests.stripeCatalogSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(written), /must.not.export|private company/i);
  assert.equal(JSON.parse(fs.readFileSync(dashboardPath, 'utf8')).uid, 'thumbgate-revenue-evidence');
});

test('CLI send requires an explicit zero-spend confirmation flag in the environment', async () => {
  const tempDir = makeTempDir();
  const targetPath = path.join(tempDir, 'target.json');
  const remediationPath = path.join(tempDir, 'remediation.json');
  fs.writeFileSync(targetPath, JSON.stringify(targetEvidence()), 'utf8');
  fs.writeFileSync(remediationPath, JSON.stringify(remediationEvidence()), 'utf8');

  await assert.rejects(() => runCli([
    '--target', targetPath,
    '--remediation', remediationPath,
    '--now', NOW,
    '--send',
  ], {
    env: {
      THUMBGATE_GRAFANA_LOKI_URL: 'https://logs-prod-001.grafana.net/loki/api/v1/push',
      THUMBGATE_GRAFANA_LOKI_USER_ID: '123456',
      THUMBGATE_GRAFANA_LOKI_TOKEN: 'secret',
    },
    fetchImpl: async () => ({ ok: true, status: 204 }),
  }), /THUMBGATE_GRAFANA_ZERO_SPEND_CONFIRMED=1/);
});

test('argument parser keeps send and dashboard modes explicit', () => {
  assert.deepEqual(parseArgs(['--dashboard', '--out=dashboard.json']), {
    send: false,
    dashboard: true,
    out: 'dashboard.json',
  });
  assert.deepEqual(parseArgs(['--send', '--target', 'target.json']), {
    send: true,
    dashboard: false,
    target: 'target.json',
  });
  assert.equal(parseArgs(['--stripe-catalog', 'catalog.json']).stripeCatalog, 'catalog.json');
});
