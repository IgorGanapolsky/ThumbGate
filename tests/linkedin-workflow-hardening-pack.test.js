'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  GUIDE_URL,
  REPEAT_MISTAKES_GUIDE_URL,
  buildChannelDrafts,
  buildEvidenceBackstop,
  buildEvidenceSurfaces,
  buildLinkedinWorkflowHardeningPack,
  buildOperatorQueue,
  buildTrackedLinkedinLink,
  collectPainSignals,
  isCliInvocation,
  renderLinkedinWorkflowHardeningPackMarkdown,
  writeLinkedinWorkflowHardeningPack,
} = require('../scripts/linkedin-workflow-hardening-pack');

function makeReportFixture() {
  return {
    generatedAt: '2026-04-27T17:22:01.540Z',
    source: 'hosted-via-railway-env',
    verification: {
      label: 'Live hosted billing summary verified for this run.',
    },
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline. Keep one Workflow Hardening Sprint offer live, then route self-serve buyers to Pro only after the buyer asks for the tool path.',
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'Deep_Ad1959',
        accountName: 'r/cursor',
        repoName: '',
        repoUrl: '',
        description: 'Asked how rollback rates change when agent context shifts.',
        evidence: [
          'warm inbound engagement',
          'workflow pain named: rollback risk',
        ],
        motion: 'sprint',
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'leogodin217',
        accountName: 'r/ClaudeCode',
        repoName: '',
        repoUrl: '',
        description: 'Shared a mature workflow with review phases and context risk.',
        evidence: [
          'warm inbound engagement',
          'workflow pain named: review boundaries and context risk',
        ],
        motion: 'sprint',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'Adqui9608',
        accountName: 'Adqui9608',
        repoName: 'ai-code-review-agent',
        repoUrl: 'https://github.com/Adqui9608/ai-code-review-agent',
        description: 'Production workflow approvals and review routing.',
        evidence: [
          'workflow control surface',
          'production or platform workflow',
          'business-system integration',
        ],
        motion: 'sprint',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'solo-builder',
        accountName: 'solo-builder',
        repoName: 'mcp-demo-template',
        repoUrl: 'https://github.com/solo-builder/mcp-demo-template',
        description: 'Template repo for solo builders.',
        evidence: [
          'workflow control surface',
        ],
        motion: 'pro',
      },
    ],
  };
}

test('tracked LinkedIn links keep workflow-hardening campaign metadata attached', () => {
  const link = buildTrackedLinkedinLink(GUIDE_URL, {
    utmCampaign: 'linkedin_test',
    utmContent: 'guide',
    campaignVariant: 'workflow_risk',
    offerCode: 'LINKEDIN-TEST',
    ctaId: 'linkedin_test_cta',
    ctaPlacement: 'test_surface',
  });

  assert.match(link, /utm_source=linkedin/);
  assert.match(link, /utm_campaign=linkedin_test/);
  assert.match(link, /campaign_variant=workflow_risk/);
  assert.match(link, /offer_code=LINKEDIN-TEST/);
  assert.match(link, /cta_id=linkedin_test_cta/);
});

test('pain-signal extraction stays grounded in report evidence', () => {
  assert.deepEqual(collectPainSignals(makeReportFixture()), [
    'rollback risk',
    'review boundaries and context risk',
  ]);
});

test('evidence backstop counts warm, production, and self-serve motions', () => {
  const backstop = buildEvidenceBackstop(makeReportFixture());

  assert.equal(backstop.warmTargetCount, 2);
  assert.equal(backstop.productionTargetCount, 1);
  assert.equal(backstop.businessSystemTargetCount, 1);
  assert.equal(backstop.workflowControlSurfaceCount, 2);
  assert.equal(backstop.sprintMotionCount, 3);
  assert.equal(backstop.proMotionCount, 1);
});

