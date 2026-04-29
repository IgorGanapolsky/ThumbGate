'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  buildEvidenceBackstop,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildRedditDmWorkflowHardeningPack,
  buildTrackedRedditLink,
  collectPainSignals,
  getWarmRedditTargets,
  renderDraftsCsv,
  renderOperatorQueueCsv,
  renderRedditDmWorkflowHardeningPackMarkdown,
  writeRedditDmWorkflowHardeningPack,
} = require('../scripts/reddit-dm-workflow-hardening-pack');

function makeReportFixture() {
  return {
    generatedAt: '2026-04-29T01:20:00.000Z',
    source: 'hosted-via-railway-env',
    verification: {
      label: 'Live hosted billing summary verified for this run.',
    },
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline. Work the warm Reddit queue before widening cold outreach.',
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'Deep_Ad1959',
        accountName: 'r/cursor',
        contactUrl: 'https://www.reddit.com/user/Deep_Ad1959/',
        evidenceScore: 10,
        evidence: [
          'warm inbound engagement',
          'workflow pain named: rollback risk',
          'already in DMs',
        ],
        outreachAngle: 'Lead with rollback safety and context-drift hardening for one workflow before any generic tool pitch.',
        motionLabel: 'Workflow Hardening Sprint',
        nextOperatorAction: 'Send the first-touch draft and log the outreach in the sales pipeline.',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        pipelineLeadId: 'reddit_deep_ad1959_r_cursor',
        subject: 'Your context-dependent blocking idea',
        firstTouchDraft: 'Your question about rollback risk is exactly the right one.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
        selfServeFollowUpDraft: 'If you want the self-serve path first, start with the guide.',
        checkoutCloseDraft: 'If you are comparing close options, the sprint is the primary path.',
        salesCommands: {
          markContacted: 'npm run sales:pipeline -- advance --lead \'reddit_deep_ad1959_r_cursor\' --stage \'contacted\'',
        },
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'leogodin217',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/leogodin217/',
        evidenceScore: 9,
        evidence: [
          'warm inbound engagement',
          'workflow pain named: review boundaries and context risk',
        ],
        outreachAngle: 'Lead with one repeating failure inside an already-mature workflow and offer an enforceable Pre-Action Check plus proof run.',
        motionLabel: 'Workflow Hardening Sprint',
        nextOperatorAction: 'Send the first-touch draft and log the outreach in the sales pipeline.',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        pipelineLeadId: 'reddit_leogodin217_r_claudecode',
        subject: 'Quick question about AI agent safety in your workflow',
        firstTouchDraft: 'Your workflow is already mature enough for a targeted hardening pass.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
        selfServeFollowUpDraft: 'If you want the self-serve path first, start with the guide.',
        checkoutCloseDraft: 'If you are comparing close options, the sprint is the primary path.',
        salesCommands: {
          markContacted: 'npm run sales:pipeline -- advance --lead \'reddit_leogodin217_r_claudecode\' --stage \'contacted\'',
        },
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'DGouron',
        accountName: 'DGouron',
        contactUrl: 'https://dgouron.fr/',
        evidenceScore: 14,
        evidence: [
          'workflow control surface',
          'business-system integration',
        ],
      },
    ],
  };
}

test('tracked Reddit links keep campaign metadata attached', () => {
  const link = buildTrackedRedditLink('https://thumbgate-production.up.railway.app/guide', {
    utmCampaign: 'reddit_test',
    utmContent: 'guide',
    campaignVariant: 'workflow_risk',
    offerCode: 'REDDIT-TEST',
    ctaId: 'reddit_test_cta',
    ctaPlacement: 'test_surface',
  });

  assert.match(link, /utm_source=reddit/);
  assert.match(link, /utm_medium=reddit_dm/);
  assert.match(link, /utm_campaign=reddit_test/);
  assert.match(link, /campaign_variant=workflow_risk/);
});

test('warm Reddit targets and pain signals stay grounded in the revenue loop report', () => {
  assert.equal(getWarmRedditTargets(makeReportFixture()).length, 2);
  assert.deepEqual(collectPainSignals(makeReportFixture()), [
    'rollback risk',
    'review boundaries and context risk',
  ]);
});

test('evidence backstop counts warm targets, active DMs, and subreddits', () => {
  const backstop = buildEvidenceBackstop(makeReportFixture());

  assert.equal(backstop.warmTargetCount, 2);
  assert.equal(backstop.alreadyInDmCount, 1);
  assert.equal(backstop.subredditCount, 2);
});

test('operator queue and drafts stay tied to the warm Reddit send order', () => {
  const queue = buildOperatorQueue(undefined, makeReportFixture());
  const drafts = buildOutreachDrafts(makeReportFixture());

  assert.equal(queue.length, 2);
  assert.equal(drafts.length, 2);
  assert.match(queue[0].recommendedMotion, /Workflow Hardening Sprint/);
  assert.match(queue[0].proofAsset, /COMMERCIAL_TRUTH\.md/);
  assert.match(drafts[0].draft, /Pain-confirmed follow-up/);
  assert.match(drafts[0].draft, /Track after send/);
});

test('pack exposes the warm Reddit revenue lane without fake claims', () => {
  const pack = buildRedditDmWorkflowHardeningPack(makeReportFixture());

  assert.equal(pack.state, 'cold-start');
  assert.equal(pack.headline, CANONICAL_HEADLINE);
  assert.equal(pack.operatorQueue.length, 2);
  assert.equal(pack.outreachDrafts.length, 2);
  assert.equal(pack.evidenceBackstop.warmTargetCount, 2);
  assert.equal(pack.measurementPlan.northStar, 'reddit_warm_dm_to_paid_intent');
  assert.equal(pack.revenueEvidence.source, 'hosted-via-railway-env');
});

test('rendered markdown and CSV exports expose the Reddit DM send surface', () => {
  const pack = buildRedditDmWorkflowHardeningPack(makeReportFixture());
  const markdown = renderRedditDmWorkflowHardeningPackMarkdown(pack);
  const queueCsv = renderOperatorQueueCsv(pack.operatorQueue);
  const draftsCsv = renderDraftsCsv(pack.outreachDrafts);

  assert.match(markdown, /Reddit DM Workflow Hardening Pack/);
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /Revenue Evidence/);
  assert.match(markdown, /Billing source: hosted-via-railway-env/);
  assert.match(markdown, /Billing verification: Live hosted billing summary verified for this run\./);
  assert.match(markdown, /Pain signal: rollback risk/);
  assert.match(markdown, /Active DM Drafts/);
  assert.doesNotMatch(markdown, /guaranteed revenue|guaranteed installs/i);
  assert.match(queueCsv, /reddit_deep_ad1959_r_cursor/);
  assert.match(draftsCsv, /Your context-dependent blocking idea/);
});

test('writer exports markdown, JSON, and CSV artifacts for the report folder', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reddit-pack-'));

  try {
    const written = writeRedditDmWorkflowHardeningPack(
      buildRedditDmWorkflowHardeningPack(makeReportFixture()),
      { reportDir }
    );

    assert.equal(written.reportDir, reportDir);
    assert.equal(written.docsPath, null);
    assert.equal(fs.existsSync(path.join(reportDir, 'reddit-dm-workflow-hardening-pack.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'reddit-dm-workflow-hardening-pack.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'reddit-dm-operator-queue.csv')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'reddit-dm-drafts.csv')), true);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});
