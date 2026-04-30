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
  renderRevenuePackMarkdown,
  writeStandardRevenuePack,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const OPENCODE_SOURCE = 'opencode';
const OPENCODE_MEDIUM = 'integration_guide';
const OPENCODE_SURFACE = 'opencode_profile';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const OPENCODE_INTEGRATION_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md';
const OPENCODE_INSTALL_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md';
const OPENCODE_ADAPTER_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/opencode/opencode.json';
const OPENCODE_REPO_PROFILE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/opencode.json';
const OPENCODE_REVIEW_AGENT_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/.opencode/agents/thumbgate-review.md';
const OPENCODE_WORKFLOW_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/.opencode/instructions/thumbgate-workflow.md';
const CANONICAL_HEADLINE = 'Turn OpenCode install intent into tracked proof and paid follow-through.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives OpenCode a worktree-safe local MCP profile, a proof-backed setup path, and enforceable Pre-Action Checks before the next risky tool call runs.';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const TRACKING_DEFAULTS = {
  utmSource: OPENCODE_SOURCE,
  utmMedium: OPENCODE_MEDIUM,
  utmCampaign: 'opencode_revenue_pack',
  utmContent: 'guide',
  surface: OPENCODE_SURFACE,
};
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate for OpenCode' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
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

function buildTrackedOpenCodeLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function listTargets(report = {}) {
  return Array.isArray(report.targets) ? report.targets : [];
}

function findOpenCodeTargets(report = {}) {
  return listTargets(report).filter((target) => {
    const haystack = [
      target.repoName,
      target.description,
      target.username,
      target.accountName,
      ...(Array.isArray(target.evidence) ? target.evidence : []),
    ].filter(Boolean).join(' ');
    return /\bopencode\b/i.test(haystack);
  });
}

function summarizeTarget(target = {}) {
  const repoRef = normalizeText(target.repoName) ? `${target.username}/${target.repoName}` : normalizeText(target.username) || 'OpenCode target';
  const evidence = Array.isArray(target.evidence) && target.evidence.length
    ? target.evidence.join('; ')
    : 'OpenCode-tagged buyer signal';
  const updatedAt = normalizeText(target.updatedAt) || 'n/a';
  return `${repoRef} (${evidence}; updated ${updatedAt})`;
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedOpenCodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_setup_guide',
        utmContent: 'guide',
        campaignVariant: 'self_serve_proof',
        offerCode: 'OPENCODE-SETUP_GUIDE',
        ctaId: 'opencode_setup_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Primary hosted conversion surface once an OpenCode buyer accepts the local-first install path and wants proof plus clear next offers.',
      buyerSignal: 'Self-serve OpenCode users who want one setup path before deciding whether the tool-only lane is enough.',
    },
    {
      key: 'integration_guide',
      name: 'OpenCode integration guide',
      url: OPENCODE_INTEGRATION_URL,
      supportUrl: OPENCODE_INTEGRATION_URL,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Repo-backed proof surface that explains the shipped OpenCode profile, worktree-only execution, and read-only review lane.',
      buyerSignal: 'Repo owners who want to evaluate OpenCode with real guardrails instead of ad hoc local config edits.',
    },
    {
      key: 'portable_profile_install',
      name: 'Portable OpenCode install guide',
      url: OPENCODE_INSTALL_URL,
      supportUrl: OPENCODE_INSTALL_URL,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Portable install surface for buyers who want the global OpenCode config path outside this repository.',
      buyerSignal: 'Warm operators ready to copy a pinned MCP profile into an existing OpenCode setup.',
    },
    {
      key: 'portable_adapter_json',
      name: 'Portable adapter profile',
      url: OPENCODE_ADAPTER_URL,
      supportUrl: OPENCODE_INSTALL_URL,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Machine-readable proof of the exact OpenCode MCP entry ThumbGate ships and version-pins.',
      buyerSignal: 'Technical evaluators who want the raw config artifact before trusting the setup story.',
    },
    {
      key: 'repo_local_profile',
      name: 'Repo-local OpenCode profile',
      url: OPENCODE_REPO_PROFILE_URL,
      supportUrl: OPENCODE_WORKFLOW_URL,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Shows the worktree-safe permission model, denied destructive git commands, and review-agent boundaries inside a real repo profile.',
      buyerSignal: 'Teams evaluating whether OpenCode can run inside a shared repo without loosening safety boundaries.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    homepageUrl: links.appOrigin,
    proofLinks: [...PROOF_LINKS],
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo OpenCode operators who proved one blocked repeat and want the dashboard plus proof-ready exports.',
      cta: buildTrackedOpenCodeLink(links.proCheckoutLink, {
        utmMedium: 'setup_guide',
        utmCampaign: 'opencode_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'self_serve_paid_intent',
        offerCode: 'OPENCODE-PRO_FOLLOW_ON',
        ctaId: 'opencode_pro_follow_on',
        ctaPlacement: 'follow_on_offer',
        planId: 'pro',
        surface: 'opencode_follow_on',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated workflow failure, one owner, and one approval boundary in an OpenCode-adjacent workflow.',
      cta: buildTrackedOpenCodeLink(links.sprintLink, {
        utmMedium: 'setup_guide',
        utmCampaign: 'opencode_sprint_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_motion',
        offerCode: 'OPENCODE-SPRINT_FOLLOW_ON',
        ctaId: 'opencode_sprint_follow_on',
        ctaPlacement: 'follow_on_offer',
        surface: 'opencode_follow_on',
      }),
    },
  ];
}

