#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { ensureParentDir } = require('./fs-utils');

const SCHEMA_VERSION = 1;
const DEFAULT_DASHBOARD_UID = 'thumbgate-revenue-evidence';
const CLAIM_BOUNDARY = 'Aggregate operational evidence only. A dashboard row does not prove a payment, customer, revenue, or target outcome beyond the provider-verified source snapshot.';
const LOKI_HOST_PATTERN = /(^|\.)grafana\.net$/i;
const LOKI_PUSH_PATH = '/loki/api/v1/push';
const SNAPSHOT_KEYS = new Set([
  'approvalReady', 'bookedRevenueCents', 'bookedRevenueDollars',
  'claimBoundary', 'deployedSha', 'event', 'evidenceGapCount',
  'expectedRevisionDeployed', 'expectedRevisionDeployedValue', 'expectedSha',
  'firstExternalPayment', 'firstExternalPaymentValue', 'generatedAt',
  'internalReady', 'observedCheckoutStarts',
  'observedCompleteWorkflowSprintIntakeCount', 'observedCtaClicks',
  'observedDiagnosticCheckoutStarts', 'observedFunnelAvailable',
  'observedFunnelAvailableValue',
  'observedIntakeCloseQueueAvailable', 'observedIntakeCloseQueueAvailableValue',
  'observedApprovalReadyIntakeCount',
  'observedDiscoveryReadyIntakeCount',
  'observedLifecycleQualifiedWorkflowSprintLeadCount', 'observedPageViews',
  'observedVisitors', 'observedWorkflowIntakeClicks',
  'observedWorkflowSprintIntakeCount', 'pipelineTotal', 'productionHealthy',
  'productionHealthyValue', 'providerCoverageComplete',
  'providerCoverageCompleteValue', 'sameDayEvidencePriority',
  'sameDayExternalPayment', 'sameDayExternalPaymentValue',
  'sameDayReviewPriority', 'schemaVersion', 'sourceDigests',
  'sourceGeneratedAt', 'targetAchieved', 'targetAchievedValue', 'targetStatus',
  'stripeCatalogAttached', 'stripeCatalogAttachedValue',
  'stripeCatalogExpectedOfferCount', 'stripeCatalogExpectedPublicPaymentRailCount',
  'stripeCatalogPaymentRailDriftCount', 'stripeCatalogPriceDriftCount',
  'stripeCatalogVerified', 'stripeCatalogVerifiedOfferCount',
  'stripeCatalogVerifiedPublicPaymentRailCount', 'stripeCatalogVerifiedValue',
  'stripeCatalogVersion',
  'verifiedIndividualPaymentCount', 'verifiedPaid',
]);
const SOURCE_GENERATED_AT_KEYS = new Set(['billing', 'remediation', 'stripeCatalog', 'target']);
const SOURCE_DIGEST_KEYS = new Set(['billingSha256', 'remediationSha256', 'stripeCatalogSha256', 'targetSha256']);

function normalizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeSafeToken(value, maxLength = 80) {
  const normalized = normalizeText(value, maxLength);
  return normalized && /^[a-z0-9][a-z0-9_.-]*$/i.test(normalized) ? normalized : null;
}

