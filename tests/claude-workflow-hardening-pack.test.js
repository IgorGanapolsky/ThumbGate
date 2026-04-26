const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CLAUDE_BUNDLE_URL,
  CLAUDE_CODE_GUIDE_URL,
  CLAUDE_DESKTOP_GUIDE_URL,
  CLAUDE_REVIEW_PACKET_URL,
  buildClaudeWorkflowHardeningPack,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildListingCopy,
  buildMeasurementPlan,
  buildProspectQueue,
  buildTrackedClaudeLink,
  isCliInvocation,
  renderClaudeProspectQueueCsv,
  renderClaudeWorkflowHardeningPackMarkdown,
  writeClaudeWorkflowHardeningPack,
} = require('../scripts/claude-workflow-hardening-pack');

function makeReportFixture() {
  return {
    generatedAt: '2026-04-26T10:30:00.000Z',
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline. Use the Claude install lane to create proof-backed paid intent, not vanity distribution.',
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
        motionLabel: 'ThumbGate Pro',
        motionReason: 'Self-serve tooling path is explicit.',
        outreachAngle: 'Lead with rollout proof for one production workflow.',
        cta: 'https://thumbgate-production.up.railway.app/checkout/pro',
      },
    ],
  };
}

test('tracked Claude links keep UTM and conversion metadata attached', () => {
  const link = buildTrackedClaudeLink(CLAUDE_DESKTOP_GUIDE_URL, {
    utmCampaign: 'claude_test',
    utmContent: 'guide',
    campaignVariant: 'desktop_install',
    offerCode: 'CLAUDE-TEST',
    ctaId: 'claude_test_cta',
    ctaPlacement: 'test_surface',
  });

  assert.match(link, /utm_source=claude/);
  assert.match(link, /utm_campaign=claude_test/);
  assert.match(link, /campaign_variant=desktop_install/);
  assert.match(link, /offer_code=CLAUDE-TEST/);
  assert.match(link, /cta_id=claude_test_cta/);
});

test('verified Claude surfaces stay tied to real install and guide assets', () => {
  const surfaces = buildEvidenceSurfaces();

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'claude_desktop_guide',
    'claude_code_repeat_mistakes_guide',
    'claude_bundle_download',
    'claude_review_ready_lane',
  ]);
  assert.equal(surfaces[0].supportUrl.includes('claude-desktop.html'), true);
  assert.equal(surfaces[1].url.includes(CLAUDE_CODE_GUIDE_URL), true);
  assert.equal(surfaces[2].url, CLAUDE_BUNDLE_URL);
  assert.equal(surfaces[3].supportUrl.includes('CLAUDE_DESKTOP_EXTENSION.md'), true);
});

test('listing copy stays install-first and avoids fake approval claims', () => {
  const listingCopy = buildListingCopy();

  assert.equal(listingCopy.headline.includes('Install ThumbGate for Claude'), true);
  assert.equal(listingCopy.shortDescription.includes('Pre-Action Checks'), true);
  assert.equal(listingCopy.secondaryCta.url, CLAUDE_BUNDLE_URL);
  assert.equal(listingCopy.marketplaceNote.includes('Official directory review is separate'), true);
  assert.equal(listingCopy.followOnOffers.length, 2);
  assert.equal(listingCopy.followOnOffers[0].url.includes('workflow_sprint'), true);
});

test('prospect queue stays grounded in current report targets', () => {
  const queue = buildProspectQueue(makeReportFixture());

  assert.equal(queue.length, 3);
  assert.equal(queue[0].account, '@claude_builder');
  assert.equal(queue[1].account, 'freema/mcp-jira-stdio');
  assert.equal(queue[1].evidence.includes('business-system integration'), true);
  assert.equal(queue[2].motion, 'ThumbGate Pro');
});

