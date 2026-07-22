const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseArgs,
  loadOperatorConfig,
  summarizeQueue,
  exportPrivateQueue,
  fetchWorkflowIntakeQueue,
  validateQueuePayload,
} = require('../scripts/workflow-intake-queue');

function sampleQueue() {
  return {
    generatedAt: '2026-07-16T18:00:00.000Z',
    total: 2,
    matchedTotal: 2,
    eligibleTotal: 2,
    excludedTotal: 0,
    excludedByReason: {},
    returned: 2,
    approvalReadyTotal: 1,
    discoveryReadyTotal: 1,
    primaryApprovalAction: {
      destination: { address: 'buyer@example.com' },
      approvalPhrase: 'APPROVE SEND SECRET OFFER',
      draft: { body: 'private draft' },
    },
    primaryDiscoveryAction: {
      destination: { address: 'other@example.com' },
      approvalPhrase: 'APPROVE SEND PRIVATE DISCOVERY',
      draft: { body: 'private discovery draft' },
    },
    byStatus: { new: 1, qualified: 1 },
    filters: { statuses: ['new', 'qualified'], limit: 50 },
    latestSubmittedAt: '2026-07-16T17:00:00.000Z',
    oldestSubmittedAt: '2026-07-16T16:00:00.000Z',
    leads: [{
      leadId: 'lead_private_123',
      submittedAt: '2026-07-16T17:00:00.000Z',
      updatedAt: '2026-07-16T17:30:00.000Z',
      status: 'qualified',
      priorityRank: 1,
      contact: { name: 'Buyer', email: 'buyer@example.com', company: 'Private Co' },
      qualification: { workflow: 'private workflow', blocker: 'private failure' },
      nextOperatorStep: 'request_action_time_approval',
      qualificationCard: {
        priorityScore: 105,
        priorityBand: 'review_now',
        fitBand: 'strong_evidence_for_review',
        route: 'diagnostic',
        unknowns: [],
        recommendedOffer: { offerId: 'workflow_hardening_diagnostic', priceCents: 49900 },
      },
      discoveryPacket: {
        status: 'hold_not_approval_ready',
        blockers: ['lifecycle_not_new'],
      },
      closePacket: {
        status: 'approval_ready_not_authorized',
        blockers: [],
        destination: { address: 'buyer@example.com' },
        approvalPhrase: 'APPROVE SEND SECRET OFFER',
        draft: { body: 'private draft' },
        offer: { offerId: 'workflow_hardening_diagnostic', priceCents: 49900 },
      },
    }, {
      leadId: 'lead_private_456',
      submittedAt: '2026-07-16T16:00:00.000Z',
      status: 'new',
      priorityRank: 2,
      contact: { email: 'other@example.com' },
      nextOperatorStep: 'request_action_time_approval_for_discovery',
      qualificationCard: {
        priorityScore: 55,
        priorityBand: 'hold_or_nurture',
        fitBand: 'partial_evidence',
        route: 'nurture',
        unknowns: ['budgetMechanism'],
      },
      discoveryPacket: {
        status: 'approval_ready_not_authorized',
        blockers: [],
        destination: { address: 'other@example.com' },
        approvalPhrase: 'APPROVE SEND PRIVATE DISCOVERY',
        draft: { body: 'private discovery draft' },
      },
      closePacket: {
        status: 'hold_not_approval_ready',
        blockers: ['material_unknowns_remaining'],
      },
    }],
  };
}

function response(payload, {
  status = 200,
  cacheControl = 'private, no-store, max-age=0',
  vary = 'Authorization',
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        if (name.toLowerCase() === 'cache-control') return cacheControl;
        if (name.toLowerCase() === 'vary') return vary;
        return null;
      },
    },
    json: async () => payload,
  };
}

test('parseArgs defaults to an aggregate new and qualified queue', () => {
  assert.deepEqual(parseArgs([]), {
    json: false,
    statuses: ['new', 'qualified'],
    limit: 50,
    timeoutMs: 15000,
    exportPrivatePath: null,
  });
});

