const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_VERSION,
  CanonicalIntakeRegistry,
  evaluateCandidateMergeGate,
  buildProtocolV1Report,
} = require('../scripts/multi-agent-coordination-captain');

test('Failure Case 1: Identical and paraphrased requests reach multiple agents and deduplicate to one canonical task', () => {
  const registry = new CanonicalIntakeRegistry();
  const r1 = registry.registerOrDeduplicateRequest({
    taskId: 'TASK-LI-1',
    project: 'ThumbGate',
    prompt: 'Set up Igor LinkedIn profile with 1584x396 SaaS founder banner and zero ECI mentions',
    outcome: 'Stellar LinkedIn founder profile converting AI agent developers',
    targetResources: ['https://www.linkedin.com/in/igor-ganapolsky-8947ba448/'],
    sowRevision: 1,
    captain: 'omp',
  });
  assert.equal(r1.status, 'CREATED_CANONICAL');

  const r2 = registry.registerOrDeduplicateRequest({
    project: 'ThumbGate',
    prompt: 'Update Igor LinkedIn founder profile banner 1584x396 and remove any ECI reference for AI agent devs',
    outcome: 'LinkedIn founder profile conversion layout',
    targetResources: ['https://www.linkedin.com/in/igor-ganapolsky-8947ba448/'],
    sowRevision: 1,
    captain: 'poolside',
  });
  assert.equal(r2.status, 'DEDUPLICATED_TO_CANONICAL');
  assert.equal(r2.canonicalTask.id, 'TASK-LI-1');
  assert.equal(r2.canonicalTask.linkedRequests.length, 2);
});

test('Failure Case 2: Duplicate or out-of-order dispatch with stale SOW revision is rejected', () => {
  const registry = new CanonicalIntakeRegistry();
  registry.registerOrDeduplicateRequest({
    taskId: 'TASK-SOW-1',
    project: 'ThumbGate',
    prompt: 'Implement Multi-Agent Coordination Protocol v1.0 runtime',
    outcome: 'Canonical Captain runtime',
    targetResources: ['scripts/multi-agent-coordination-captain.js'],
    sowRevision: 3,
  });

  const stale = registry.registerOrDeduplicateRequest({
    taskId: 'TASK-SOW-1',
    project: 'ThumbGate',
    prompt: 'Implement Multi-Agent Coordination Protocol v1.0 runtime',
    outcome: 'Canonical Captain runtime',
    targetResources: ['scripts/multi-agent-coordination-captain.js'],
    sowRevision: 2,
  });
  assert.equal(stale.status, 'REJECTED_STALE_SOW_REVISION');
});

test('Failure Case 3: Owner crashes after external action succeeds but before receipt storage; takeover reconciles idempotencyKey without duplicate execution', () => {
  const registry = new CanonicalIntakeRegistry();
  registry.registerOrDeduplicateRequest({
    taskId: 'TASK-EXT-1',
    project: 'ThumbGate',
    prompt: 'Upload LinkedIn cover banner',
    outcome: 'Banner live',
    targetResources: ['linkedin:cover'],
    sowRevision: 1,
    authorizedEffects: ['upload_banner'],
  });

  const lease1 = registry.acquireClaim({
    resource: 'linkedin:cover',
    owner: 'agent-a',
    taskId: 'TASK-EXT-1',
    sowRevision: 1,
    ttlMs: 1000,
    nowMs: 1000,
  });
  assert.equal(lease1.ok, true);

  let callCount = 0;
  const crashAttempt = registry.executeExternalEffect({
    taskId: 'TASK-EXT-1',
    resource: 'linkedin:cover',
    owner: 'agent-a',
    fencingToken: lease1.claim.fencingToken,
    logicalAction: 'upload_banner',
    idempotencyKey: 'idem-banner-1',
    nowMs: 1200,
    executorFn: () => {
      callCount += 1;
      return { SimulatedCrashBeforeReceipt: true, receipt: 'licdn://banner-123' };
    },
  });
  assert.equal(crashAttempt.code, 'CRASH_BEFORE_RECEIPT_STORAGE');
  assert.equal(callCount, 1);

  // Lease expires and agent-b takes over using the same idempotencyKey
  const lease2 = registry.acquireClaim({
    resource: 'linkedin:cover',
    owner: 'agent-b',
    taskId: 'TASK-EXT-1',
    sowRevision: 1,
    ttlMs: 1000,
    nowMs: 2500,
  });
  assert.equal(lease2.ok, true);
  assert.equal(lease2.reconciledEffects.length, 1);

  const retryAttempt = registry.executeExternalEffect({
    taskId: 'TASK-EXT-1',
    resource: 'linkedin:cover',
    owner: 'agent-b',
    fencingToken: lease2.claim.fencingToken,
    logicalAction: 'upload_banner',
    idempotencyKey: 'idem-banner-1',
    nowMs: 2600,
    executorFn: () => {
      callCount += 1;
      return { receipt: 'licdn://banner-duplicate' };
    },
  });
  assert.equal(retryAttempt.ok, true);
  assert.equal(retryAttempt.deduplicatedReceipt, true);
  assert.equal(callCount, 1, 'External effect must not execute a second time after crash recovery');
});

