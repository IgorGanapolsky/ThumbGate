'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  PLANES,
  PLANE_RAILS,
  hashArtifact,
  createDatapackDescriptor,
  evaluateMemoryPromotion,
  detectCloneAttempt,
  auditTrace,
  buildMekoDatapackReport,
  formatMekoDatapackReport,
} = require('../scripts/meko-datapack-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'meko-datapack-honesty.js');

test('PLANES contains the 5-plane Meko FORMAT', () => {
  assert.deepEqual([...PLANES], ['datapack', 'memory', 'learning', 'artifact', 'trace']);
});

test('PLANE_RAILS maps every plane to existing ThumbGate rails', () => {
  for (const plane of PLANES) {
    assert.ok(PLANE_RAILS[plane], `missing rail definition for ${plane}`);
    assert.ok(PLANE_RAILS[plane].rails.length > 0);
    assert.ok(PLANE_RAILS[plane].when);
  }
});

test('hashArtifact produces deterministic 64-char SHA-256 hex string', () => {
  const content = 'console.log("hello thumbgate");\n';
  const hash1 = hashArtifact(content);
  const hash2 = hashArtifact(content);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});

test('hashArtifact throws on null or undefined content', () => {
  assert.throws(() => hashArtifact(null), /TypeError/);
  assert.throws(() => hashArtifact(undefined), /TypeError/);
});

test('createDatapackDescriptor sets complete four-field scope', () => {
  const pack = createDatapackDescriptor({
    id: 'pack-trading-risk',
    name: 'Trading Risk Rails',
    scope: { entity: 'corp-alpha', project: 'hft', process: 'gamma-scalp', session: 's-99' },
    owner: 'Igor',
  });
  assert.equal(pack.id, 'pack-trading-risk');
  assert.equal(pack.scope.entity, 'corp-alpha');
  assert.equal(pack.scope.project, 'hft');
  assert.equal(pack.scope.process, 'gamma-scalp');
  assert.equal(pack.scope.session, 's-99');
});

test('evaluateMemoryPromotion enforces rubric score floor and feedback signal', () => {
  // Pass case
  const good = evaluateMemoryPromotion({
    memoryId: 'mem_123',
    signal: 'positive',
    rubricScore: 0.85,
    domain: 'git-protection',
  });
  assert.equal(good.promoted, true);
  assert.ok(good.learningId.startsWith('learn_'));

  // Fail case: rubric score below floor (0.70)
  const badScore = evaluateMemoryPromotion({
    memoryId: 'mem_124',
    signal: 'positive',
    rubricScore: 0.55,
    domain: 'git-protection',
  });
  assert.equal(badScore.promoted, false);
  assert.equal(badScore.reason, 'rubric_score_insufficient');

  // Fail case: invalid signal
  const badSignal = evaluateMemoryPromotion({
    memoryId: 'mem_125',
    signal: 'neutral_vibe',
    rubricScore: 0.90,
    domain: 'git-protection',
  });
  assert.equal(badSignal.promoted, false);
  assert.equal(badSignal.reason, 'invalid_feedback_signal');
});

test('detectCloneAttempt flags YugabyteDB and mekodata cloud triggers', () => {
  assert.ok(detectCloneAttempt('npm install yugabyte'));
  assert.ok(detectCloneAttempt('https://cloud.mekodata.ai/api/v1'));
  assert.ok(detectCloneAttempt('import meko-skills'));
  assert.equal(detectCloneAttempt('standard thumbgate pretooluse hook'), null);
});

test('auditTrace passes a clean, firewalled trace', () => {
  const cleanTrace = {
    datapack: {
      id: 'pack-1',
      scope: { entity: 'e1', project: 'p1', process: 'pr1', session: 's1' },
    },
    hasMemoryStore: true,
    hasPreToolUseFirewall: true,
    artifacts: [
      { filename: 'receipt.json', contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    ],
    promotions: [
      { memoryId: 'm1', signal: 'positive', rubricScore: 0.92, domain: 'auth' },
    ],
    decisionTrace: { plan: ['read', 'verify'], reasoning: 'audit code' },
  };

  const audit = auditTrace(cleanTrace);
  assert.equal(audit.pass, true);
  assert.equal(audit.findings.length, 0);
  assert.deepEqual(audit.planesCovered.sort(), [...PLANES].sort());
});

test('auditTrace fails closed on passive memory store without PreToolUse firewall', () => {
  const badTrace = {
    hasMemoryStore: true,
    hasPreToolUseFirewall: false,
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'passive_store_without_firewall'));
});

test('auditTrace fails closed on unhashed artifact store', () => {
  const badTrace = {
    hasPreToolUseFirewall: true,
    artifacts: [
      { filename: 'evidence.txt', contentHash: 'not-a-sha256' },
    ],
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'unhashed_artifact_store'));
});

test('auditTrace fails closed on unverified learning promotion', () => {
  const badTrace = {
    hasPreToolUseFirewall: true,
    promotions: [
      { memoryId: 'm1', signal: 'thumb_up', rubricScore: 0.40, domain: 'deploy' },
    ],
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'unverified_learning_promotion'));
});

test('auditTrace fails closed on unredacted plaintext cloud egress', () => {
  const badTrace = {
    hasPreToolUseFirewall: true,
    cloudEgress: true,
    remoteEndpoint: 'https://mcp.mekodata.ai/mcp',
    secretsRedacted: false,
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'plaintext_cloud_egress'));
});

test('auditTrace fails closed on external clone attempts', () => {
  const badTrace = {
    hasPreToolUseFirewall: true,
    dependencies: ['yugabyte-driver'],
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'meko_clone_refused'));
});

test('buildMekoDatapackReport and formatMekoDatapackReport generate valid outputs', () => {
  const report = buildMekoDatapackReport();
  assert.equal(report.schemaVersion, 'thumbgate.meko-datapack-honesty.v1');
  assert.equal(report.stealsFrom, 'Meko (cloud.mekodata.ai / YugabyteDB 2026)');

  const text = formatMekoDatapackReport(report);
  assert.ok(text.includes('Five-Plane FORMAT Map'));
  assert.ok(text.includes('[Plane: DATAPACK]'));
  assert.ok(text.includes('[Plane: LEARNING]'));
});

test('createDatapackDescriptor fails closed on missing scope fields', () => {
  assert.throws(
    () => createDatapackDescriptor({ id: 'p1', scope: { entity: 'e1', project: 'p1' } }),
    /Datapack descriptor requires non-empty scope field/
  );
  assert.throws(
    () => createDatapackDescriptor({ id: 'p1', scope: null }),
    /Datapack descriptor requires a scope object/
  );
});

test('auditTrace rejects string boolean firewall flags', () => {
  const badTrace = {
    hasMemoryStore: true,
    hasPreToolUseFirewall: 'false',
  };
  const audit = auditTrace(badTrace);
  assert.equal(audit.pass, false);
  assert.ok(audit.findings.some((f) => f.code === 'passive_store_without_firewall'));
});

test('buildMekoDatapackReport without trace reports not_run status', () => {
  const report = buildMekoDatapackReport();
  assert.equal(report.audit.status, 'not_run');
  assert.equal(report.audit.pass, null);
  assert.equal(report.audit.planesCovered.length, 0);
});

test('CLI runs cleanly with --json and --map-only', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  const data = JSON.parse(res.stdout);
  assert.equal(data.schemaVersion, 'thumbgate.meko-datapack-honesty.v1');
  assert.equal(data.planes.length, 5);
});
