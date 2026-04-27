const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildLeadFromRevenueTarget } = require('../scripts/sales-pipeline');
const {
  buildOutreachTargetsReport,
  isCliInvocation,
  renderOutreachTargetsMarkdown,
  writeOutreachTargetsDoc,
} = require('../scripts/github-outreach');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-github-outreach-'));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function makeWarmTarget() {
  return {
    temperature: 'warm',
    source: 'reddit',
    channel: 'reddit_dm',
    username: 'game-of-kton',
    accountName: 'r/cursor',
    contactUrl: 'https://www.reddit.com/user/game-of-kton/',
    evidenceScore: 9,
    evidence: ['warm inbound engagement', 'workflow pain named: stale context'],
    motionReason: 'Warm workflow pain already exists.',
    cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
    firstTouchDraft: 'I can harden one workflow for you this week.',
    painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    salesCommands: {
      markContacted: 'npm run sales:pipeline -- advance --lead \'reddit_game_of_kton_r_cursor\' --stage \'contacted\'',
      markReplied: 'npm run sales:pipeline -- advance --lead \'reddit_game_of_kton_r_cursor\' --stage \'replied\'',
      markCallBooked: 'npm run sales:pipeline -- advance --lead \'reddit_game_of_kton_r_cursor\' --stage \'call_booked\'',
    },
  };
}

function makeColdTarget() {
  return {
    temperature: 'cold',
    source: 'github',
    channel: 'github',
    username: 'DGouron',
    accountName: 'DGouron',
    repoName: 'review-flow',
    repoUrl: 'https://github.com/DGouron/review-flow',
    contactUrl: 'https://dgouron.fr/',
    evidenceScore: 14,
    evidence: ['workflow control surface', 'business-system integration', '36 GitHub stars'],
    motionReason: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
    cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
    firstTouchDraft: 'Hey @DGouron, if one approval or rollback step keeps creating trouble, I can harden that workflow for you.',
    painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    salesCommands: {
      markContacted: 'npm run sales:pipeline -- advance --lead \'github_dgouron_review_flow\' --stage \'contacted\'',
      markReplied: 'npm run sales:pipeline -- advance --lead \'github_dgouron_review_flow\' --stage \'replied\'',
      markCallBooked: 'npm run sales:pipeline -- advance --lead \'github_dgouron_review_flow\' --stage \'call_booked\'',
    },
  };
}

test('queue-backed outreach report keeps warm and cold targets tied to current evidence', () => {
  const tempDir = makeTempDir();
  const queuePath = path.join(tempDir, 'gtm-target-queue.jsonl');
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  writeJsonl(queuePath, [makeWarmTarget(), makeColdTarget()]);
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: '2026-04-27T17:00:00.000Z',
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline.',
    },
  }, null, 2));

  const report = buildOutreachTargetsReport({ queuePath, reportPath, statePath });
  const markdown = renderOutreachTargetsMarkdown(report);
  const outPath = writeOutreachTargetsDoc(markdown, path.join(tempDir, 'OUTREACH_TARGETS.md'));

  assert.equal(report.followUpTargets.length, 0);
  assert.equal(report.warmTargets.length, 1);
  assert.equal(report.coldTargets.length, 1);
  assert.equal(report.pipelineTrackedLeadCount, 0);
  assert.equal(report.pipelineExists, false);
  assert.match(markdown, /mirrors the evidence-backed GTM queue/i);
  assert.match(markdown, /Warm discovery ready: 1/);
  assert.match(markdown, /Cold GitHub ready: 1/);
  assert.match(markdown, /review-flow/);
  assert.match(markdown, /stage 'contacted'/);
  assert.equal(fs.existsSync(outPath), true);
});

test('active follow-ups are promoted ahead of fresh sends using sales ledger state', () => {
  const tempDir = makeTempDir();
  const queuePath = path.join(tempDir, 'gtm-target-queue.jsonl');
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const warmTarget = makeWarmTarget();
  const coldTarget = makeColdTarget();
  const lead = buildLeadFromRevenueTarget(coldTarget, { sourcePath: queuePath });

  writeJsonl(queuePath, [warmTarget, coldTarget]);
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: '2026-04-27T17:00:00.000Z',
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline.',
    },
  }, null, 2));
  writeJsonl(statePath, [{
    ...lead,
    stage: 'replied',
    updatedAt: '2026-04-27T17:10:00.000Z',
  }]);

  const report = buildOutreachTargetsReport({ queuePath, reportPath, statePath });
  const markdown = renderOutreachTargetsMarkdown(report);

  assert.equal(report.followUpTargets.length, 1);
  assert.equal(report.followUpTargets[0].stage, 'replied');
  assert.equal(report.warmTargets.length, 1);
  assert.equal(report.coldTargets.length, 0);
  assert.equal(report.pipelineTrackedLeadCount, 1);
  assert.equal(report.pipelineExists, true);
  assert.match(markdown, /## Follow Up Now/);
  assert.match(markdown, /Current stage: replied/);
  assert.match(markdown, /stage 'call_booked'/);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = require.resolve('../scripts/github-outreach');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