test('Failure Case 4: Expired owner resumes after takeover and is rejected by monotonic fencing token', () => {
  const registry = new CanonicalIntakeRegistry();
  registry.registerOrDeduplicateRequest({
    taskId: 'TASK-FENCE-1',
    project: 'ThumbGate',
    prompt: 'Edit shared file',
    outcome: 'Clean file',
    targetResources: ['src/api/server.js'],
    sowRevision: 1,
  });

  const c1 = registry.acquireClaim({
    resource: 'src/api/server.js',
    owner: 'stale-agent',
    taskId: 'TASK-FENCE-1',
    ttlMs: 500,
    nowMs: 1000,
  });
  const c2 = registry.acquireClaim({
    resource: 'src/api/server.js',
    owner: 'new-agent',
    taskId: 'TASK-FENCE-1',
    ttlMs: 5000,
    nowMs: 2000,
  });
  assert.ok(c2.claim.fencingToken > c1.claim.fencingToken);

  const staleWrite = registry.validateWriteBoundary({
    resource: 'src/api/server.js',
    owner: 'stale-agent',
    fencingToken: c1.claim.fencingToken,
    sowRevision: 1,
    nowMs: 2100,
  });
  assert.equal(staleWrite.ok, false);
  assert.equal(staleWrite.code, 'OWNER_MISMATCH');

  const forgedOwnerStaleToken = registry.validateWriteBoundary({
    resource: 'src/api/server.js',
    owner: 'new-agent',
    fencingToken: c1.claim.fencingToken,
    sowRevision: 1,
    nowMs: 2100,
  });
  assert.equal(forgedOwnerStaleToken.ok, false);
  assert.equal(forgedOwnerStaleToken.code, 'STALE_FENCING_TOKEN');
});

test('Failure Case 5 & 6: Changed integration base OR failed required test blocks promotion even when LLM judge gives 10/10 praise', () => {
  const baseChanged = evaluateCandidateMergeGate({
    producer: 'omp',
    reviewer: 'reviewer',
    candidateRevision: 'sha-cand-1',
    baseRevision: 'sha-base-old',
    currentTargetBaseRevision: 'sha-base-new',
    judgePraiseScore: 10,
    criteria: [{ id: 'C1', required: true, evidence: 'log', artifactVersion: 'sha-cand-1', testPassed: true }],
  });
  assert.equal(baseChanged.promotable, false);
  assert.equal(baseChanged.reason, 'INTEGRATION_BASE_CHANGED_INVALIDATING_EVIDENCE');

  const judgePraiseTestFailed = evaluateCandidateMergeGate({
    producer: 'omp',
    reviewer: 'reviewer',
    candidateRevision: 'sha-cand-2',
    baseRevision: 'sha-base-current',
    currentTargetBaseRevision: 'sha-base-current',
    judgePraiseScore: 10,
    criteria: [
      { id: 'C1', required: true, evidence: 'unit test pass', artifactVersion: 'sha-cand-2', testPassed: true },
      { id: 'C2', required: true, evidence: 'ci check failed', artifactVersion: 'sha-cand-2', testPassed: false },
    ],
  });
  assert.equal(judgePraiseTestFailed.promotable, false);
  assert.equal(judgePraiseTestFailed.gateMatrix[1].status, 'FAIL');
});

test('Failure Case 7: Unauthorized external effect or mismatched handoff read-back is blocked; Protocol v1.0 JSON envelope is valid', () => {
  const registry = new CanonicalIntakeRegistry();
  registry.registerOrDeduplicateRequest({
    taskId: 'TASK-AUTH-1',
    project: 'ThumbGate',
    prompt: 'Audit revenue only',
    outcome: 'Audit report',
    targetResources: ['scripts/revenue-status.js'],
    sowRevision: 1,
    authorizedEffects: ['read_telemetry'],
  });
  const claim = registry.acquireClaim({
    resource: 'scripts/revenue-status.js',
    owner: 'omp',
    taskId: 'TASK-AUTH-1',
    nowMs: 1000,
  });

  const unauthorizedSpend = registry.executeExternalEffect({
    taskId: 'TASK-AUTH-1',
    resource: 'scripts/revenue-status.js',
    owner: 'omp',
    fencingToken: claim.claim.fencingToken,
    logicalAction: 'purchase_paid_ads',
    idempotencyKey: 'idem-spend-1',
    nowMs: 1100,
    executorFn: () => ({ receipt: 'should-not-run' }),
  });
  assert.equal(unauthorizedSpend.ok, false);
  assert.equal(unauthorizedSpend.code, 'UNAUTHORIZED_EXTERNAL_EFFECT');

  const handoff = registry.submitHandoff({
    handoffId: 'HO-1',
    taskId: 'TASK-AUTH-1',
    sowRevision: 1,
    sender: 'omp',
    receiver: 'reviewer',
    artifactVersion: 'sha-exact-1',
    checksRun: ['node --test'],
  });
  assert.equal(handoff.ok, true);

  const badReadback = registry.acceptHandoff({
    handoffId: 'HO-1',
    receiver: 'reviewer',
    readBackArtifactVersion: 'sha-stale-0',
  });
  assert.equal(badReadback.ok, false);
  assert.equal(badReadback.code, 'ARTIFACT_READBACK_MISMATCH');

  const report = buildProtocolV1Report();
  assert.equal(report.protocol_version, PROTOCOL_VERSION);
  assert.ok(Array.isArray(report.scorecard) && report.scorecard.length === 9);
  assert.ok(Array.isArray(report.gate_matrix) && report.gate_matrix.every((g) => g.status === 'PASS'));
});