test('active channel drafts stay tied to live Claude surfaces and first-touch guardrails', () => {
  const drafts = buildChannelDrafts(makeReportFixture());

  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((draft) => draft.channel), [
    'Reddit',
    'LinkedIn',
    'Threads',
    'Bluesky',
  ]);
  assert.equal(drafts[0].cta.includes('#workflow-sprint-intake'), true);
  assert.equal(drafts[1].cta.includes('#claude-desktop'), true);
  assert.equal(drafts[2].cta.includes(CLAUDE_DESKTOP_GUIDE_URL), true);
  assert.equal(drafts[3].cta.includes(CLAUDE_CODE_GUIDE_URL), true);
  assert.equal(drafts.every((draft) => !draft.draft.includes('VERIFICATION_EVIDENCE.md')), true);
  assert.equal(drafts.every((draft) => !draft.draft.includes('COMMERCIAL_TRUTH.md')), true);
});

test('pack includes verified surfaces, listing copy, measurement plan, and evidence backstop', () => {
  const pack = buildClaudeWorkflowHardeningPack(makeReportFixture());

  assert.equal(pack.headline, CANONICAL_HEADLINE);
  assert.equal(pack.surfaces.length, 4);
  assert.equal(pack.listingCopy.followOnOffers.length, 2);
  assert.equal(pack.outreachDrafts.length, 3);
  assert.equal(pack.channelDrafts.length, 4);
  assert.equal(pack.measurementPlan.northStar, 'claude_install_to_paid_intent');
  assert.equal(pack.evidenceBackstop.warmClaudeTargetCount, 1);
  assert.equal(pack.evidenceBackstop.productionTargetCount, 2);
  assert.equal(pack.evidenceBackstop.businessSystemTargetCount, 1);
  assert.equal(pack.evidenceBackstop.reviewPacketUrl, CLAUDE_REVIEW_PACKET_URL);
});

test('measurement plan keeps approval and revenue guardrails explicit', () => {
  const measurementPlan = buildMeasurementPlan();

  assert.equal(measurementPlan.metrics.includes('claude_bundle_downloads'), true);
  assert.equal(measurementPlan.guardrails.some((entry) => /directory approval/.test(entry)), true);
  assert.equal(measurementPlan.doNotCountAsSuccess.includes('unverified directory approval or revenue claims'), true);
});

test('rendered markdown exposes listing copy, prospect queue, and proof backstop', () => {
  const pack = buildClaudeWorkflowHardeningPack(makeReportFixture());
  const markdown = renderClaudeWorkflowHardeningPackMarkdown(pack);

  assert.match(markdown, /Claude Workflow Hardening Pack/);
  assert.match(markdown, /Marketplace Listing Copy/);
  assert.match(markdown, /Verified Claude Surfaces/);
  assert.match(markdown, /Prospect Queue/);
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /LinkedIn — Founder post/);
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /claude_install_to_paid_intent/);
  assert.match(markdown, /Official directory review is separate/);
  assert.doesNotMatch(markdown, /official partner|approved today|booked revenue exists/i);
});

test('prospect queue CSV exports operator-ready rows', () => {
  const csv = renderClaudeProspectQueueCsv(buildClaudeWorkflowHardeningPack(makeReportFixture()));

  assert.match(csv, /^key,account,temperature,motion,reason,evidence,sourceUrl,nextAsk/m);
  assert.match(csv, /freema\/mcp-jira-stdio/);
  assert.match(csv, /business-system integration/);
});

test('writer exports markdown, JSON, and CSV artifacts for the report folder', () => {
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
    assert.equal(fs.existsSync(path.join(reportDir, 'claude-prospect-queue.csv')), true);

    const json = JSON.parse(fs.readFileSync(path.join(reportDir, 'claude-workflow-hardening-pack.json'), 'utf8'));
    assert.equal(json.surfaces[0].key, 'claude_desktop_guide');
    assert.equal(json.prospectQueue[1].account, 'freema/mcp-jira-stdio');
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('CLI invocation helper matches the script path only', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'claude-workflow-hardening-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'claude-workflow-hardening-pack.test.js')]), false);
});
