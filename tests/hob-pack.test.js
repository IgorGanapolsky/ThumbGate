const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APPROVAL_PHRASE,
  LINKS,
  buildArtifacts,
  buildHobPack,
  parseArgs,
  writeHobArtifacts,
} = require('../scripts/hob-pack');

function sampleEvidence() {
  return {
    generatedAt: '2026-06-24T17:00:00.000Z',
    production: {
      healthObserved: 'HTTP 200 JSON status ok, version 1.27.15.',
      checkoutObserved: 'HTTP 200 for /checkout/pro.',
    },
    pipeline: {
      summary: {
        byStage: {
          contacted: 27,
          replied: 3,
          sprint_intake: 2,
          paid: 0,
        },
        paid: 0,
        bookedRevenueCents: 0,
      },
    },
    stripe: {
      status: 'missing_secret',
    },
  };
}

test('buildHobPack creates the reusable HOB implementation assets', () => {
  const pack = buildHobPack({
    date: '2026-06-24',
    generatedAt: '2026-06-24T17:00:00.000Z',
    evidence: sampleEvidence(),
  });

  const assetKeys = pack.reusableAssets.map((asset) => asset.key);

  assert.deepEqual(assetKeys, [
    'red_team_traps',
    'juror_personas',
    'scoring_guidelines',
    'fallback_policy_gates',
    'evidence_receipts',
  ]);
  assert.match(pack.thesis, /runtime side/i);
  assert.equal(pack.links.paper, 'https://arxiv.org/abs/2606.16871');
  assert.equal(pack.offer.name, 'Human-on-the-Bridge Workflow Hardening Sprint');
});

test('content queue preserves Gatekeeper exposure without putting partner links into Reddit by default', () => {
  const pack = buildHobPack({
    generatedAt: '2026-06-24T17:00:00.000Z',
    evidence: sampleEvidence(),
  });
  const linkedIn = pack.contentQueue.find((entry) => entry.platform === 'LinkedIn');
  const medium = pack.contentQueue.find((entry) => entry.platform === 'Medium');
  const reddit = pack.contentQueue.find((entry) => entry.platform === 'Reddit');

  assert.ok(linkedIn.requiredLinks.includes(LINKS.gatekeeper));
  assert.ok(medium.requiredLinks.includes(LINKS.gatekeeper));
  assert.ok(medium.requiredLinks.includes(LINKS.thumbgateGatekeeperCompare));
  assert.ok(!reddit.requiredLinks.includes(LINKS.gatekeeper));
  assert.ok(reddit.requiredLinks.includes(LINKS.thumbgateRepo));
  assert.match(linkedIn.text, /Gatekeeper by Oak & Sparrow/);
  assert.match(linkedIn.text, /ThumbGate/);
});

test('artifacts are approval-gated and avoid false publish or revenue claims', () => {
  const pack = buildHobPack({
    generatedAt: '2026-06-24T17:00:00.000Z',
    evidence: sampleEvidence(),
  });
  const artifacts = buildArtifacts(pack);
  const combined = Object.values(artifacts).join('\n');

  assert.match(artifacts['HOB_CONTENT_QUEUE_2026-06-24.md'], new RegExp(APPROVAL_PHRASE));
  assert.match(artifacts['HOB_OUTREACH_QUEUE.md'], /Do not send any message/);
  assert.doesNotMatch(combined, /published successfully/i);
  assert.doesNotMatch(combined, /sent successfully/i);
  assert.doesNotMatch(combined, /same-day paid revenue is proven/i);
  assert.doesNotMatch(combined, /produced same-day paid revenue/i);
  assert.match(artifacts['EVIDENCE_LEDGER.md'], /no same-day paid event is proven/i);
});

test('writeHobArtifacts writes the complete GTM pack', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-hob-pack-'));
  const pack = buildHobPack({
    generatedAt: '2026-06-24T17:00:00.000Z',
    evidence: sampleEvidence(),
  });

  const result = writeHobArtifacts(pack, {
    repoRoot: tmpRoot,
    reportDir: 'reports/gtm/test-hob-pack',
  });

  assert.equal(result.files.length, 6);
  assert.ok(fs.existsSync(path.join(result.reportDir, 'EVIDENCE_LEDGER.md')));
  assert.ok(fs.existsSync(path.join(result.reportDir, 'HOB_PACK.md')));
  assert.ok(fs.existsSync(path.join(result.reportDir, 'HOB_REVENUE_SPRINT.md')));
  assert.ok(fs.existsSync(path.join(result.reportDir, 'HOB_CONTENT_QUEUE_2026-06-24.md')));
  assert.ok(fs.existsSync(path.join(result.reportDir, 'HOB_OUTREACH_QUEUE.md')));
  assert.ok(fs.existsSync(path.join(result.reportDir, 'hob-pack.json')));
});

test('parseArgs supports write, date, and custom report directory', () => {
  assert.deepEqual(parseArgs([
    '--write',
    '--date',
    '2026-06-25',
    '--report-dir=reports/gtm/custom',
  ]), {
    write: true,
    reportDir: 'reports/gtm/custom',
    date: '2026-06-25',
  });
});