test('parseArgs validates statuses, bounds, and private output path', () => {
  const options = parseArgs([
    '--json',
    '--status=qualified,new,qualified',
    '--limit=25',
    '--timeout-ms=2500',
    '--export-private=/tmp/thumbgate-intake.json',
  ]);
  assert.deepEqual(options.statuses, ['qualified', 'new']);
  assert.equal(options.limit, 25);
  assert.equal(options.timeoutMs, 2500);
  assert.equal(options.exportPrivatePath, '/tmp/thumbgate-intake.json');
  assert.throws(() => parseArgs(['--status=all,new']), /status must be all/);
  assert.throws(() => parseArgs(['--limit=101']), /limit must be an integer/);
  assert.throws(() => parseArgs(['--export-private=relative.json']), /absolute local file path/);
  assert.throws(() => parseArgs(['--print-private']), /Unknown argument/);
});

test('queue payload validation rejects missing, negative, and inconsistent aggregate counters', () => {
  const missingDiscovery = sampleQueue();
  delete missingDiscovery.discoveryReadyTotal;
  assert.throws(() => validateQueuePayload(missingDiscovery), /invalid payload/i);

  const negative = sampleQueue();
  negative.discoveryReadyTotal = -1;
  assert.throws(() => validateQueuePayload(negative), /invalid payload/i);

  const inconsistent = sampleQueue();
  inconsistent.returned = 1;
  assert.throws(() => validateQueuePayload(inconsistent), /invalid payload/i);

  const overclassified = sampleQueue();
  overclassified.discoveryReadyTotal = 2;
  assert.throws(() => validateQueuePayload(overclassified), /invalid payload/i);
});

test('aggregate summary redacts every buyer and approval field', () => {
  const payload = sampleQueue();
  payload.generatedAt = 'buyer@example.com';
  payload.byStatus['buyer@example.com'] = 99;
  payload.filters.statuses.push('buyer@example.com');
  payload.leads[0].qualificationCard.unknowns.push('buyer@example.com');
  payload.leads[0].closePacket.blockers.push('buyer@example.com');
  payload.leads[1].discoveryPacket.blockers.push('buyer@example.com');
  payload.leads[1].discoveryPacket.destination.secret = 'must-not-leak';
  payload.leads[0].qualificationCard.route = 'buyer@example.com';
  payload.leads[0].closePacket.offer.priceCents = -49900;
  const summary = summarizeQueue(payload, 'https://thumbgate.ai');
  const text = JSON.stringify(summary);
  assert.equal(summary.total, 2);
  assert.equal(summary.matchedTotal, 2);
  assert.equal(summary.eligibleTotal, 2);
  assert.equal(summary.excludedTotal, 0);
  assert.equal(summary.approvalReadyTotal, 1);
  assert.equal(summary.discoveryReadyTotal, 1);
  assert.equal(summary.primaryApprovalActionAvailable, true);
  assert.equal(summary.primaryDiscoveryActionAvailable, true);
  assert.equal(summary.leads[0].ref.length, 12);
  assert.equal(summary.leads[0].offerId, 'workflow_hardening_diagnostic');
  assert.equal(summary.leads[0].priceCents, 49900);
  assert.equal(summary.leads[0].discoveryStatus, 'hold_not_approval_ready');
  assert.deepEqual(summary.leads[0].discoveryBlockers, ['lifecycle_not_new']);
  assert.equal(summary.leads[1].discoveryStatus, 'approval_ready_not_authorized');
  assert.deepEqual(summary.leads[1].discoveryBlockers, []);
  assert.equal(summary.externalActionAuthorized, false);
  assert.equal(summary.revenueRecognized, false);
  assert.equal(summary.generatedAt, null);
  assert.deepEqual(summary.byStatus, { new: 1, qualified: 1 });
  for (const privateValue of [
    'lead_private_123',
    'buyer@example.com',
    'Buyer',
    'Private Co',
    'private workflow',
    'private failure',
    'private draft',
    'private discovery draft',
    'APPROVE SEND SECRET OFFER',
    'APPROVE SEND PRIVATE DISCOVERY',
    'must-not-leak',
  ]) {
    assert.equal(text.includes(privateValue), false, `summary leaked ${privateValue}`);
  }
});

