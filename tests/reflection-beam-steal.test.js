'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BEAM_MODEL_SPEC,
  buildBeamAndMirrorConfig,
  evaluateMirrorCliActionGate,
  filterVerifiedTracesForSelfDistillation,
  assessServedEndpointEvidence,
} = require('../scripts/reflection-beam-steal');

test('BEAM_MODEL_SPEC & buildBeamAndMirrorConfig: exposes Beam-1.0-501B-A23B Apache-2.0 spec and ~/.mirror/mcp/thumbgate.json config', () => {
  assert.equal(BEAM_MODEL_SPEC.id, 'Beam-1.0-501B-A23B');
  assert.equal(BEAM_MODEL_SPEC.license, 'Apache-2.0');
  assert.equal(BEAM_MODEL_SPEC.totalParametersB, 501);
  assert.equal(BEAM_MODEL_SPEC.activeParametersB, 23);

  const cfg = buildBeamAndMirrorConfig({ repoRoot: '/workspace/ThumbGate' });
  assert.equal(cfg.mirrorMcpConfigPath, '~/.mirror/mcp/thumbgate.json');
  assert.equal(cfg.piProviderConfig.providers.reflection.models[0].id, 'Beam-1.0-501B-A23B');
});

test('evaluateMirrorCliActionGate: strips REFLECTION_API_KEY from subprocess env and blocks ~/.mirror credential reads & destructive auto-mode commands', () => {
  const safe = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'python3 -m unittest',
    approvalMode: 'auto',
    childEnv: { REFLECTION_API_KEY: 'secret_1', FIRECRAWL_API_KEY: 'fc_2', HOME: '/Users/igor' },
  });
  assert.equal(safe.allowed, true);
  assert.deepEqual(safe.strippedEnvKeys, ['REFLECTION_API_KEY', 'FIRECRAWL_API_KEY']);
  assert.equal(safe.sanitizedEnv.REFLECTION_API_KEY, undefined);

  const credRead = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'cat ~/.mirror/reflection_api_key',
    approvalMode: 'auto',
  });
  assert.equal(credRead.allowed, false);
  assert.equal(credRead.gateId, 'gate:mirror:credential_store_access_blocked');

  const forcePush = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'git push --force origin main',
    approvalMode: 'auto',
  });
  assert.equal(forcePush.allowed, false);
  assert.equal(forcePush.gateId, 'gate:mirror:unsandboxed_auto_mode_destructive_block');
});

test('filterVerifiedTracesForSelfDistillation: keeps only verifier-passed, secret-free traces within token budget', () => {
  const res = filterVerifiedTracesForSelfDistillation(
    [
      { traceId: 't_good', verifierPassed: true, exitCode: 0, totalTokens: 12600, steps: ['edit stats.py', 'unittest ok'] },
      { traceId: 't_fail', verifierPassed: false, exitCode: 1, totalTokens: 8000, steps: ['failed'] },
      { traceId: 't_bloated', verifierPassed: true, exitCode: 0, totalTokens: 64000, steps: ['loop'] },
    ],
    { maxTokensBudget: 32000 }
  );

  assert.equal(res.acceptedCount, 1);
  assert.equal(res.accepted[0].traceId, 't_good');
  assert.equal(res.accepted[0].loraReady, true);
  assert.equal(res.rejectedCount, 2);
});

const greenVerify = {
  ran: true,
  requestContractPassed: true,
  responseContractPassed: true,
  toolProtocolPassed: true,
};

test('a score waits for a green verify and the model id the endpoint serves', () => {
  const secret = 'rfl_localtestsecret';
  const skipped = assessServedEndpointEvidence({
    claimedModelId: 'local-model',
    servedModelId: 'local-model',
    verify: { ran: false },
    gradedScores: [1, 1],
    claimedScore: 1,
    artifacts: {
      apiKey: secret,
      note: 'probe',
      meta: { token: secret, log: `bearer ${secret}` },
      rows: [secret],
    },
  });
  assert.equal(skipped.reason, 'verify_before_score');
  assert.equal(skipped.score, null);
  assert.equal(skipped.artifacts.note, 'probe');
  assert.equal(Object.hasOwn(skipped.artifacts, 'apiKey'), false);
  assert.equal(Object.hasOwn(skipped.artifacts.meta, 'token'), false);
  assert.equal(skipped.artifacts.meta.log, '[redacted]');
  assert.deepEqual(skipped.artifacts.rows, ['[redacted]']);
  assert.equal(JSON.stringify(skipped).includes(secret), false);

  const wrongName = assessServedEndpointEvidence({
    claimedModelId: 'checkpoint-name',
    servedModelId: 'local-model',
    verify: greenVerify,
    gradedScores: [1],
  });
  assert.equal(wrongName.reason, 'model_id_mismatch');
  assert.equal(wrongName.score, null);
});

test('ungraded tasks count as zero, and no graded task means no score', () => {
  const none = assessServedEndpointEvidence({
    claimedModelId: 'local-model',
    servedModelId: 'local-model',
    verify: greenVerify,
    gradedScores: [],
    ungradedCount: 4,
    claimedScore: 0,
  });
  assert.equal(none.reason, 'nothing_graded');
  assert.equal(none.hasScore, false);
  assert.equal(none.score, null);
  assert.equal(none.conformancePassed, true);

  const mixed = assessServedEndpointEvidence({
    claimedModelId: 'local-model',
    servedModelId: 'local-model',
    verify: greenVerify,
    gradedScores: [1, 0],
    ungradedCount: 2,
  });
  assert.equal(mixed.decision, 'allow');
  assert.equal(mixed.reason, 'ungraded_count_as_zero');
  assert.equal(mixed.score, 0.25);

  const inflated = assessServedEndpointEvidence({
    claimedModelId: 'local-model',
    servedModelId: 'local-model',
    verify: greenVerify,
    gradedScores: [1],
    ungradedCount: 1,
    claimedScore: 1,
  });
  assert.equal(inflated.reason, 'score_does_not_match_rows');
  assert.equal(inflated.score, 0.5);
});
