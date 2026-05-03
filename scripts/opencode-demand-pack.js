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
  isCliInvocation: isCliCall,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  renderOperatorQueueCsv,
  renderRevenuePackMarkdown,
  writeStandardRevenuePack,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const OPENCODE_SOURCE = 'opencode';
const GUIDE_MEDIUM = 'guide';
const OUTREACH_MEDIUM = 'operator_outreach';
const OPENCODE_SURFACE = 'opencode';
const MULTICA_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/multica-thumbgate-setup';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const MEM0_COMPARE_URL = 'https://thumbgate-production.up.railway.app/compare/mem0';
const MULTICA_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/multica-thumbgate-setup.html';
const OPENCODE_INTEGRATION_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md';
const OPENCODE_INSTALL_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md';
const MEM0_COMPARE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/compare/mem0.html';
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn OpenCode autopilot demand into proof-backed guardrail installs.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives OpenCode a repo-local profile, a portable MCP adapter, and local-first Pre-Action Checks that block repeated tool-call mistakes before the next run.';
const TRACKING_DEFAULTS = {
  utmSource: OPENCODE_SOURCE,
  utmMedium: GUIDE_MEDIUM,
  utmCampaign: 'opencode_demand',
  utmContent: 'guide',
  surface: OPENCODE_SURFACE,
};
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'GitHub description', key: 'githubDescription' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];
const SURFACE_FIELDS = [
  { label: 'Buyer signal', key: 'buyerSignal' },
  { label: 'Operator use', key: 'operatorUse' },
  { label: 'Surface URL', key: 'url' },
  { label: 'Support', key: 'supportUrl' },
  { label: 'Proof', key: 'proofUrl' },
];

function buildTrackedOpencodeLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const surfaces = [
    {
      key: 'multica_autopilot_guide',
      name: 'Multica + OpenCode autopilot guide',
      url: buildTrackedOpencodeLink(MULTICA_GUIDE_URL, {
        utmCampaign: 'opencode_multica_guide',
        utmContent: 'autopilot',
        campaignVariant: 'scheduled_jobs',
        offerCode: 'OPENCODE-MULTICA_GUIDE',
        ctaId: 'opencode_multica_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: MULTICA_GUIDE_SOURCE_URL,
      operatorUse: 'Primary acquisition surface for OpenCode users who already run scheduled jobs, autopilot loops, or unattended agent work.',
      buyerSignal: 'Autopilot owners who already understand repeated tool-call risk and need a guardrail before the next unattended run.',
    },
    {
      key: 'repo_native_integration_doc',
      name: 'Repo-native OpenCode integration guide',
      url: OPENCODE_INTEGRATION_URL,
      supportUrl: OPENCODE_INTEGRATION_URL,
      operatorUse: 'Use when the buyer wants repo-local proof that ThumbGate already ships OpenCode-specific configuration, worktree safety, and review boundaries.',
      buyerSignal: 'Builders who need to see the actual OpenCode config surface before trusting a generic setup pitch.',
    },
    {
      key: 'portable_profile_install',
      name: 'Portable OpenCode MCP profile install',
      url: OPENCODE_INSTALL_URL,
      supportUrl: OPENCODE_INSTALL_URL,
      operatorUse: 'Use when the buyer wants the portable MCP profile for another OpenCode project or a global config path outside this repo.',
      buyerSignal: 'Self-serve OpenCode evaluators who care about a version-pinned profile and explicit install instructions before they commit time.',
    },
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedOpencodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_setup_guide',
        utmContent: 'setup',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'OPENCODE-SETUP_GUIDE',
        ctaId: 'opencode_setup_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
      operatorUse: 'General self-serve activation surface once the OpenCode buyer accepts the install path and wants proof plus pricing guardrails in one place.',
      buyerSignal: 'Operators who want one proof-backed route into install, Pro, or workflow hardening without drifting into unsupported claims.',
    },
  ];

  return surfaces.map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
}

function evidenceEntries(target) {
  return Array.isArray(target?.evidence) ? target.evidence : [];
}