function normalizeSha256(value) {
  const normalized = normalizeText(value, 64)?.toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeGitRevision(value) {
  const normalized = normalizeText(value, 64)?.toLowerCase();
  return normalized && /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

function parseTimestamp(value, label) {
  const normalized = normalizeText(value, 64);
  const parsed = Date.parse(normalized || '');
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function booleanValue(value) {
  return value === true;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJsonFile(filePath, label) {
  if (!filePath) throw new Error(`${label} path is required.`);
  const resolved = path.resolve(filePath);
  let source;
  try {
    source = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
  try {
    return {
      path: resolved,
      source,
      digest: sha256(source),
      value: JSON.parse(source),
    };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function buildObservedFunnelFields(billing) {
  if (billing === undefined || billing === null) {
    return {
      sourceGeneratedAt: null,
      fields: {
        observedFunnelAvailable: false,
        observedFunnelAvailableValue: 0,
        observedVisitors: 0,
        observedPageViews: 0,
        observedCtaClicks: 0,
        observedCheckoutStarts: 0,
        observedDiagnosticCheckoutStarts: 0,
        observedIntakeCloseQueueAvailable: false,
        observedIntakeCloseQueueAvailableValue: 0,
        observedApprovalReadyIntakeCount: 0,
        observedDiscoveryReadyIntakeCount: 0,
        observedWorkflowIntakeClicks: 0,
        observedWorkflowSprintIntakeCount: 0,
        observedCompleteWorkflowSprintIntakeCount: 0,
        observedLifecycleQualifiedWorkflowSprintLeadCount: 0,
      },
    };
  }
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) {
    throw new Error('Hosted billing evidence must be a JSON object.');
  }
  const traffic = billing.trafficMetrics || {};
  const ctas = billing.ctas || {};
  const pipeline = billing.pipeline || {};
  const sprint = pipeline.workflowSprintLeads || {};
  const byStatus = sprint.byStatus || {};
  const lifecycleQualifiedCount = [
    'qualified',
    'named_pilot',
    'proof_backed_run',
    'paid_team',
  ].reduce((total, status) => total + nonNegativeInteger(byStatus[status]), 0);
  const explicitCompleteCount = pipeline.completeWorkflowSprintIntakes?.total;
  // Older production summaries used qualifiedWorkflowSprintLeads for form
  // completeness. It is safe only as a completeness fallback, never as proof
  // that an operator qualified the lead.
  const completeCount = explicitCompleteCount === undefined
    ? pipeline.qualifiedWorkflowSprintLeads?.total
    : explicitCompleteCount;
  const diagnosticCheckoutStarts = nonNegativeInteger(ctas.diagnosticCheckoutStarts);
  const intakeCloseQueueAvailable = Boolean(
    billing.intakeQueue
    && typeof billing.intakeQueue === 'object'
    && !Array.isArray(billing.intakeQueue)
  );
  const checkoutStarts = Math.max(
    nonNegativeInteger(traffic.checkoutStarts ?? ctas.checkoutStarts),
    diagnosticCheckoutStarts
  );
  return {
    sourceGeneratedAt: parseTimestamp(billing.generatedAt, 'billing.generatedAt'),
    fields: {
      observedFunnelAvailable: true,
      observedFunnelAvailableValue: 1,
      observedVisitors: nonNegativeInteger(traffic.visitors),
      observedPageViews: nonNegativeInteger(traffic.pageViews),
      observedCtaClicks: nonNegativeInteger(traffic.ctaClicks ?? ctas.totalClicks),
      observedCheckoutStarts: checkoutStarts,
      observedDiagnosticCheckoutStarts: diagnosticCheckoutStarts,
      observedIntakeCloseQueueAvailable: intakeCloseQueueAvailable,
      observedIntakeCloseQueueAvailableValue: intakeCloseQueueAvailable ? 1 : 0,
      observedApprovalReadyIntakeCount: intakeCloseQueueAvailable
        ? nonNegativeInteger(billing.intakeQueue.approvalReadyTotal)
        : 0,
      observedDiscoveryReadyIntakeCount: intakeCloseQueueAvailable
        ? nonNegativeInteger(billing.intakeQueue.discoveryReadyTotal)
        : 0,
      observedWorkflowIntakeClicks: nonNegativeInteger(ctas.workflowIntakeClicks),
      observedWorkflowSprintIntakeCount: nonNegativeInteger(sprint.total),
      observedCompleteWorkflowSprintIntakeCount: nonNegativeInteger(completeCount),
      observedLifecycleQualifiedWorkflowSprintLeadCount: lifecycleQualifiedCount,
    },
  };
}

function buildStripeCatalogFields(catalogAudit) {
  if (catalogAudit === undefined || catalogAudit === null) {
    return {
      sourceGeneratedAt: null,
      fields: {
        stripeCatalogAttached: false,
        stripeCatalogAttachedValue: 0,
        stripeCatalogVerified: false,
        stripeCatalogVerifiedValue: 0,
        stripeCatalogVersion: null,
        stripeCatalogExpectedOfferCount: 0,
        stripeCatalogVerifiedOfferCount: 0,
        stripeCatalogPriceDriftCount: 0,
        stripeCatalogExpectedPublicPaymentRailCount: 0,
        stripeCatalogVerifiedPublicPaymentRailCount: 0,
        stripeCatalogPaymentRailDriftCount: 0,
      },
    };
  }
  if (!catalogAudit || typeof catalogAudit !== 'object' || Array.isArray(catalogAudit)) {
    throw new Error('Stripe catalog audit must be a JSON object.');
  }
  if (catalogAudit.schemaVersion !== 1 || typeof catalogAudit.verified !== 'boolean') {
    throw new Error('Stripe catalog audit is missing its schema version or verification verdict.');
  }
  const summary = catalogAudit.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('Stripe catalog audit is missing its aggregate summary.');
  }
  for (const key of [
    'expectedOfferCount', 'verifiedOfferCount', 'priceDriftCount',
    'expectedPublicPaymentRailCount', 'verifiedPublicPaymentRailCount',
    'paymentRailDriftCount',
  ]) {
    if (!Number.isSafeInteger(summary[key]) || summary[key] < 0) {
      throw new Error(`Stripe catalog audit summary.${key} must be a non-negative integer.`);
    }
  }
  const expectedOfferCount = nonNegativeInteger(summary.expectedOfferCount);
  const verifiedOfferCount = nonNegativeInteger(summary.verifiedOfferCount);
  const priceDriftCount = nonNegativeInteger(summary.priceDriftCount);
  const expectedPublicPaymentRailCount = nonNegativeInteger(summary.expectedPublicPaymentRailCount);
  const verifiedPublicPaymentRailCount = nonNegativeInteger(summary.verifiedPublicPaymentRailCount);
  const paymentRailDriftCount = nonNegativeInteger(summary.paymentRailDriftCount);
  if (verifiedOfferCount > expectedOfferCount
    || priceDriftCount !== expectedOfferCount - verifiedOfferCount
    || verifiedPublicPaymentRailCount > expectedPublicPaymentRailCount
    || paymentRailDriftCount !== expectedPublicPaymentRailCount - verifiedPublicPaymentRailCount) {
    throw new Error('Stripe catalog audit summary does not reconcile expected, verified, and drift counts.');
  }
  const computedVerified = expectedOfferCount > 0
    && expectedPublicPaymentRailCount > 0
    && priceDriftCount === 0
    && paymentRailDriftCount === 0;
  if (catalogAudit.verified !== computedVerified) {
    throw new Error('Stripe catalog audit verdict does not reconcile with its aggregate drift counts.');
  }
  const catalogVersion = normalizeSafeToken(catalogAudit.catalogVersion, 80);
  if (!catalogVersion) throw new Error('Stripe catalog audit requires a safe catalog version.');
  return {
    sourceGeneratedAt: parseTimestamp(catalogAudit.generatedAt, 'stripeCatalog.generatedAt'),
    fields: {
      stripeCatalogAttached: true,
      stripeCatalogAttachedValue: 1,
      stripeCatalogVerified: catalogAudit.verified,
      stripeCatalogVerifiedValue: catalogAudit.verified ? 1 : 0,
      stripeCatalogVersion: catalogVersion,
      stripeCatalogExpectedOfferCount: expectedOfferCount,
      stripeCatalogVerifiedOfferCount: verifiedOfferCount,
      stripeCatalogPriceDriftCount: priceDriftCount,
      stripeCatalogExpectedPublicPaymentRailCount: expectedPublicPaymentRailCount,
      stripeCatalogVerifiedPublicPaymentRailCount: verifiedPublicPaymentRailCount,
      stripeCatalogPaymentRailDriftCount: paymentRailDriftCount,
    },
  };
}

function buildRevenueEvidenceSnapshot({
  target,
  remediation,
  billing,
  stripeCatalog,
  targetDigest,
  remediationDigest,
  billingDigest,
  stripeCatalogDigest,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('Target-control evidence must be a JSON object.');
  }
  if (!remediation || typeof remediation !== 'object' || Array.isArray(remediation)) {
    throw new Error('Remediation evidence must be a JSON object.');
  }
  if (!target.evidence?.pipeline || !target.evidence?.deployment || !target.evidence?.providerCoverage) {
    throw new Error('Target-control evidence is missing pipeline, deployment, or provider coverage.');
  }
  if (!remediation.summary || typeof remediation.summary !== 'object') {
    throw new Error('Remediation evidence is missing summary.');
  }

  const snapshotGeneratedAt = parseTimestamp(generatedAt, 'generatedAt');
  const targetGeneratedAt = parseTimestamp(target.generatedAt, 'target.generatedAt');
  const remediationGeneratedAt = parseTimestamp(remediation.generatedAt, 'remediation.generatedAt');
  const pipeline = target.evidence.pipeline;
  const deployment = target.evidence.deployment;
  const providerCoverage = target.evidence.providerCoverage;
  const firstPayment = target.milestones?.firstExternalPayment;
  const sameDayPayment = target.milestones?.sameDayExternalPayment;
  const targetMilestone = target.milestones?.targetWithCurrentControlDeployed;
  const summary = remediation.summary;
  const bookedRevenueCents = nonNegativeInteger(pipeline.bookedRevenueCents);
  const observedFunnel = buildObservedFunnelFields(billing);
  const observedStripeCatalog = buildStripeCatalogFields(stripeCatalog);

  return {
    schemaVersion: SCHEMA_VERSION,
    event: 'revenue_evidence',
    generatedAt: snapshotGeneratedAt,
    sourceGeneratedAt: {
      target: targetGeneratedAt,
      remediation: remediationGeneratedAt,
      billing: observedFunnel.sourceGeneratedAt,
      stripeCatalog: observedStripeCatalog.sourceGeneratedAt,
    },
    sourceDigests: {
      targetSha256: normalizeSha256(targetDigest),
      remediationSha256: normalizeSha256(remediationDigest),
      billingSha256: normalizeSha256(billingDigest),
      stripeCatalogSha256: normalizeSha256(stripeCatalogDigest),
    },
    claimBoundary: CLAIM_BOUNDARY,
    targetStatus: normalizeSafeToken(target.status, 80) || 'unknown',
    targetAchieved: booleanValue(targetMilestone?.achieved),
    targetAchievedValue: booleanValue(targetMilestone?.achieved) ? 1 : 0,
    firstExternalPayment: booleanValue(firstPayment?.achieved),
    firstExternalPaymentValue: booleanValue(firstPayment?.achieved) ? 1 : 0,
    sameDayExternalPayment: booleanValue(sameDayPayment?.achieved),
    sameDayExternalPaymentValue: booleanValue(sameDayPayment?.achieved) ? 1 : 0,
    verifiedIndividualPaymentCount: nonNegativeInteger(firstPayment?.verifiedIndividualPaymentCount),
    verifiedPaid: nonNegativeInteger(pipeline.verifiedPaid),
    bookedRevenueCents,
    bookedRevenueDollars: bookedRevenueCents / 100,
    pipelineTotal: nonNegativeInteger(pipeline.total),
    evidenceGapCount: nonNegativeInteger(pipeline.evidenceGapCount),
    sameDayEvidencePriority: nonNegativeInteger(summary.sameDayEvidencePriority),
    sameDayReviewPriority: nonNegativeInteger(summary.sameDayReviewPriority),
    approvalReady: nonNegativeInteger(summary.approvalReady),
    internalReady: nonNegativeInteger(summary.internalReady),
    providerCoverageComplete: booleanValue(providerCoverage.completeForGlobalClaim),
    providerCoverageCompleteValue: booleanValue(providerCoverage.completeForGlobalClaim) ? 1 : 0,
    productionHealthy: booleanValue(deployment.healthy),
    productionHealthyValue: booleanValue(deployment.healthy) ? 1 : 0,
    expectedRevisionDeployed: booleanValue(deployment.expectedRevisionDeployed),
    expectedRevisionDeployedValue: booleanValue(deployment.expectedRevisionDeployed) ? 1 : 0,
    expectedSha: normalizeGitRevision(deployment.expectedSha),
    deployedSha: normalizeGitRevision(deployment.deployedSha),
    ...observedFunnel.fields,
    ...observedStripeCatalog.fields,
  };
}

function validateRevenueEvidenceSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION || snapshot.event !== 'revenue_evidence') {
    throw new Error('A valid revenue evidence snapshot is required.');
  }
  const unknownKeys = Object.keys(snapshot).filter((key) => !SNAPSHOT_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`Revenue evidence snapshot contains non-aggregate fields: ${unknownKeys.join(', ')}.`);
  }
  if (snapshot.claimBoundary !== CLAIM_BOUNDARY) {
    throw new Error('Revenue evidence snapshot must retain the fixed claim boundary.');
  }
  parseTimestamp(snapshot.generatedAt, 'snapshot.generatedAt');
  if (snapshot.targetStatus !== normalizeSafeToken(snapshot.targetStatus, 80)) {
    throw new Error('Revenue evidence snapshot targetStatus must be a safe token.');
  }
  for (const [label, value] of [
    ['expectedSha', snapshot.expectedSha],
    ['deployedSha', snapshot.deployedSha],
  ]) {
    if (value !== null && value !== normalizeGitRevision(value)) {
      throw new Error(`Revenue evidence snapshot ${label} must be a Git revision or null.`);
    }
  }
  for (const key of [
    'expectedRevisionDeployed', 'firstExternalPayment', 'observedFunnelAvailable',
    'observedIntakeCloseQueueAvailable',
    'productionHealthy', 'providerCoverageComplete', 'sameDayExternalPayment',
    'stripeCatalogAttached', 'stripeCatalogVerified', 'targetAchieved',
  ]) {
    if (typeof snapshot[key] !== 'boolean') {
      throw new Error(`Revenue evidence snapshot ${key} must be boolean.`);
    }
  }
  for (const key of [
    'approvalReady', 'bookedRevenueCents', 'bookedRevenueDollars',
    'evidenceGapCount', 'expectedRevisionDeployedValue',
    'firstExternalPaymentValue', 'internalReady', 'observedCheckoutStarts',
    'observedApprovalReadyIntakeCount',
    'observedDiscoveryReadyIntakeCount',
    'observedCompleteWorkflowSprintIntakeCount', 'observedCtaClicks',
    'observedDiagnosticCheckoutStarts', 'observedFunnelAvailableValue',
    'observedIntakeCloseQueueAvailableValue',
    'observedLifecycleQualifiedWorkflowSprintLeadCount', 'observedPageViews',
    'observedVisitors', 'observedWorkflowIntakeClicks',
    'observedWorkflowSprintIntakeCount', 'pipelineTotal',
    'productionHealthyValue', 'providerCoverageCompleteValue',
    'sameDayEvidencePriority', 'sameDayExternalPaymentValue',
    'sameDayReviewPriority', 'stripeCatalogAttachedValue',
    'stripeCatalogExpectedOfferCount', 'stripeCatalogExpectedPublicPaymentRailCount',
    'stripeCatalogPaymentRailDriftCount', 'stripeCatalogPriceDriftCount',
    'stripeCatalogVerifiedOfferCount', 'stripeCatalogVerifiedPublicPaymentRailCount',
    'stripeCatalogVerifiedValue', 'targetAchievedValue',
    'verifiedIndividualPaymentCount', 'verifiedPaid',
  ]) {
    if (!Number.isFinite(snapshot[key]) || snapshot[key] < 0) {
      throw new Error(`Revenue evidence snapshot ${key} must be a non-negative number.`);
    }
  }
  if (snapshot.observedDiagnosticCheckoutStarts > snapshot.observedCheckoutStarts) {
    throw new Error('Revenue evidence snapshot diagnostic checkout starts must be a subset of checkout starts.');
  }
  if (snapshot.stripeCatalogVersion !== null
    && snapshot.stripeCatalogVersion !== normalizeSafeToken(snapshot.stripeCatalogVersion, 80)) {
    throw new Error('Revenue evidence snapshot stripeCatalogVersion must be a safe token or null.');
  }
  if (snapshot.stripeCatalogVerifiedOfferCount > snapshot.stripeCatalogExpectedOfferCount
    || snapshot.stripeCatalogPriceDriftCount
      !== snapshot.stripeCatalogExpectedOfferCount - snapshot.stripeCatalogVerifiedOfferCount
    || snapshot.stripeCatalogVerifiedPublicPaymentRailCount > snapshot.stripeCatalogExpectedPublicPaymentRailCount
    || snapshot.stripeCatalogPaymentRailDriftCount
      !== snapshot.stripeCatalogExpectedPublicPaymentRailCount - snapshot.stripeCatalogVerifiedPublicPaymentRailCount) {
    throw new Error('Revenue evidence snapshot Stripe catalog counts do not reconcile.');
  }
  if (snapshot.stripeCatalogVerified
    !== (snapshot.stripeCatalogAttached
      && snapshot.stripeCatalogExpectedOfferCount > 0
      && snapshot.stripeCatalogExpectedPublicPaymentRailCount > 0
      && snapshot.stripeCatalogPriceDriftCount === 0
      && snapshot.stripeCatalogPaymentRailDriftCount === 0)) {
    throw new Error('Revenue evidence snapshot Stripe catalog verdict does not reconcile.');
  }
  for (const [label, value, allowed] of [
    ['sourceGeneratedAt', snapshot.sourceGeneratedAt, SOURCE_GENERATED_AT_KEYS],
    ['sourceDigests', snapshot.sourceDigests, SOURCE_DIGEST_KEYS],
  ]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Revenue evidence snapshot ${label} must be an object.`);
    }
    const unknownNestedKeys = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknownNestedKeys.length) {
      throw new Error(`Revenue evidence snapshot ${label} contains non-aggregate fields: ${unknownNestedKeys.join(', ')}.`);
    }
  }
  for (const [key, value] of Object.entries(snapshot.sourceGeneratedAt)) {
    if (value !== null) parseTimestamp(value, `snapshot.sourceGeneratedAt.${key}`);
  }
  for (const [key, value] of Object.entries(snapshot.sourceDigests)) {
    if (value !== null && value !== normalizeSha256(value)) {
      throw new Error(`Revenue evidence snapshot sourceDigests.${key} must be SHA-256 or null.`);
    }
  }
  return snapshot;
}

function buildLokiPayload(snapshot, { timestamp = snapshot?.generatedAt } = {}) {
  validateRevenueEvidenceSnapshot(snapshot);
  const timestampIso = parseTimestamp(timestamp, 'Loki timestamp');
  const timestampNs = String(BigInt(Date.parse(timestampIso)) * 1000000n);
  return {
    streams: [{
      stream: {
        service_name: 'thumbgate',
        event: 'revenue_evidence',
        environment: 'production',
        schema_version: String(SCHEMA_VERSION),
      },
      values: [[timestampNs, JSON.stringify(snapshot)]],
    }],
  };
}

function validateRevenueEvidenceLokiPayload(payload) {
  if (!payload || !Array.isArray(payload.streams) || payload.streams.length !== 1) {
    throw new Error('Grafana payload must contain exactly one revenue evidence stream.');
  }
  const stream = payload.streams[0];
  if (stream?.stream?.service_name !== 'thumbgate' || stream?.stream?.event !== 'revenue_evidence') {
    throw new Error('Grafana payload must use the fixed ThumbGate revenue evidence labels.');
  }
  if (!Array.isArray(stream.values) || stream.values.length !== 1 || !Array.isArray(stream.values[0])) {
    throw new Error('Grafana payload must contain exactly one revenue evidence log line.');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(stream.values[0][1]);
  } catch {
    throw new Error('Grafana payload revenue evidence log line must be valid JSON.');
  }
  validateRevenueEvidenceSnapshot(snapshot);
  return payload;
}

function validateLokiEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('Grafana Loki URL must be an absolute HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Grafana Loki URL must use HTTPS.');
  if (parsed.port && parsed.port !== '443') throw new Error('Grafana Loki URL must use the default HTTPS port.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Grafana Loki URL must not contain credentials, query parameters, or fragments.');
  }
  if (!LOKI_HOST_PATTERN.test(parsed.hostname)) {
    throw new Error('Grafana Loki host must be grafana.net or one of its subdomains.');
  }
  if (parsed.pathname.replace(/\/+$/, '') !== LOKI_PUSH_PATH) {
    throw new Error(`Grafana Loki URL must end with ${LOKI_PUSH_PATH}.`);
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed;
}

async function sendLokiPayload(payload, {
  endpoint,
  userId,
  token,
  fetchImpl = global.fetch,
  timeoutMs = 15000,
} = {}) {
  validateRevenueEvidenceLokiPayload(payload);
  const parsed = validateLokiEndpoint(endpoint);
  const normalizedUserId = normalizeText(userId, 160);
  const normalizedToken = normalizeText(token, 4096);
  if (!normalizedUserId || !normalizedToken) {
    throw new Error('Grafana Loki user ID and access-policy token are required.');
  }
  if (/[:\r\n]/.test(normalizedUserId)) {
    throw new Error('Grafana Loki user ID must not contain a colon or line break.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const body = JSON.stringify(payload);
  const response = await fetchImpl(parsed, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${normalizedUserId}:${normalizedToken}`).toString('base64')}`,
      'content-type': 'application/json',
      'user-agent': 'thumbgate-revenue-evidence/1',
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1000, nonNegativeInteger(timeoutMs, 15000))),
  });
  if (!response?.ok) {
    throw new Error(`Grafana Loki rejected the aggregate evidence payload with HTTP ${response?.status || 'unknown'}.`);
  }
  return {
    sent: true,
    httpStatus: response.status,
    endpointHost: parsed.hostname,
    payloadSha256: sha256(body),
  };
}

function buildStatPanel({ id, title, field, x, y, unit = 'short', boolean = false }) {
  const panel = {
    id,
    type: 'stat',
    title,
    datasource: { type: 'loki', uid: '${DS_LOKI}' },
    gridPos: { h: 5, w: 6, x, y },
    fieldConfig: {
      defaults: {
        unit,
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: boolean
            ? [{ color: 'red', value: null }, { color: 'green', value: 1 }]
            : [{ color: 'green', value: null }],
        },
      },
      overrides: [],
    },
    options: {
      colorMode: 'background',
      graphMode: 'none',
      justifyMode: 'auto',
      orientation: 'auto',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto',
      wideLayout: true,
    },
    targets: [{
      refId: 'A',
      datasource: { type: 'loki', uid: '${DS_LOKI}' },
      editorMode: 'code',
      expr: `last_over_time({service_name="thumbgate", event="revenue_evidence"} | json | unwrap ${field} [$__range])`,
      queryType: 'instant',
    }],
  };
  if (boolean) {
    panel.fieldConfig.defaults.mappings = [{
      type: 'value',
      options: {
        0: { color: 'red', index: 0, text: 'NO' },
        1: { color: 'green', index: 1, text: 'YES' },
      },
    }];
  }
  return panel;
}

function buildGrafanaDashboard({ uid = DEFAULT_DASHBOARD_UID } = {}) {
  return {
    annotations: { list: [] },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: [],
    liveNow: false,
    panels: [
      buildStatPanel({ id: 1, title: 'First external payment', field: 'firstExternalPaymentValue', x: 0, y: 0, boolean: true }),
      buildStatPanel({ id: 2, title: 'Paid today', field: 'sameDayExternalPaymentValue', x: 6, y: 0, boolean: true }),
      buildStatPanel({ id: 3, title: 'Booked revenue', field: 'bookedRevenueDollars', x: 12, y: 0, unit: 'currencyUSD' }),
      buildStatPanel({ id: 4, title: '$1k/hour control achieved', field: 'targetAchievedValue', x: 18, y: 0, boolean: true }),
      buildStatPanel({ id: 5, title: 'Verified paid rows', field: 'verifiedPaid', x: 0, y: 5 }),
      buildStatPanel({ id: 6, title: 'Pipeline evidence gaps', field: 'evidenceGapCount', x: 6, y: 5 }),
      buildStatPanel({ id: 7, title: 'Verified same-day signals', field: 'sameDayEvidencePriority', x: 12, y: 5 }),
      buildStatPanel({ id: 8, title: 'Review-only signals', field: 'sameDayReviewPriority', x: 18, y: 5 }),
      buildStatPanel({ id: 9, title: 'Approval-ready actions', field: 'approvalReady', x: 0, y: 10 }),
      buildStatPanel({ id: 10, title: 'Provider coverage complete', field: 'providerCoverageCompleteValue', x: 6, y: 10, boolean: true }),
      buildStatPanel({ id: 11, title: 'Production healthy', field: 'productionHealthyValue', x: 12, y: 10, boolean: true }),
      buildStatPanel({ id: 12, title: 'Candidate deployed', field: 'expectedRevisionDeployedValue', x: 18, y: 10, boolean: true }),
      buildStatPanel({ id: 15, title: 'Observed visitors', field: 'observedVisitors', x: 0, y: 15 }),
      buildStatPanel({ id: 16, title: 'Observed CTA clicks', field: 'observedCtaClicks', x: 6, y: 15 }),
      buildStatPanel({ id: 17, title: 'Observed checkout starts', field: 'observedCheckoutStarts', x: 12, y: 15 }),
      buildStatPanel({ id: 18, title: 'Observed diagnostic starts', field: 'observedDiagnosticCheckoutStarts', x: 18, y: 15 }),
      buildStatPanel({ id: 19, title: 'Observed sprint intakes', field: 'observedWorkflowSprintIntakeCount', x: 0, y: 20 }),
      buildStatPanel({ id: 20, title: 'Observed complete intakes', field: 'observedCompleteWorkflowSprintIntakeCount', x: 6, y: 20 }),
      buildStatPanel({ id: 21, title: 'Lifecycle-qualified leads', field: 'observedLifecycleQualifiedWorkflowSprintLeadCount', x: 12, y: 20 }),
      buildStatPanel({ id: 22, title: 'Hosted funnel attached', field: 'observedFunnelAvailableValue', x: 18, y: 20, boolean: true }),
      buildStatPanel({ id: 23, title: 'Reviewed intake close queue attached', field: 'observedIntakeCloseQueueAvailableValue', x: 0, y: 25, boolean: true }),
      buildStatPanel({ id: 24, title: 'Approval-ready reviewed intakes', field: 'observedApprovalReadyIntakeCount', x: 6, y: 25 }),
      buildStatPanel({ id: 25, title: 'Discovery replies awaiting approval', field: 'observedDiscoveryReadyIntakeCount', x: 12, y: 25 }),
      buildStatPanel({ id: 26, title: 'Stripe catalog attached', field: 'stripeCatalogAttachedValue', x: 0, y: 30, boolean: true }),
      buildStatPanel({ id: 27, title: 'Stripe catalog verified', field: 'stripeCatalogVerifiedValue', x: 6, y: 30, boolean: true }),
      buildStatPanel({ id: 28, title: 'Stripe price drift', field: 'stripeCatalogPriceDriftCount', x: 12, y: 30 }),
      buildStatPanel({ id: 29, title: 'Stripe payment-rail drift', field: 'stripeCatalogPaymentRailDriftCount', x: 18, y: 30 }),
      {
        id: 13,
        type: 'logs',
        title: 'Revenue evidence snapshots',
        datasource: { type: 'loki', uid: '${DS_LOKI}' },
        gridPos: { h: 10, w: 24, x: 0, y: 35 },
        options: {
          dedupStrategy: 'signature',
          enableLogDetails: true,
          prettifyLogMessage: true,
          showCommonLabels: false,
          showLabels: false,
          showTime: true,
          sortOrder: 'Descending',
          wrapLogMessage: true,
        },
        targets: [{
          refId: 'A',
          datasource: { type: 'loki', uid: '${DS_LOKI}' },
          editorMode: 'code',
          expr: '{service_name="thumbgate", event="revenue_evidence"} | json',
          queryType: 'range',
        }],
      },
      {
        id: 14,
        type: 'text',
        title: 'Claim boundary',
        gridPos: { h: 5, w: 24, x: 0, y: 45 },
        options: {
          mode: 'markdown',
          content: `**${CLAIM_BOUNDARY}**\n\nObserved funnel panels are first-party activity counts, not payment proof. A lead is lifecycle-qualified only after its stored status reaches \`qualified\` or later. Approval-ready reviewed intakes are aggregate operator actions, not authorization, outreach, payment, or revenue. Stripe catalog verification proves exact offer and public Payment Link configuration, not a purchase. Zero-spend rule: keep Grafana Cloud on the free-forever plan and use aggregate fields only.`,
        },
      },
    ],
    refresh: '5m',
    schemaVersion: 41,
    tags: ['thumbgate', 'revenue', 'evidence'],
    templating: {
      list: [{
        name: 'DS_LOKI',
        type: 'datasource',
        label: 'Grafana Cloud Logs',
        query: 'loki',
        current: {},
        hide: 0,
        includeAll: false,
        multi: false,
        options: [],
        refresh: 1,
        regex: '',
        skipUrlSync: false,
      }],
    },
    time: { from: 'now-24h', to: 'now' },
    timepicker: {},
    timezone: 'browser',
    title: 'ThumbGate Revenue Evidence',
    uid,
    version: 1,
    weekStart: '',
  };
}

