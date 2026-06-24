'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APPROVAL_PHRASE,
  OKARA_GA_GSC_APPROVAL_PHRASE,
  REQUIRED_CHANNELS,
  WEB_SOURCE_INPUTS,
  buildArtifacts,
  buildAutomationPack,
  buildScore,
  buildZaiAccelerationStatus,
  parseArgs,
  writeArtifacts,
} = require('../scripts/okara-money-promo-automation');

test('parseArgs supports write, json, date, and report-dir flags', () => {
  assert.deepEqual(
    parseArgs(['--write', '--json', '--date=2026-06-23', '--report-dir', 'reports/gtm/custom']),
    {
      write: true,
      json: true,
      date: '2026-06-23',
      reportDir: 'reports/gtm/custom',
    },
  );
});

test('buildScore prioritizes warm money stages without exceeding 100', () => {
  assert.equal(buildScore({ contacted: 26, replied: 3, checkout_started: 1, sprint_intake: 1, paid: 0 }), 73);
  assert.equal(buildScore({ contacted: 2, replied: 0, checkout_started: 0, sprint_intake: 0, paid: 0 }), 2);
});

test('buildAutomationPack encodes Okara, SEO/GEO, agentic RL, and approval boundaries', () => {
  const pack = buildAutomationPack({
    date: '2026-06-23',
    generatedAt: '2026-06-23T18:00:00.000Z',
    evidence: {
      links: {
        appOrigin: 'https://thumbgate.ai',
        proCheckoutLink: 'https://thumbgate.ai/checkout/pro',
        proPriceLabel: '$19/mo or $149/yr',
      },
      pipeline: {
        byStage: {
          contacted: 26,
          replied: 3,
          checkout_started: 1,
          sprint_intake: 1,
          paid: 0,
        },
      },
      stripe: {
        status: 'missing_secret',
        configured: false,
        revenue: { today: 0 },
      },
      productionHealth: { ok: true, status: 200 },
      checkoutRoute: { ok: true, status: 200 },
    },
  });

  assert.equal(pack.approvalPhrase, APPROVAL_PHRASE);
  assert.equal(pack.okaraGaGscApprovalPhrase, OKARA_GA_GSC_APPROVAL_PHRASE);
  assert.match(pack.okaraBrief.seo, /Google/);
  assert.match(pack.okaraBrief.geo, /ChatGPT/);
  assert.match(pack.safety.directPublishing, /direct platform APIs/);
  assert.equal(pack.zaiAcceleration.provider, 'zai');
  assert.equal(pack.zaiAcceleration.preferred, true);
  assert.equal(pack.evidenceSnapshot.stripeStatus, 'missing_secret');
  assert.equal(pack.nextMoneyAction.approvalPhrase, OKARA_GA_GSC_APPROVAL_PHRASE);
  assert.ok(REQUIRED_CHANNELS.every((channel) => pack.channelPlan.some((entry) => entry.channel === channel)));
  assert.ok(pack.channelPlan.some((entry) => entry.channel === 'Medium' && /Required/.test(entry.rule)));
  assert.ok(pack.webSources.some((source) => /okara\.ai/.test(source.url)));
  assert.ok(pack.productImprovementBacklog.some((item) => /trajectory-level scoring/.test(item.improvement)));
  assert.ok(pack.seoGeoBacklog.some((item) => /seven-agent SEO pipeline/.test(item.improvement)));
});

test('buildArtifacts writes the required brand revenue loop files and no auto-post language', () => {
  const pack = buildAutomationPack({
    date: '2026-06-23',
    generatedAt: '2026-06-23T18:00:00.000Z',
    evidence: {
      pipeline: { byStage: { contacted: 1, paid: 0 } },
      stripe: { status: 'missing_secret', configured: false, revenue: { today: 0 } },
      productionHealth: { ok: true, status: 200 },
      checkoutRoute: { ok: true, status: 200 },
    },
  });
  const artifacts = buildArtifacts(pack);

  for (const name of [
    'EVIDENCE_LEDGER.md',
    'EXECUTION_BOARD.md',
    'BRAND_OPERATING_SYSTEM.md',
    'STAKEHOLDER_TARGET_MAP.md',
    'OUTREACH_APPROVAL_QUEUE.md',
    'LINKEDIN_PROMOTION_QUEUE_2026-06-23.md',
    'LINKEDIN_PREMIUM_FEATURE_COMMAND_BOARD.md',
    'OKARA_SETUP_CHECKLIST.md',
    'SEO_GEO_DATA_CONNECTIONS.md',
    'POST_EVERYWHERE_APPROVAL_QUEUE_2026-06-23.md',
    'DAILY_MONEY_PROMO_AUTOMATION.md',
  ]) {
    assert.ok(artifacts[name], `${name} should be rendered`);
  }

  const joined = Object.values(artifacts).join('\n');
  assert.match(joined, /Do not post, DM, InMail, email/);
  assert.match(joined, /Direct publishing:/);
  assert.match(joined, /Z\.ai Acceleration/);
  assert.match(joined, /Agentic RL/);
  assert.match(joined, /Goldie Ranking Swarm/);
  assert.doesNotMatch(joined, /posted everywhere successfully/i);
});

test('buildZaiAccelerationStatus reports configured state without exposing secrets', () => {
  const status = buildZaiAccelerationStatus({
    ZAI_API_KEY: 'zai-test-secret',
    ZAI_API_MODEL: 'glm-5.2',
  });

  assert.equal(status.configured, true);
  assert.equal(status.model, 'glm-5.2');
  assert.equal(status.secretStatus, 'local_env_only_not_exported');
  assert.doesNotMatch(JSON.stringify(status), /zai-test-secret/);
});

test('writeArtifacts creates report files without external side effects', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-okara-pack-'));
  const pack = buildAutomationPack({
    date: '2026-06-23',
    generatedAt: '2026-06-23T18:00:00.000Z',
    evidence: {
      pipeline: { byStage: { contacted: 1, paid: 0 } },
      stripe: { status: 'missing_secret', configured: false, revenue: { today: 0 } },
      productionHealth: { ok: true, status: 200 },
      checkoutRoute: { ok: true, status: 200 },
    },
  });

  try {
    const written = writeArtifacts(pack, { repoRoot });
    assert.equal(written.files.length, 12);
    assert.ok(fs.existsSync(path.join(written.reportDir, 'okara-money-promo-automation.json')));
    assert.match(
      fs.readFileSync(path.join(written.reportDir, 'SEO_GEO_DATA_CONNECTIONS.md'), 'utf8'),
      /Google Search Console/,
    );
    assert.ok(WEB_SOURCE_INPUTS.some((source) => /agentic-rl/.test(source.url)));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
