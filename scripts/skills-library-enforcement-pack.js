#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');
const {
  buildTrackedPackLink,
  csvCell,
  isCliInvocation: isCliCall,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  renderOperatorQueueCsv,
  renderRevenuePackMarkdown,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACK_SOURCE = 'thenewstack';
const PACK_MEDIUM = 'skills_library_moment';
const PACK_SURFACE = 'skills_library_enforcement';
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'skills-library-enforcement-pack.md');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const CANONICAL_HEADLINE = 'Skills libraries tell agents what to know. ThumbGate enforces what they must not repeat.';
const CANONICAL_SHORT_DESCRIPTION = 'Attach ThumbGate to the skills-library market narrative as the feedback-to-pre-action-gates layer for Cursor, Claude Code, Codex, Gemini CLI, and MCP teams.';
const SKILLS_LIBRARY_ARTICLE_URL = 'https://thenewstack.io/engineering-team-skills-library/';
const RED_HAT_SKILLS_ARTICLE_URL = 'https://thenewstack.io/red-hat-agentic-skills-repository/';
const GITHUB_MCP_SECURITY_ARTICLE_URL = 'https://thenewstack.io/github-mcp-security-scanning/';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const PROOF_BACKED_SETUP_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];

const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];

const SURFACE_FIELDS = [
  { label: 'URL', key: 'url' },
  { label: 'Source URL', key: 'sourceUrl' },
  { label: 'Evidence source', key: 'evidenceSource' },
  { label: 'Operator use', key: 'operatorUse' },
  { label: 'Buyer signal', key: 'buyerSignal' },
];

function buildTrackedSkillsLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, {
    utmSource: PACK_SOURCE,
    utmMedium: PACK_MEDIUM,
    utmCampaign: 'skills_library_enforcement',
    utmContent: 'operator_pack',
    surface: PACK_SURFACE,
  });
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function deriveCommercialState(report = {}) {
  const headline = normalizeText(report?.directive?.headline);
  if (/verified customer revenue is \$0/i.test(headline)) {
    return 'verified-customer-revenue-zero';
  }
  return normalizeText(report?.directive?.state) || 'unknown';
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'skills_library_article',
      name: 'The New Stack skills-library article',
      url: buildTrackedSkillsLink(SKILLS_LIBRARY_ARTICLE_URL, {
        utmContent: 'skills_library_article',
        campaignVariant: 'skills_library',
        offerCode: 'TNS-SKILLS_LIBRARY',
        ctaId: 'tns_skills_library_reply',
        ctaPlacement: 'source_article',
      }),
      sourceUrl: SKILLS_LIBRARY_ARTICLE_URL,
      evidenceSource: 'The New Stack: engineering-team skills library',
      operatorUse: 'Use as the market narrative: teams are standardizing agent skills and need visibility into what agents are running.',
      buyerSignal: 'Platform and DevEx teams asking how to govern Cursor, Claude Code, Codex, Gemini CLI, and local skill files.',
    },
    {
      key: 'red_hat_skill_packs',
      name: 'Red Hat agentic skill packs',
      url: buildTrackedSkillsLink(RED_HAT_SKILLS_ARTICLE_URL, {
        utmContent: 'red_hat_skill_packs',
        campaignVariant: 'enterprise_skill_packs',
        offerCode: 'TNS-RED_HAT_SKILL_PACKS',
        ctaId: 'tns_red_hat_skill_packs_reply',
        ctaPlacement: 'source_article',
      }),
      sourceUrl: RED_HAT_SKILLS_ARTICLE_URL,
      evidenceSource: 'The New Stack: Red Hat agentic skills repository',
      operatorUse: 'Use for enterprise replies: bigger models are not enough; governed skills and institutional memory need enforcement before agents touch production workflows.',
      buyerSignal: 'Infrastructure and platform owners with RHEL, OpenShift, Ansible, or internal runbook knowledge moving into agent workflows.',
    },
    {
      key: 'github_mcp_security',
      name: 'GitHub MCP security scanning',
      url: buildTrackedSkillsLink(GITHUB_MCP_SECURITY_ARTICLE_URL, {
        utmContent: 'github_mcp_security',
        campaignVariant: 'mcp_security',
        offerCode: 'TNS-GITHUB_MCP_SECURITY',
        ctaId: 'tns_github_mcp_security_reply',
        ctaPlacement: 'source_article',
      }),
      sourceUrl: GITHUB_MCP_SECURITY_ARTICLE_URL,
      evidenceSource: 'The New Stack: GitHub MCP security scanning',
      operatorUse: 'Use for MCP safety replies: security checks are moving into the tool layer, and ThumbGate adds feedback-derived pre-action gates for repeated workflow failures.',
      buyerSignal: 'Teams connecting agents to GitHub, databases, cloud APIs, secrets, dependency scanners, and MCP servers.',
    },
    {
      key: 'thumbgate_setup_path',
      name: 'ThumbGate proof-backed setup guide',
      url: buildTrackedSkillsLink(GUIDE_URL, {
        utmContent: 'setup_guide',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'TNS-SKILLS_SETUP',
        ctaId: 'tns_skills_setup_guide',
        ctaPlacement: 'operator_pack',
      }),
      sourceUrl: PROOF_BACKED_SETUP_SOURCE_URL,
      evidenceSource: 'public/guide.html',
      operatorUse: 'Use only after the buyer accepts the skills-library-to-enforcement thesis and wants to try one local workflow.',
      buyerSignal: 'They can name one repeated AI-agent mistake that should become a pre-action gate.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    appOrigin: links.appOrigin,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo operators who run a local agent skill library and want dashboard, export, and unlimited custom gate support after one blocked repeat is real.',
      cta: buildTrackedSkillsLink(links.proCheckoutLink, {
        utmCampaign: 'skills_library_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'TNS-SKILLS_PRO',
        ctaId: 'tns_skills_pro_checkout',
        ctaPlacement: 'post_pain',
        planId: 'pro',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Platform, DevEx, or security teams that already see repeated review comments, agent drift, shadow skills, or unsafe MCP tool use.',
      cta: buildTrackedSkillsLink(links.sprintLink, {
        utmCampaign: 'skills_library_sprint_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'TNS-SKILLS_SPRINT',
        ctaId: 'tns_skills_sprint_intake',
        ctaPlacement: 'post_pain',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const reportState = deriveCommercialState(report);
  return [
    {
      key: 'x_reply_skills_library',
      audience: 'X reply to The New Stack skills-library post',
      evidence: 'The source article frames agent sprawl, shadow skills, and skill-health dashboards as live platform-team problems.',
      proofTrigger: 'Only reply with the ThumbGate setup link if someone asks how to enforce repeated corrections, not on the first reply.',
      proofAsset: SKILLS_LIBRARY_ARTICLE_URL,
      nextAsk: buildTrackedSkillsLink(GUIDE_URL, {
        utmMedium: 'x_reply',
        utmCampaign: 'skills_library_x_reply',
        utmContent: 'setup_guide',
        campaignVariant: 'x_reply',
        offerCode: 'TNS-SKILLS_X_REPLY',
        ctaId: 'tns_skills_x_reply',
        ctaPlacement: 'reply_followup',
      }),
      recommendedMotion: 'Reply with the enforcement thesis first; route to guide only after pain is confirmed.',
    },
    {
      key: 'linkedin_founder_post',
      audience: 'LinkedIn founder post for DevEx and platform teams',
      evidence: 'The market is already teaching buyers to care about skills libraries; ThumbGate should add the missing enforcement loop.',
      proofTrigger: 'A commenter mentions repeated review comments, stale skills, unsafe MCP actions, or lack of visibility into agent behavior.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      nextAsk: buildTrackedSkillsLink(links.sprintLink, {
        utmMedium: 'linkedin_post',
        utmCampaign: 'skills_library_linkedin',
        utmContent: 'workflow_sprint',
        campaignVariant: 'founder_post',
        offerCode: 'TNS-SKILLS_LINKEDIN',
        ctaId: 'tns_skills_linkedin_sprint',
        ctaPlacement: 'founder_post_followup',
      }),
      recommendedMotion: 'Founder post -> comments -> qualify one repeated workflow failure -> sprint intake.',
    },
    {
      key: 'platform_team_dm',
      audience: 'Platform or DevEx lead discussing skills libraries',
      evidence: `Current revenue-loop state is ${reportState}; direct conversations matter more than passive clicks.`,
      proofTrigger: 'They can name the skills source, the agent surface, and one repeated correction they want blocked.',
      proofAsset: COMMERCIAL_TRUTH_LINK,
      nextAsk: buildTrackedSkillsLink(links.sprintLink, {
        utmMedium: 'operator_outreach',
        utmCampaign: 'skills_library_platform_dm',
        utmContent: 'workflow_sprint',
        campaignVariant: 'platform_dm',
        offerCode: 'TNS-SKILLS_PLATFORM_DM',
        ctaId: 'tns_skills_platform_dm',
        ctaPlacement: 'dm_followup',
      }),
      recommendedMotion: 'Ask for one repeated correction; sell one workflow-hardening sprint, not generic observability.',
    },
  ];
}

function buildOutreachDrafts() {
  return [
    {
      channel: 'X',
      audience: 'Public reply',
      draft: 'Skills libraries solve agent sprawl, but they still need a failure loop. The hard part is not writing one good skill. It is catching the same agent mistake twice, promoting the correction, and blocking it before the next tool call. That is the ThumbGate lane: feedback -> rule -> pre-action gate.',
    },
    {
      channel: 'LinkedIn',
      audience: 'Founder post',
      draft: 'The skills-library conversation is the right one. Teams need shared instructions for Cursor, Claude Code, Codex, Gemini CLI, and MCP agents. But instructions drift. Review comments repeat. Local skills go stale. The next layer is enforcement: capture repeated corrections, promote them into rules, and block risky actions before execution.',
    },
    {
      channel: 'DM',
      audience: 'Platform lead',
      draft: 'Saw your interest in agent skills libraries. The pattern I would test is one repeated correction from your team: a review comment, unsafe command, missing proof step, or MCP boundary. If it repeats twice, turn it into a pre-action gate and prove it blocks before the next tool call.',
    },
  ];
}

function buildChannelDrafts(links = buildRevenueLinks()) {
  return [
    {
      key: 'x_reply',
      channel: 'X',
      format: 'reply',
      audience: 'The New Stack skills-library thread',
      evidenceSummary: 'The thread/article gives the market language: skills libraries, shadow skills, stale skills, agent quality signals.',
      cta: buildTrackedSkillsLink(GUIDE_URL, {
        utmMedium: 'x_reply',
        utmCampaign: 'skills_library_x_reply',
        utmContent: 'setup_guide',
        campaignVariant: 'x_reply',
        offerCode: 'TNS-SKILLS_X_REPLY',
        ctaId: 'tns_skills_x_reply',
        ctaPlacement: 'reply_followup',
      }),
      proofTiming: 'No proof links in the first reply; add the setup guide only when someone asks how to enforce corrections.',
      draft: 'Skills libraries solve agent sprawl. The next layer is enforcement: when the same correction repeats, promote it into a rule and make it a pre-action gate before the next risky tool call runs.',
    },
    {
      key: 'linkedin_post',
      channel: 'LinkedIn',
      format: 'founder post',
      audience: 'DevEx, platform, and internal developer portal teams',
      evidenceSummary: 'The New Stack/Port/Red Hat/GitHub coverage validates the category without requiring ThumbGate to claim traction.',
      cta: buildTrackedSkillsLink(links.sprintLink, {
        utmMedium: 'linkedin_post',
        utmCampaign: 'skills_library_linkedin',
        utmContent: 'workflow_sprint',
        campaignVariant: 'founder_post',
        offerCode: 'TNS-SKILLS_LINKEDIN',
        ctaId: 'tns_skills_linkedin_sprint',
        ctaPlacement: 'founder_post_followup',
      }),
      proofTiming: 'Offer the sprint only after a commenter names one repeated failure or review comment.',
      draft: 'A skills library tells agents how your company works. ThumbGate adds the failure loop: repeated correction -> reusable rule -> pre-action gate. That is how a review comment stops being tribal knowledge and starts blocking the next bad tool call.',
    },
    {
      key: 'platform_dm',
      channel: 'DM',
      format: 'direct outreach',
      audience: 'Platform lead with visible AI-agent governance work',
      evidenceSummary: 'Use when the prospect already talks about skills, MCP safety, internal developer portals, or agent sprawl.',
      cta: buildTrackedSkillsLink(links.sprintLink, {
        utmMedium: 'operator_outreach',
        utmCampaign: 'skills_library_platform_dm',
        utmContent: 'workflow_sprint',
        campaignVariant: 'platform_dm',
        offerCode: 'TNS-SKILLS_PLATFORM_DM',
        ctaId: 'tns_skills_platform_dm',
        ctaPlacement: 'dm_followup',
      }),
      proofTiming: 'Ask one diagnostic question before sending links.',
      draft: 'What is the repeated agent correction your team is tired of making? If there is one review comment or unsafe action that keeps coming back, that is the cleanest candidate for a ThumbGate pre-action gate.',
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'skills_library_to_qualified_workflow',
    policy: 'Count a win only when a skills-library conversation produces a named repeated failure, tracked proof click, Pro checkout start, or workflow sprint intake.',
    minimumUsefulSignal: 'One public reply or DM where the buyer names shadow skills, repeated review comments, MCP safety, stale agent instructions, or missing enforcement.',
    strongSignal: 'One qualified Workflow Hardening Sprint intake tied to a skills-library, MCP safety, or agent-sprawl workflow.',
    metrics: [
      'x_reply_engagement',
      'linkedin_comment_replies',
      'tracked_setup_guide_clicks',
      'skills_library_sprint_intakes',
      'named_repeated_failure_count',
      'proof_clicks_after_pain_confirmed',
    ],
    guardrails: [
      'Do not claim ThumbGate is featured, endorsed, or mentioned by The New Stack, Port, Red Hat, or GitHub.',
      'Do not claim revenue, customers, or paid traction from this campaign without non-operator buyer provenance.',
      'Do not lead with proof links before the buyer confirms pain.',
    ],
    milestones: [
      {
        window: '24h',
        goal: 'Publish one X reply and one LinkedIn founder post with tracked follow-up links prepared.',
        decisionRule: 'Continue only if there is at least one reply, profile click, guide click, or named workflow pain.',
      },
      {
        window: '7d',
        goal: 'Convert at least one skills-library conversation into a named repeated failure and sprint-intake offer.',
        decisionRule: 'If there are clicks but no named pain, rewrite the CTA around one repeated review comment.',
      },
    ],
    doNotCountAsSuccess: [
      'Likes without replies',
      'Article references without tracked clicks',
      'Checkout starts without verified customer provenance',
      'Generic agent-sprawl comments that do not name a workflow',
    ],
  };
}

function buildCanonicalIdentity(about = readGitHubAbout()) {
  return {
    displayName: 'ThumbGate',
    repositoryUrl: about.repositoryUrl,
    homepageUrl: about.homepageUrl,
    commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
    verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
  };
}

function buildSkillsLibraryEnforcementPack(
  report = readRevenueLoopReport(),
  links = buildRevenueLinks(),
  about = readGitHubAbout()
) {
  const commercialState = deriveCommercialState(report);
  return {
    generatedAt: new Date().toISOString(),
    objective: 'Ride the current skills-library and MCP safety narrative with a truthful enforcement-layer offer that can create qualified workflow-hardening conversations.',
    state: commercialState,
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: 'Skills libraries standardize what agents know; ThumbGate makes repeated corrections enforceable before risky commands, edits, MCP calls, or completion claims run again.',
    canonicalIdentity: buildCanonicalIdentity(about),
    surfaces: buildEvidenceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(links, report),
    outreachDrafts: buildOutreachDrafts(),
    channelDrafts: buildChannelDrafts(links),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: PROOF_LINKS,
  };
}

function renderChannelDraftsCsv(pack = {}) {
  const rows = [
    ['key', 'channel', 'format', 'audience', 'evidenceSummary', 'cta', 'proofTiming', 'draft'],
    ...(Array.isArray(pack.channelDrafts) ? pack.channelDrafts : []).map((draft) => [
      draft.key,
      draft.channel,
      draft.format,
      draft.audience,
      draft.evidenceSummary,
      draft.cta,
      draft.proofTiming,
      draft.draft,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderSkillsLibraryEnforcementPackMarkdown(pack = {}) {
  const base = renderRevenuePackMarkdown({
    title: 'Skills Library Enforcement Pack',
    disclaimer: 'Use this pack to attach ThumbGate to the skills-library, agent-sprawl, and MCP-safety market narrative without claiming endorsement, customers, or revenue.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
  const channelLines = (Array.isArray(pack.channelDrafts) ? pack.channelDrafts : []).flatMap((draft) => [
    `### ${draft.channel} - ${draft.format}`,
    `- Audience: ${draft.audience}`,
    `- Evidence: ${draft.evidenceSummary}`,
    `- CTA: ${draft.cta}`,
    `- Proof timing: ${draft.proofTiming}`,
    draft.draft,
    '',
  ]);
  return [
    base,
    '## Channel Drafts',
    ...channelLines,
  ].join('\n');
}

function renderSkillsLibraryOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function writeSkillsLibraryEnforcementPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    docsPath: DOCS_PATH,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    markdown: renderSkillsLibraryEnforcementPackMarkdown(pack),
    jsonName: 'skills-library-enforcement-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'skills-library-operator-queue.csv',
        value: renderSkillsLibraryOperatorQueueCsv(pack),
      },
      {
        name: 'skills-library-channel-drafts.csv',
        value: renderChannelDraftsCsv(pack),
      },
    ],
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  return parseReportArgs(argv);
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildSkillsLibraryEnforcementPack();
  const written = writeSkillsLibraryEnforcementPack(pack, options);
  if (!options.writeDocs && !options.reportDir) {
    process.stdout.write(renderSkillsLibraryEnforcementPackMarkdown(pack));
  } else {
    process.stdout.write(`Wrote skills library enforcement pack${written.docsPath ? ` to ${written.docsPath}` : ''}\n`);
  }
  return written;
}

if (isCliCall(process.argv, __filename)) {
  run();
}

module.exports = {
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
  isCliInvocation: (argv = process.argv) => isCliCall(argv, __filename),
  parseArgs,
  readRevenueLoopReport,
  renderChannelDraftsCsv,
  renderSkillsLibraryEnforcementPackMarkdown,
  renderSkillsLibraryOperatorQueueCsv,
  run,
  writeSkillsLibraryEnforcementPack,
};