test('operator config loader rejects permissive files and symlinks', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-operator-config-'));
  const configPath = path.join(dir, 'operator.json');
  const linkPath = path.join(dir, 'operator-link.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({ operatorKey: 'secret', baseUrl: 'https://thumbgate.ai' }), { mode: 0o600 });
    assert.equal(loadOperatorConfig(configPath).operatorKey, 'secret');
    fs.chmodSync(configPath, 0o644);
    assert.equal(loadOperatorConfig(configPath).operatorKey, null);
    fs.chmodSync(configPath, 0o600);
    fs.symlinkSync(configPath, linkPath);
    assert.equal(loadOperatorConfig(linkPath).operatorKey, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchWorkflowIntakeQueue sends credentials only in the authorization header', async () => {
  let capturedUrl;
  let capturedOptions;
  const result = await fetchWorkflowIntakeQueue({
    statuses: ['new', 'qualified'],
    limit: 25,
    timeoutMs: 1000,
  }, {
    apiBaseUrl: 'https://thumbgate.ai',
    apiKey: 'operator_secret',
  }, async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return response(sampleQueue());
  });

  assert.equal(capturedUrl, 'https://thumbgate.ai/v1/intake/workflow-sprint/queue?status=new%2Cqualified&limit=25');
  assert.equal(capturedUrl.includes('operator_secret'), false);
  assert.equal(capturedOptions.headers.authorization, 'Bearer operator_secret');
  assert.equal(result.summary.leads[0].ref.length, 12);
});

test('fetchWorkflowIntakeQueue applies safe defaults for library callers', async () => {
  let capturedUrl;
  await fetchWorkflowIntakeQueue({}, {
    apiBaseUrl: 'https://thumbgate.ai',
    apiKey: 'operator_secret',
  }, async (url) => {
    capturedUrl = String(url);
    return response(sampleQueue());
  });
  assert.equal(capturedUrl, 'https://thumbgate.ai/v1/intake/workflow-sprint/queue?status=new%2Cqualified&limit=50');
});

test('fetchWorkflowIntakeQueue fails closed on old releases, credentials, and unsafe caching', async () => {
  const options = { statuses: ['new'], limit: 1, timeoutMs: 1000 };
  const config = { apiBaseUrl: 'https://thumbgate.ai', apiKey: 'operator_secret' };
  await assert.rejects(
    fetchWorkflowIntakeQueue(options, config, async () => response({}, { status: 404 })),
    (error) => error.code === 'release_required' && error.status === 404
  );
  await assert.rejects(
    fetchWorkflowIntakeQueue(options, config, async () => response({}, { status: 403 })),
    (error) => error.code === 'operator_credentials_rejected' && error.status === 403
  );
  await assert.rejects(
    fetchWorkflowIntakeQueue(options, config, async (url) =>
      String(url).includes('/v1/billing/summary')
        ? response({ revenue: {} })
        : response({}, { status: 401 })),
    (error) => error.code === 'release_required' && error.status === 401
  );
  await assert.rejects(
    fetchWorkflowIntakeQueue(options, config, async () => response(sampleQueue(), { cacheControl: 'public, max-age=60' })),
    (error) => error.code === 'unsafe_cache_policy'
  );
  await assert.rejects(
    fetchWorkflowIntakeQueue(options, config, async () => response(sampleQueue(), { vary: 'Accept-Encoding' })),
    (error) => error.code === 'unsafe_cache_policy'
  );
});

test('private export is explicit, complete, mode 0600, and never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-intake-queue-'));
  const outputPath = path.join(dir, 'private.json');
  try {
    const proof = exportPrivateQueue(sampleQueue(), outputPath);
    const raw = fs.readFileSync(outputPath, 'utf8');
    assert.equal(proof.path, fs.realpathSync(outputPath));
    assert.equal(proof.mode, '600');
    assert.equal(proof.sha256.length, 64);
    assert.match(raw, /private_buyer_intake_do_not_commit_or_share/);
    assert.match(raw, /buyer@example\.com/);
    assert.match(raw, /externalActionAuthorized\": false/);
    assert.throws(() => exportPrivateQueue(sampleQueue(), outputPath), /EEXIST/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