test('verified LinkedIn surfaces stay tied to real public workflow and proof assets', () => {
  const surfaces = buildEvidenceSurfaces();

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'workflow_sprint_intake',
    'proof_backed_setup_guide',
    'repeat_mistakes_guide',
    'verification_evidence',
  ]);
  assert.equal(surfaces[0].supportUrl.includes('landing-page.html'), true);
  assert.equal(surfaces[1].url.includes(GUIDE_URL), true);
  assert.equal(surfaces[2].url.includes(REPEAT_MISTAKES_GUIDE_URL), true);
  assert.match(surfaces[3].url, /VERIFICATION_EVIDENCE\.md/);
});

test('operator queue stays tied to warm pain, business-system risk, and self-serve follow-on', () => {
  const queue = buildOperatorQueue(undefined, makeReportFixture());

  assert.equal(queue.length, 3);
  assert.match(queue[0].evidence, /rollback risk/);
  assert.match(queue[1].evidence, /business-system/);
  assert.match(queue[2].recommendedMotion, /Guide -> proof -> Pro/);
});

test('LinkedIn channel drafts stay workflow-first and keep proof out of the public post', () => {
  const drafts = buildChannelDrafts(undefined, makeReportFixture());

  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map((draft) => draft.format), [
    'Founder post',
    'First comment',
    'Reply or DM follow-up',
  ]);
  assert.equal(drafts[0].cta.includes(GUIDE_URL), true);
  assert.equal(drafts[1].cta.includes('#workflow-sprint-intake'), true);
  assert.equal(drafts[2].cta.includes(REPEAT_MISTAKES_GUIDE_URL), true);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md|COMMERCIAL_TRUTH\.md/);
});

test('pack includes evidence backstop, LinkedIn drafts, and proof-linked follow-on offers', () => {
  const pack = buildLinkedinWorkflowHardeningPack(makeReportFixture());

  assert.equal(pack.state, 'cold-start');
  assert.equal(pack.headline, CANONICAL_HEADLINE);
  assert.match(pack.summary, /No verified revenue and no active pipeline/);
  assert.doesNotMatch(pack.summary, /Revenue is proven/i);
  assert.equal(pack.surfaces.length, 4);
  assert.equal(pack.followOnOffers.length, 2);
  assert.equal(pack.operatorQueue.length, 3);
  assert.equal(pack.channelDrafts.length, 3);
  assert.equal(pack.evidenceBackstop.warmTargetCount, 2);
  assert.equal(pack.evidenceBackstop.proMotionCount, 1);
  assert.equal(pack.measurementPlan.northStar, 'linkedin_workflow_risk_to_paid_intent');
  assert.equal(pack.revenueEvidence.source, 'hosted-via-railway-env');
});

test('rendered markdown exposes LinkedIn drafts and evidence backstop without fake claims', () => {
  const markdown = renderLinkedinWorkflowHardeningPackMarkdown(
    buildLinkedinWorkflowHardeningPack(makeReportFixture())
  );

  assert.match(markdown, /LinkedIn Workflow Hardening Pack/);
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /Revenue Evidence/);
  assert.match(markdown, /Billing source: hosted-via-railway-env/);
  assert.match(markdown, /Billing verification: Live hosted billing summary verified for this run\./);
  assert.match(markdown, /Named pain signals: rollback risk, review boundaries and context risk/);
  assert.doesNotMatch(markdown, /approved marketplace|guaranteed revenue|guaranteed installs/i);
});

test('writer exports markdown, JSON, and CSV artifacts for the report folder', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-linkedin-pack-'));

  try {
    const written = writeLinkedinWorkflowHardeningPack(
      buildLinkedinWorkflowHardeningPack(makeReportFixture()),
      { reportDir }
    );

    assert.equal(written.reportDir, reportDir);
    assert.equal(written.docsPath, null);
    assert.equal(fs.existsSync(path.join(reportDir, 'linkedin-workflow-hardening-pack.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'linkedin-workflow-hardening-pack.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'linkedin-operator-queue.csv')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'linkedin-channel-drafts.csv')), true);

    const json = JSON.parse(fs.readFileSync(path.join(reportDir, 'linkedin-workflow-hardening-pack.json'), 'utf8'));
    assert.equal(json.evidenceBackstop.warmTargetCount, 2);
    assert.equal(json.channelDrafts[0].format, 'Founder post');
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('CLI invocation helper matches the script path only', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'linkedin-workflow-hardening-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
