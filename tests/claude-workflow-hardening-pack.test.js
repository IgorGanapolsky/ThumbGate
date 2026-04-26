const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildBuyerLanes,
  buildClaudeWorkflowHardeningPack,
  buildSignalSummary,
  renderClaudeWorkflowHardeningPackMarkdown,
  writeClaudeWorkflowHardeningPack,
} = require('../scripts/claude-workflow-hardening-pack');

function makeReportFixture() {
  return {
    generatedAt: '2026-04-26T02:00:00.000Z',
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline. Stop treating posts as sales; directly sell one Workflow Hardening Sprint.',
    },
    currentTruth: {
      teamPilotOffer: 'Workflow Hardening Sprint',
      publicSelfServeOffer: 'Pro at $19/mo or $149/yr',
      commercialTruthLink: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md',
      verificationEvidenceLink: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'claude_builder',
        accountName: 'r/ClaudeCode',
        repoName: '',
        repoUrl: '',
        description: 'Named review boundaries and context risk in a mature Claude workflow.',
        evidence: ['warm inbound engagement'],
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Warm Claude workflow pain is already explicit.',
        outreachAngle: 'Lead with one repeated workflow failure inside an already-mature Claude workflow.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'adaptive_guardrails',
        accountName: 'r/ClaudeCode',
        repoName: '',
        repoUrl: '',
        description: 'Called out brittle guardrails that fail under context shift.',
        evidence: ['warm inbound engagement'],
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Warm Claude workflow pain is already explicit.',
        outreachAngle: 'Lead with brittle-guardrail workflow pain.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'freema',
        accountName: 'freema',
        repoName: 'mcp-jira-stdio',
        repoUrl: 'https://github.com/freema/mcp-jira-stdio',
        description: 'Claude-friendly Jira workflow automation with approvals and rollback safety.',
        evidence: ['workflow control surface', 'business-system integration', 'production or platform workflow'],
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Jira workflows need approval boundaries.',
        outreachAngle: 'Lead with approval boundaries, rollback safety, and proof.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'WagnerAgent',
        accountName: 'WagnerAgent',
        repoName: 'awesome-mcp-servers-devops',
        repoUrl: 'https://github.com/WagnerAgent/awesome-mcp-servers-devops',
        description: 'Production workflow tooling for agent operators.',
        evidence: ['production or platform workflow'],
        motion: 'pro',
        motionLabel: 'Pro at $19/mo or $149/yr',
        motionReason: 'Self-serve tooling path is explicit.',
        outreachAngle: 'Lead with rollout proof for one production workflow.',
        cta: 'https://thumbgate-production.up.railway.app/checkout/pro',
      },
    ],
  };
}

test('signal summary stays tied to Claude, production, and business-system evidence', () => {
  const signals = buildSignalSummary(makeReportFixture());

  assert.deepEqual(signals.map((entry) => entry.key), [
    'warm_claude_workflows',
    'production_rollout',
    'business_system_approvals',
  ]);
  assert.equal(signals[0].count, 2);
  assert.equal(signals[1].count, 2);
  assert.equal(signals[2].count, 1);
});

test('buyer lanes stay workflow-hardening-first and do not lead with proof', () => {
  const lanes = buildBuyerLanes(makeReportFixture());

  assert.ok(lanes.some((lane) => /Claude-first builders/.test(lane.audience)));
  assert.ok(lanes.some((lane) => /Platform teams/.test(lane.audience)));
  assert.ok(lanes.some((lane) => /Jira, ServiceNow, Slack/.test(lane.audience)));
  assert.ok(lanes.every((lane) => /harden/.test(lane.firstTouchDraft)));
  assert.ok(lanes.every((lane) => !/VERIFICATION_EVIDENCE|COMMERCIAL_TRUTH/.test(lane.firstTouchDraft)));
});

test('rendered pack is operator-ready and anchored to proof links', () => {
  const pack = buildClaudeWorkflowHardeningPack(makeReportFixture());
  const markdown = renderClaudeWorkflowHardeningPackMarkdown(pack);

  assert.match(markdown, /Claude Workflow Hardening Pack/);
  assert.match(markdown, /Make one Claude-first workflow safe enough to ship team-wide/);
  assert.match(markdown, /Workflow Hardening Sprint/);
  assert.match(markdown, /Pro at \$19\/mo or \$149\/yr/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /official partner|booked revenue exists/i);
});

test('writer exports markdown and JSON artifacts for the operator report folder', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claude-pack-'));

  try {
    const written = writeClaudeWorkflowHardeningPack(
      buildClaudeWorkflowHardeningPack(makeReportFixture()),
      { reportDir }
    );

    assert.equal(written.reportDir, reportDir);
    assert.equal(written.docsPath, null);
    assert.equal(fs.existsSync(path.join(reportDir, 'claude-workflow-hardening-pack.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'claude-workflow-hardening-pack.json')), true);

    const json = JSON.parse(fs.readFileSync(path.join(reportDir, 'claude-workflow-hardening-pack.json'), 'utf8'));
    assert.equal(json.signals[0].key, 'warm_claude_workflows');
    assert.equal(json.buyerLanes[0].key, 'claude_first_workflow_owner');
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});
