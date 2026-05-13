'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GITHUB_MCP_SECURITY_ARTICLE_URL,
  RED_HAT_SKILLS_ARTICLE_URL,
  SKILLS_LIBRARY_ARTICLE_URL,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildSkillsLibraryEnforcementPack,
  buildTrackedSkillsLink,
  deriveCommercialState,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderChannelDraftsCsv,
  renderSkillsLibraryEnforcementPackMarkdown,
  renderSkillsLibraryOperatorQueueCsv,
  writeSkillsLibraryEnforcementPack,
} = require('../scripts/skills-library-enforcement-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

const ABOUT_FIXTURE = {
  repositoryUrl: 'https://github.com/IgorGanapolsky/ThumbGate',
  homepageUrl: 'https://thumbgate-production.up.railway.app',
};

const REPORT_FIXTURE = {
  directive: {
    state: 'post-first-dollar',
    headline: 'Verified customer revenue is $0. Keep selling one concrete Workflow Hardening Sprint first.',
  },
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-skills-library-'));
}

test('evidence surfaces attach ThumbGate to the skills-library narrative without endorsement claims', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'skills_library_article',
    'red_hat_skill_packs',
    'github_mcp_security',
    'thumbgate_setup_path',
  ]);
  assert.equal(surfaces[0].sourceUrl, SKILLS_LIBRARY_ARTICLE_URL);
  assert.equal(surfaces[1].sourceUrl, RED_HAT_SKILLS_ARTICLE_URL);
  assert.equal(surfaces[2].sourceUrl, GITHUB_MCP_SECURITY_ARTICLE_URL);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/featured|endorsed|mentioned by|customer|paid traction/i.test(surface.operatorUse)));
});

test('tracked skills links keep campaign attribution machine-readable', () => {
  const url = new URL(buildTrackedSkillsLink('https://thumbgate-production.up.railway.app/guide', {
    utmMedium: 'x_reply',
    utmCampaign: 'skills_library_x_reply',
    utmContent: 'setup_guide',
    campaignVariant: 'x_reply',
    offerCode: 'TNS-SKILLS_X_REPLY',
    ctaId: 'tns_skills_x_reply',
    ctaPlacement: 'reply_followup',
  }));

  assert.equal(url.searchParams.get('utm_source'), 'thenewstack');
  assert.equal(url.searchParams.get('utm_medium'), 'x_reply');
  assert.equal(url.searchParams.get('utm_campaign'), 'skills_library_x_reply');
  assert.equal(url.searchParams.get('surface'), 'skills_library_enforcement');
  assert.equal(url.searchParams.get('cta_id'), 'tns_skills_x_reply');
});

test('operator queue prioritizes public reply, founder post, and platform DM motions', () => {
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(queue.map((row) => row.key), [
    'x_reply_skills_library',
    'linkedin_founder_post',
    'platform_team_dm',
  ]);
  assert.match(queue[0].recommendedMotion, /enforcement thesis first/i);
  assert.match(queue[1].recommendedMotion, /Founder post -> comments/i);
  assert.match(queue[2].evidence, /verified-customer-revenue-zero/);
});

test('commercial state refuses to propagate stale post-first-dollar labels when verified revenue is zero', () => {
  assert.equal(deriveCommercialState(REPORT_FIXTURE), 'verified-customer-revenue-zero');
  assert.equal(deriveCommercialState({ directive: { state: 'cold-start' } }), 'cold-start');
});

test('channel drafts are postable, constrained, and do not lead with proof links', () => {
  const drafts = buildChannelDrafts(LINKS_FIXTURE);
  const xDraft = drafts.find((draft) => draft.key === 'x_reply');

  assert.equal(drafts.length, 3);
  assert.equal(xDraft.channel, 'X');
  assert.ok(xDraft.draft.length <= 280);
  assert.match(xDraft.draft, /pre-action gate/i);
  assert.ok(drafts.every((draft) => !draft.draft.includes('VERIFICATION_EVIDENCE.md')));
  assert.ok(drafts.every((draft) => !draft.draft.includes('COMMERCIAL_TRUTH.md')));
  assert.ok(drafts.every((draft) => !/featured|endorsed|mentioned by|paying customers|revenue/i.test(draft.draft)));
});

test('follow-on offers stay tied to pain-confirmed Pro or sprint conversion', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /skills_library_pro_follow_on/);
  assert.match(offers[1].cta, /skills_library_sprint_follow_on/);
});

test('measurement plan counts named workflow pain, not vanity engagement', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'skills_library_to_qualified_workflow');
  assert.match(plan.policy, /named repeated failure/i);
  assert.ok(plan.metrics.includes('named_repeated_failure_count'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /Likes without replies/i.test(entry)));
  assert.ok(plan.guardrails.some((entry) => /Do not claim revenue/i.test(entry)));
});

test('rendered pack is operator-ready and honest about commercial proof', () => {
  const pack = buildSkillsLibraryEnforcementPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderSkillsLibraryEnforcementPackMarkdown({
    ...pack,
    generatedAt: '2026-05-13T12:00:00.000Z',
  });

  assert.match(markdown, /Skills Library Enforcement Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /Channel Drafts/);
  assert.match(markdown, /The New Stack skills-library article/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /verified-customer-revenue-zero/);
  assert.doesNotMatch(markdown, /featured by|endorsed by|paying customers|verified revenue/i);
});

test('CSV exports keep queue and channel drafts importable', () => {
  const pack = buildSkillsLibraryEnforcementPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const queueCsv = renderSkillsLibraryOperatorQueueCsv(pack);
  const draftsCsv = renderChannelDraftsCsv(pack);

  assert.match(queueCsv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(queueCsv, /x_reply_skills_library/);
  assert.match(draftsCsv, /^key,channel,format,audience,evidenceSummary,cta,proofTiming,draft/);
  assert.match(draftsCsv, /linkedin_post/);
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify(REPORT_FIXTURE), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), REPORT_FIXTURE);
});

test('CLI options and artifact writing emit markdown, JSON, and CSVs', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildSkillsLibraryEnforcementPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeSkillsLibraryEnforcementPack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'skills-library-enforcement-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'skills-library-enforcement-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'skills-library-operator-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'skills-library-channel-drafts.csv')), true);
});

test('outreach drafts expose X, LinkedIn, and DM copy', () => {
  const drafts = buildOutreachDrafts();

  assert.deepEqual(drafts.map((draft) => draft.channel), ['X', 'LinkedIn', 'DM']);
  assert.match(drafts[0].draft, /feedback -> rule -> pre-action gate/);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'skills-library-enforcement-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'skills-library-enforcement-pack.test.js')]), false);
});
