'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BEAM_MODEL_SPEC,
  buildBeamAndMirrorConfig,
  evaluateMirrorCliActionGate,
  filterVerifiedTracesForSelfDistillation,
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
