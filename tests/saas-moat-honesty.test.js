'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  RAIL_MAP,
  CROWN_JEWEL_MODELS,
  CROWN_JEWEL_EXPORTERS,
  distillCrossCustomerSignature,
  aggregateCrossCustomerLoop,
  auditEntitlementBoundary,
  buildSaasMoatHonestyReport,
  formatSaasMoatHonestyReport,
} = require('../scripts/saas-moat-honesty');

const ROOT = path.resolve(__dirname, '..');

test('8-moat rail map covers all 8 Walling SaaS moats with bounded 0-100 scores', () => {
  assert.equal(RAIL_MAP.length, 8);
  for (const row of RAIL_MAP) {
    assert.equal(typeof row.wallingMoat, 'string');
    assert.ok(row.score >= 0 && row.score <= 100);
    assert.ok(row.thumbgateRail.length > 0);
  }
});

test('auditEntitlementBoundary confirms all 5 learned models and 3 exporters enforce entitlements and reject forged prefix keys', () => {
  const audit = auditEntitlementBoundary(ROOT);
  assert.equal(audit.ok, true);
  assert.equal(audit.gatedModelsCount, CROWN_JEWEL_MODELS.length);
  assert.equal(audit.gatedExportersCount, CROWN_JEWEL_EXPORTERS.length);
  assert.equal(audit.forgedPrefixRejectedWhenEnforced, true);
  assert.deepEqual(audit.findings, []);
});

test('distillCrossCustomerSignature redacts secrets, normalizes user paths, and blocks raw transcript exfiltration', () => {
  const blockedTranscript = distillCrossCustomerSignature({
    toolName: 'Bash',
    command: 'git push --force origin main',
    rawTranscript: 'User private conversation transcript',
  });
  assert.equal(blockedTranscript.ok, false);
  assert.equal(blockedTranscript.reason, 'raw_transcript_exfiltration_blocked');

  const distilledA = distillCrossCustomerSignature({
    orgId: 'org_alpha',
    toolName: 'Bash',
    category: 'destructive-git',
    command: 'rm -rf /Users/alice/workspace/project/.git',
  });
  const distilledB = distillCrossCustomerSignature({
    orgId: 'org_beta',
    toolName: 'Bash',
    category: 'destructive-git',
    command: 'rm -rf /Users/bob/workspace/project/.git',
  });

  assert.equal(distilledA.ok, true);
  assert.equal(distilledB.ok, true);
  assert.equal(distilledA.normalizedPattern, 'rm -rf /Users/<user>/workspace/project/.git');
  assert.equal(distilledA.signatureHash, distilledB.signatureHash, 'distinct user paths normalize to the same structural signature');
  assert.notEqual(distilledA.orgHash, distilledB.orgHash, 'org hashes remain distinct without exposing raw orgId');
  assert.ok(!distilledA.orgHash.includes('alpha'));
});

test('aggregateCrossCustomerLoop promotes structural signatures only when seen across >= 2 orgs and >= 3 occurrences', () => {
  const events = [
    { orgId: 'org_1', toolName: 'Bash', category: 'git-force', command: 'git push --force origin main' },
    { orgId: 'org_1', toolName: 'Bash', category: 'git-force', command: 'git push --force origin main' },
    { orgId: 'org_2', toolName: 'Bash', category: 'git-force', command: 'git push --force origin main' },
    { orgId: 'org_1', toolName: 'Bash', category: 'single-org-only', command: 'git reset --hard HEAD~5' },
    { orgId: 'org_1', toolName: 'Bash', category: 'single-org-only', command: 'git reset --hard HEAD~5' },
    { orgId: 'org_1', toolName: 'Bash', category: 'single-org-only', command: 'git reset --hard HEAD~5' },
  ];

  const loop = aggregateCrossCustomerLoop(events);
  assert.equal(loop.totalEvents, 6);
  assert.equal(loop.acceptedCount, 6);
  assert.equal(loop.rejectedCount, 0);
  assert.equal(loop.promotedCount, 1);

  const promoted = loop.signatures.find((s) => s.category === 'git-force');
  const unpromoted = loop.signatures.find((s) => s.category === 'single-org-only');
  assert.equal(promoted.promotedToSharedPack, true);
  assert.equal(promoted.uniqueOrgs, 2);
  assert.equal(promoted.occurrenceCount, 3);
  assert.equal(unpromoted.promotedToSharedPack, false, 'single-org repetition must not promote to shared cross-customer pack');
});

test('buildSaasMoatHonestyReport fails closed on dishonest moat or human-seat-only claims', () => {
  const ready = buildSaasMoatHonestyReport({ repoRoot: ROOT });
  assert.equal(ready.ok, true);
  assert.equal(ready.status, 'ready');
  assert.match(formatSaasMoatHonestyReport(ready), /SaaS Moat & Seat-Compression Honesty \(READY\)/);

  const dishonest = buildSaasMoatHonestyReport({
    repoRoot: ROOT,
    claim: 'Closed-source Core is our moat and we are SOC 2 Type II certified',
  });
  assert.equal(dishonest.ok, false);
  assert.equal(dishonest.status, 'fail');
  assert.ok(dishonest.findings.some((f) => f.id === 'dishonest-moat-claim'));

  const seatTrap = buildSaasMoatHonestyReport({
    repoRoot: ROOT,
    claim: 'We use human seat-based pricing only',
  });
  assert.equal(seatTrap.ok, false);
  assert.ok(seatTrap.findings.some((f) => f.id === 'seat-compression-trap'));
});

test('CLI subcommand saas-moat-honesty outputs valid JSON', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'bin', 'cli.js'), 'saas-moat-honesty', '--json', '--map-only'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.railMap.length, 8);
});