function parseArgs(argv = []) {
  const options = { send: false, dashboard: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send') {
      options.send = true;
      continue;
    }
    if (arg === '--dashboard') {
      options.dashboard = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const separator = arg.indexOf('=');
    const rawKey = separator === -1 ? arg.slice(2) : arg.slice(2, separator);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (separator !== -1) {
      options[key] = arg.slice(separator + 1);
      continue;
    }
    if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      options[key] = argv[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function writeJson(outPath, value) {
  if (!outPath) return null;
  const resolved = path.resolve(outPath);
  ensureParentDir(resolved);
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

async function runCli(argv = process.argv.slice(2), {
  env = process.env,
  fetchImpl = global.fetch,
} = {}) {
  const options = parseArgs(argv);
  if (options.dashboard) {
    const dashboard = buildGrafanaDashboard({ uid: options.uid || DEFAULT_DASHBOARD_UID });
    const outputPath = writeJson(options.out, dashboard);
    return {
      status: 'dashboard_prepared_not_published',
      dashboard,
      outputPath,
      claimBoundary: CLAIM_BOUNDARY,
    };
  }

  const targetFile = readJsonFile(options.target, 'Target-control evidence');
  const remediationFile = readJsonFile(options.remediation, 'Remediation evidence');
  const billingFile = options.billing
    ? readJsonFile(options.billing, 'Hosted billing evidence')
    : null;
  const stripeCatalogFile = options.stripeCatalog
    ? readJsonFile(options.stripeCatalog, 'Stripe catalog audit')
    : null;
  const snapshot = buildRevenueEvidenceSnapshot({
    target: targetFile.value,
    remediation: remediationFile.value,
    billing: billingFile?.value,
    stripeCatalog: stripeCatalogFile?.value,
    targetDigest: targetFile.digest,
    remediationDigest: remediationFile.digest,
    billingDigest: billingFile?.digest,
    stripeCatalogDigest: stripeCatalogFile?.digest,
    generatedAt: options.now || new Date().toISOString(),
  });
  const payload = buildLokiPayload(snapshot);
  const payloadSha256 = sha256(JSON.stringify(payload));
  const outputPath = writeJson(options.out, { snapshot, lokiPayload: payload });
  let delivery = null;
  if (options.send) {
    if (env.THUMBGATE_GRAFANA_ZERO_SPEND_CONFIRMED !== '1') {
      throw new Error('Set THUMBGATE_GRAFANA_ZERO_SPEND_CONFIRMED=1 only after confirming the stack remains on the free plan.');
    }
    delivery = await sendLokiPayload(payload, {
      endpoint: options.endpoint || env.THUMBGATE_GRAFANA_LOKI_URL,
      userId: options.userId || env.THUMBGATE_GRAFANA_LOKI_USER_ID,
      token: env.THUMBGATE_GRAFANA_LOKI_TOKEN,
      fetchImpl,
    });
  }
  return {
    status: delivery ? 'sent' : 'prepared_not_sent',
    snapshot,
    payloadSha256,
    outputPath,
    delivery,
    claimBoundary: CLAIM_BOUNDARY,
  };
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  if (!invokedPath) return false;
  try {
    return fs.realpathSync(path.resolve(invokedPath)) === fs.realpathSync(__filename);
  } catch {
    return path.resolve(invokedPath) === path.resolve(__filename);
  }
}

if (isCliInvocation()) {
  runCli().then((result) => {
    const safeResult = {
      status: result.status,
      outputPath: result.outputPath,
      payloadSha256: result.payloadSha256 || null,
      delivery: result.delivery,
      snapshot: result.snapshot || null,
      dashboardUid: result.dashboard?.uid || null,
      claimBoundary: result.claimBoundary,
    };
    process.stdout.write(`${JSON.stringify(safeResult, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  CLAIM_BOUNDARY,
  DEFAULT_DASHBOARD_UID,
  LOKI_HOST_PATTERN,
  LOKI_PUSH_PATH,
  SCHEMA_VERSION,
  buildGrafanaDashboard,
  buildLokiPayload,
  buildObservedFunnelFields,
  buildStripeCatalogFields,
  buildRevenueEvidenceSnapshot,
  buildStatPanel,
  isCliInvocation,
  parseArgs,
  readJsonFile,
  runCli,
  sendLokiPayload,
  sha256,
  validateLokiEndpoint,
  validateRevenueEvidenceLokiPayload,
  validateRevenueEvidenceSnapshot,
  writeJson,
};