function hasEvidence(target, label) {
  const needle = normalizeText(label).toLowerCase();
  return evidenceEntries(target).some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function targetText(target) {
  return [
    target?.repoName,
    target?.description,
    target?.accountName,
    target?.username,
    target?.company,
    evidenceEntries(target).join(' '),
  ].map((value) => normalizeText(value)).join(' ');
}

function countTargets(report = {}, matcher = () => false) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function targetMentionsOpencode(target) {
  return /\bopen\s*code\b|\bopencode\b/i.test(targetText(target));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo OpenCode operators who already proved one blocked repeat and now want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedOpencodeLink(links.proCheckoutLink, {
        utmCampaign: 'opencode_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'OPENCODE-PRO_FOLLOW_ON',
        ctaId: 'opencode_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'opencode_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams running OpenCode or adjacent agent workflows with one repeated failure, one owner, and one approval boundary.',
      cta: buildTrackedOpencodeLink(links.sprintLink, {
        utmCampaign: 'opencode_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'teams_follow_on',
        offerCode: 'OPENCODE-TEAMS_FOLLOW_ON',
        ctaId: 'opencode_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'opencode_post_install',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const workflowControlCount = countTargets(report, (target) => hasEvidence(target, 'workflow control surface'));
  const selfServeCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));
  const productionCount = countTargets(report, (target) => hasEvidence(target, 'production or platform workflow'));
  const opencodeTargetCount = countTargets(report, targetMentionsOpencode);

  return [
    {
      key: 'autopilot_workflow_owner',
      audience: 'OpenCode or Multica operator running scheduled jobs or autopilot workflows',
      evidence: `The Multica guide explicitly shows OpenCode as a scheduled-job runtime, and current report workflow-control targets: ${workflowControlCount}.`,
      proofTrigger: 'They can name one unattended run, destructive tool call, or approval-boundary failure they want blocked before the next schedule fires.',
      proofAsset: MULTICA_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedOpencodeLink(MULTICA_GUIDE_URL, {
        utmCampaign: 'opencode_queue_autopilot',
        utmContent: 'guide',
        campaignVariant: 'autopilot_owner',
        offerCode: 'OPENCODE-QUEUE_AUTOPILOT',
        ctaId: 'opencode_queue_autopilot',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Autopilot guide -> pain confirmation -> Workflow Hardening Sprint.',
    },
    {
      key: 'repo_native_builder',
      audience: 'OpenCode builder who wants repo-local guardrails and a portable MCP profile',
      evidence: `The repo ships both opencode.json and a portable profile. Current explicit OpenCode mentions in the ranked queue: ${opencodeTargetCount}.`,
      proofTrigger: 'They want config proof or a version-pinned install path before they decide whether the free setup is enough.',
      proofAsset: OPENCODE_INTEGRATION_URL,
      nextAsk: buildTrackedOpencodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_queue_setup',
        utmContent: 'setup',
        campaignVariant: 'repo_native_builder',
        offerCode: 'OPENCODE-QUEUE_SETUP',
        ctaId: 'opencode_queue_setup',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Integration doc -> setup guide -> Pro after one blocked repeat is real.',
    },
    {
      key: 'self_serve_or_rollout_split',
      audience: 'Agent-tooling maintainer evaluating a self-serve install before a services conversation',
      evidence: `Current report self-serve target count: ${selfServeCount}; production-style targets: ${productionCount}.`,
      proofTrigger: 'One repeated mistake still survives the install path, or one rollout workflow clearly needs approval boundaries and proof.',
      proofAsset: OPENCODE_INSTALL_URL,
      nextAsk: buildTrackedOpencodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_queue_split',
        utmContent: 'setup',
        campaignVariant: 'self_serve_vs_rollout',
        offerCode: 'OPENCODE-QUEUE_SPLIT',
        ctaId: 'opencode_queue_split',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Setup guide first; Pro for solo proof, Sprint for rollout risk.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const setupGuideLink = buildTrackedOpencodeLink(GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_setup',
    utmContent: 'guide',
    campaignVariant: 'repo_native_setup',
    offerCode: 'OPENCODE-OUTREACH_SETUP',
    ctaId: 'opencode_outreach_setup',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const proLink = buildTrackedOpencodeLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'proof_after_pain',
    offerCode: 'OPENCODE-OUTREACH_PRO',
    ctaId: 'opencode_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'opencode_outreach',
  });
  const multicaGuideLink = buildTrackedOpencodeLink(MULTICA_GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_autopilot',
    utmContent: 'guide',
    campaignVariant: 'scheduled_jobs',
    offerCode: 'OPENCODE-OUTREACH_AUTOPILOT',
    ctaId: 'opencode_outreach_autopilot',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const sprintLink = buildTrackedOpencodeLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'autopilot_risk',
    offerCode: 'OPENCODE-OUTREACH_SPRINT',
    ctaId: 'opencode_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });

  return [
    {
      key: 'repo_native_setup',
      channel: 'GitHub DM or email',
      audience: 'Solo OpenCode builder',
      draft: `ThumbGate already ships a repo-local OpenCode profile plus a portable MCP install path. If you want the shortest proof-backed route, start with the setup guide here: ${setupGuideLink} . If one repeated agent mistake still survives after that, Pro is the clean next step instead of a generic services pitch.`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Solo operator who already confirmed one repeated OpenCode failure',
      draft: `Now that the repeat is concrete, send proof before the paid lane: ${VERIFICATION_EVIDENCE_LINK} . If the buyer wants the personal dashboard, export-ready evidence, and a clean self-serve path after that proof, move to Pro here: ${proLink} .`,
    },
    {
      key: 'autopilot_founder_note',
      channel: 'Founder note',
      audience: 'Autopilot owner running OpenCode unattended',
      draft: `If OpenCode is already running scheduled jobs or unattended workflows, the missing piece is not another prompt. It is a gate before the next risky tool call. The Multica/OpenCode guide is here: ${multicaGuideLink} . If one repeated failure or approval boundary is already costing you time, route it into the Workflow Hardening Sprint here: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'opencode_install_to_paid_intent',
    policy: 'Treat OpenCode guide visits as acquisition evidence only after a tracked proof click, Pro checkout start, or qualified workflow-hardening conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified workflow-hardening conversation sourced from an OpenCode-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across Pro checkout starts or sprint conversations.',
    metrics: [
      'opencode_setup_guide_views',
      'opencode_multica_guide_views',
      'proof_clicks',
      'pro_checkout_starts',
      'sprint_intake_submissions',
      'qualified_team_conversations',
      'paid_pro_conversions',
    ],
    guardrails: [
      'Do not claim installs, marketplace approval, or revenue without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Push the repo-native OpenCode setup story and the Multica autopilot guide into one consistent proof-backed lane.',
        decisionRule: 'Do not widen the pitch unless setup or autopilot clicks start producing pain-confirmed replies.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever OpenCode motion converts first: solo Pro or workflow hardening.',
        decisionRule: 'If proof clicks exist without paid intent, move proof and follow-on offers higher in the setup and autopilot copy.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether OpenCode stays a self-serve lane or earns more direct founder-led outbound.',
        decisionRule: 'Only increase OpenCode-specific outbound after there is qualified conversation or paid-intent evidence.',
      },
    ],
    doNotCountAsSuccess: [
      'guide views without proof clicks',
      'proof clicks without a tracked paid-intent event',
      'unverified install or revenue claims',
    ],
  };
}

function buildOpencodeDemandPack(
  report = readRevenueLoopReport(),
  links = buildRevenueLinks(),
  about = readGitHubAbout(),
) {
  const state = normalizeText(report?.directive?.state) || 'post-first-dollar';

  return {
    generatedAt: new Date().toISOString(),
    state,
    objective: 'Turn OpenCode setup proof and autopilot risk into tracked guide clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: 'OpenCode demand in ThumbGate should start with repo-native install proof and unattended-run risk, then split into Pro for solo operators or Workflow Hardening Sprint for rollout-critical workflows.',
    canonicalIdentity: {
      displayName: 'ThumbGate',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      githubDescription: about.githubDescription,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(links, report),
    outreachDrafts: buildOutreachDrafts(links),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderOpencodeDemandPackMarkdown(pack) {
  return renderRevenuePackMarkdown({
    title: 'OpenCode Demand Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of installs, sent outreach, paid revenue, or marketplace approval by itself.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
}

function renderOpencodeOperatorQueueCsv(pack) {
  return renderOperatorQueueCsv(pack?.operatorQueue);
}

function writeOpencodeDemandPack(pack, options = {}) {
  return writeStandardRevenuePack({
    repoRoot: REPO_ROOT,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'opencode-demand-pack.md'),
    pack,
    options,
    renderMarkdown: renderOpencodeDemandPackMarkdown,
    jsonName: 'opencode-demand-pack.json',
    csvName: 'opencode-operator-queue.csv',
  });
}

function parseArgs(argv = []) {
  return parseReportArgs(argv);
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = readRevenueLoopReport();
  const pack = buildOpencodeDemandPack(report);
  const written = writeOpencodeDemandPack(pack, options);

  if (written.docsPath) {
    console.log(`OpenCode demand pack updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
}

if (isCliInvocation(process.argv)) {
  main();
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GUIDE_URL,
  MEM0_COMPARE_URL,
  MULTICA_GUIDE_URL,
  OPENCODE_INSTALL_URL,
  OPENCODE_INTEGRATION_URL,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOpencodeDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedOpencodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpencodeDemandPackMarkdown,
  renderOpencodeOperatorQueueCsv,
  writeOpencodeDemandPack,
};