function buildOperatorQueue(report = {}, links = buildRevenueLinks()) {
  const openCodeTargets = findOpenCodeTargets(report);
  const primaryTarget = openCodeTargets[0];
  const primarySummary = primaryTarget ? summarizeTarget(primaryTarget) : 'No explicit OpenCode-tagged target is present in the current checked-in revenue loop report.';
  const setupGuideLink = buildTrackedOpenCodeLink(GUIDE_URL, {
    utmCampaign: 'opencode_queue_setup',
    utmContent: 'guide',
    campaignVariant: 'self_serve_open_code',
    offerCode: 'OPENCODE-QUEUE_SETUP',
    ctaId: 'opencode_queue_setup',
    ctaPlacement: 'operator_queue',
  });
  const sprintLink = buildTrackedOpenCodeLink(links.sprintLink, {
    utmMedium: 'operator_outreach',
    utmCampaign: 'opencode_queue_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'repo_owner',
    offerCode: 'OPENCODE-QUEUE_SPRINT',
    ctaId: 'opencode_queue_sprint',
    ctaPlacement: 'operator_queue',
    surface: 'opencode_workflow_queue',
  });

  return [
    {
      key: 'self_serve_open_code',
      audience: 'OpenCode builder who wants the clean self-serve path first',
      evidence: `Current GTM evidence includes ${openCodeTargets.length} explicit OpenCode-tagged target(s). Strongest current signal: ${primarySummary}`,
      proofTrigger: 'They already want the install path and can name one repeated mistake they would pay to block before the next OpenCode tool call.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      nextAsk: setupGuideLink,
      recommendedMotion: 'Guide -> prove one blocked repeat -> Pro.',
    },
    {
      key: 'repo_owner_worktree_rollout',
      audience: 'Repo owner evaluating OpenCode inside a shared repository',
      evidence: 'The shipped repo-local OpenCode profile denies destructive git commands, protects .thumbgate runtime state, and keeps implementation inside worktrees.',
      proofTrigger: 'They already have one approval boundary, rollout rule, or shared-repo failure mode they need to enforce before wider use.',
      proofAsset: OPENCODE_REPO_PROFILE_URL,
      nextAsk: sprintLink,
      recommendedMotion: 'Qualify one risky shared workflow for the Workflow Hardening Sprint.',
    },
    {
      key: 'review_lane_team',
      audience: 'Team that wants OpenCode as a bounded review lane instead of another full-autonomy writer',
      evidence: 'ThumbGate ships a read-only OpenCode review agent plus workflow instructions that keep verification and repo inspection separated from edit-capable work.',
      proofTrigger: 'They care more about controlled review and proof than about raw OpenCode novelty or another agent install.',
      proofAsset: OPENCODE_REVIEW_AGENT_URL,
      nextAsk: sprintLink,
      recommendedMotion: 'Start with one review or approval workflow, then expand only after proof exists.',
    },
  ];
}

function buildOutreachDrafts(report = {}, links = buildRevenueLinks()) {
  const openCodeTargets = findOpenCodeTargets(report);
  const primaryTarget = openCodeTargets[0];
  const setupGuideLink = buildTrackedOpenCodeLink(GUIDE_URL, {
    utmMedium: 'operator_outreach',
    utmCampaign: 'opencode_outreach_setup',
    utmContent: 'guide',
    campaignVariant: 'self_serve_first_touch',
    offerCode: 'OPENCODE-OUTREACH_SETUP',
    ctaId: 'opencode_outreach_setup',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const proLink = buildTrackedOpenCodeLink(links.proCheckoutLink, {
    utmMedium: 'operator_outreach',
    utmCampaign: 'opencode_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'proof_after_pain',
    offerCode: 'OPENCODE-OUTREACH_PRO',
    ctaId: 'opencode_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'opencode_outreach',
  });
  const sprintLink = buildTrackedOpenCodeLink(links.sprintLink, {
    utmMedium: 'operator_outreach',
    utmCampaign: 'opencode_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'team_boundary',
    offerCode: 'OPENCODE-OUTREACH_SPRINT',
    ctaId: 'opencode_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const targetRepo = primaryTarget?.repoName ? `\`${primaryTarget.repoName}\`` : 'your OpenCode workflow';

  return [
    {
      key: 'self_serve_first_touch',
      channel: 'GitHub DM or email',
      audience: 'OpenCode builder',
      draft: `You already have OpenCode. The missing piece is turning one repeated mistake into a Pre-Action Check before the next tool call runs, not adding another note. If you want the clean self-serve path first, start with the proof-backed setup guide: ${setupGuideLink} .`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Solo operator who already confirmed one repeated failure',
      draft: `Now that the failure pattern is concrete, move from setup to proof. Use Verification Evidence first, then route the buyer to the self-serve paid lane only if they want the dashboard and export-ready proof: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'team_boundary',
      channel: 'Founder note',
      audience: 'Repo owner or consultancy lead',
      draft: `I am not pitching another generic OpenCode add-on. I am pitching one workflow that becomes safe enough to ship because the repeated failure turns into an enforceable gate and the proof stays inspectable. If ${targetRepo} maps to a real approval, review, or rollout boundary in your stack, the next useful step is the Workflow Hardening Sprint intake: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan(openCodeTargetCount = 0) {
  return {
    northStar: 'opencode_setup_to_paid_intent',
    policy: 'Treat OpenCode guide clicks and config reads as acquisition evidence only after a tracked Pro checkout start or qualified sprint conversation exists.',
    minimumUsefulSignal: 'One tracked paid-intent event from an OpenCode-tagged surface.',
    strongSignal: `Two tracked paid-intent events or one qualified conversation sourced from the current ${openCodeTargetCount} OpenCode-tagged target lane.`,
    metrics: [
      'opencode_setup_guide_views',
      'opencode_profile_doc_clicks',
      'opencode_proof_clicks',
      'opencode_pro_checkout_starts',
      'opencode_qualified_team_conversations',
    ],
    guardrails: [
      'Do not claim installs, revenue, or marketplace approval without direct command evidence.',
      'Do not lead with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Keep the OpenCode setup guide, integration guide, and portable profile aligned around one self-serve story.',
        decisionRule: 'Do not add new OpenCode-specific offers until guide clicks or outreach replies show paid intent.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever OpenCode motion converts best after install intent: Pro or Workflow Hardening Sprint.',
        decisionRule: 'If setup interest rises without paid intent, move proof and follow-on offers closer to the first-touch path.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether OpenCode stays a thin self-serve wedge or becomes a team workflow-hardening lane.',
        decisionRule: 'Only prioritize the team motion when qualified conversations exist.',
      },
    ],
    doNotCountAsSuccess: [
      'guide clicks without proof clicks',
      'proof clicks without a tracked paid-intent event',
      'unverified install or revenue claims',
    ],
  };
}

function buildPackSummary(report = {}, openCodeTargets = []) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  if (openCodeTargets.length) {
    return `Current GTM evidence includes ${openCodeTargets.length} explicit OpenCode-tagged target lane(s), so the OpenCode path should stay self-serve-first until one repeated workflow failure or paid-intent event is explicit. ${directiveHeadline}`;
  }
  return directiveHeadline || 'No explicit OpenCode-tagged target is present in the current checked-in revenue loop report, so keep the OpenCode lane proof-backed and acquisition-first instead of inventing traction.';
}

function buildOpenCodeRevenuePack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  const openCodeTargets = findOpenCodeTargets(report);
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'post-first-dollar',
    objective: 'Turn OpenCode setup intent into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations without inventing install traction.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report, openCodeTargets),
    canonicalIdentity: {
      displayName: 'ThumbGate for OpenCode',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(report, links),
    outreachDrafts: buildOutreachDrafts(report, links),
    measurementPlan: buildMeasurementPlan(openCodeTargets.length),
    proofLinks: [...PROOF_LINKS],
  };
}

const parseArgs = parseReportArgs;

function renderOpenCodeRevenuePackMarkdown(pack = {}) {
  return renderRevenuePackMarkdown({
    title: 'OpenCode Revenue Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of installs, revenue, or marketplace approval by itself.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
}

function writeOpenCodeRevenuePack(pack, options = {}) {
  return writeStandardRevenuePack({
    repoRoot: REPO_ROOT,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'opencode-revenue-pack.md'),
    pack,
    options,
    renderMarkdown: renderOpenCodeRevenuePackMarkdown,
    jsonName: 'opencode-revenue-pack.json',
    csvName: 'opencode-operator-queue.csv',
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildOpenCodeRevenuePack(readRevenueLoopReport());
  const written = writeOpenCodeRevenuePack(pack, options);

  console.log('OpenCode revenue pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: Array.isArray(pack.surfaces) ? pack.surfaces.length : 0,
    queueRows: Array.isArray(pack.operatorQueue) ? pack.operatorQueue.length : 0,
    outreachDrafts: Array.isArray(pack.outreachDrafts) ? pack.outreachDrafts.length : 0,
  }, null, 2));
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

if (isCliInvocation()) {
  try {
    main();
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  REVENUE_LOOP_REPORT_PATH,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOpenCodeRevenuePack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildPackSummary,
  buildTrackedOpenCodeLink,
  findOpenCodeTargets,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpenCodeRevenuePackMarkdown,
  writeOpenCodeRevenuePack,
};
