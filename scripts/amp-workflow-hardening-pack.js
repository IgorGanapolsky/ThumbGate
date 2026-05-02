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
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const AMP_SOURCE = 'amp';
const GUIDE_MEDIUM = 'guide_surface';
const OUTREACH_MEDIUM = 'operator_outreach';
const AMP_SURFACE = 'amp';
const AMP_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/amp-agent-guardrails';
const HARNESS_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/agent-harness-optimization';
const SETUP_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const AMP_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/amp-agent-guardrails.html';
const HARNESS_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/agent-harness-optimization.html';
const SETUP_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html';
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const TRACKING_DEFAULTS = {
  utmSource: AMP_SOURCE,
  utmMedium: GUIDE_MEDIUM,
  utmCampaign: 'amp_workflow_hardening',
  utmContent: 'guide',
  surface: AMP_SURFACE,
};
const CANONICAL_HEADLINE = 'Turn Amp autonomy into one enforceable workflow.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives Amp a local-first reliability gateway: repeated failures become searchable lessons, harness proof, and Pre-Action Checks before the next risky tool call runs.';
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
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

function buildTrackedAmpLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function countTargets(report = {}, matcher) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function hasEvidence(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const ampGuideSurface = {
    key: 'amp_guardrails_guide',
    name: 'Amp guardrails guide',
    url: buildTrackedAmpLink(AMP_GUIDE_URL, {
      utmCampaign: 'amp_guardrails_guide',
      utmContent: 'seo_page',
      campaignVariant: 'workflow_guardrails',
      offerCode: 'AMP-GUARDRAILS_GUIDE',
      ctaId: 'amp_guardrails_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: AMP_GUIDE_SOURCE_URL,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    evidenceSource: 'public/guides/amp-agent-guardrails.html',
    operatorUse: 'Primary SEO and buyer-education surface for Amp operators who already feel harness drift, repeated shell mistakes, or approval-boundary risk.',
    buyerSignal: 'Amp users looking for enforceable workflow safety without slowing local autonomy.',
  };
  const harnessGuideSurface = {
    key: 'agent_harness_guide',
    name: 'Agent harness optimization guide',
    url: buildTrackedAmpLink(HARNESS_GUIDE_URL, {
      utmCampaign: 'amp_harness_guide',
      utmContent: 'guide',
      campaignVariant: 'harness_proof',
      offerCode: 'AMP-HARNESS_GUIDE',
      ctaId: 'amp_harness_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: HARNESS_GUIDE_SOURCE_URL,
    proofUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/proof/harnesses-report.json',
    evidenceSource: 'public/guides/agent-harness-optimization.html',
    operatorUse: 'Use when the buyer already thinks in harness terms and wants proof that Amp can run inside inspection and approval boundaries.',
    buyerSignal: 'Workflow owners who already know the harness is the control plane but still need a runtime stop for repeated failures.',
  };
  const setupGuideSurface = {
    key: 'proof_backed_setup_guide',
    name: 'Proof-backed setup guide',
    url: buildTrackedAmpLink(SETUP_GUIDE_URL, {
      utmCampaign: 'amp_setup_guide',
      utmContent: 'setup',
      campaignVariant: 'proof_backed_setup',
      offerCode: 'AMP-SETUP_GUIDE',
      ctaId: 'amp_setup_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: SETUP_GUIDE_SOURCE_URL,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    evidenceSource: 'public/guide.html',
    operatorUse: 'General install path once the buyer accepts the workflow-hardening story and wants the shortest self-serve path.',
    buyerSignal: 'Solo operators who want one install path plus explicit proof and pricing guardrails before they evaluate further.',
  };

  return [ampGuideSurface, harnessGuideSurface, setupGuideSurface].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    homepageUrl: about.homepageUrl,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Amp operators who already proved one blocked repeat and now want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedAmpLink(links.proCheckoutLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'amp_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'solo_follow_on',
        offerCode: 'AMP-PRO_FOLLOW_ON',
        ctaId: 'amp_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'amp_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated Amp workflow failure, one owner, and one approval boundary.',
      cta: buildTrackedAmpLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'amp_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'AMP-TEAM_FOLLOW_ON',
        ctaId: 'amp_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'amp_post_install',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const warmTargetCount = countTargets(report, (target) => normalizeText(target.temperature).toLowerCase() === 'warm');
  const productionTargetCount = countTargets(report, (target) => hasEvidence(target, 'production or platform workflow'));
  const selfServeTargetCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));

  return [
    {
      key: 'amp_workflow_owner',
      audience: 'Amp workflow owner who already sees repeated harness drift or unsafe autonomy',
      evidence: `Amp now has a dedicated guide plus harness-proof surface, and ${warmTargetCount} current warm target(s) already named repeated workflow pain in the broader revenue loop.`,
      proofTrigger: 'They can point to one repeated shell, file-edit, or approval-boundary failure that should stop before the next Amp run.',
      proofAsset: AMP_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedAmpLink(AMP_GUIDE_URL, {
        utmCampaign: 'amp_queue_guardrails',
        utmContent: 'seo_page',
        campaignVariant: 'workflow_owner',
        offerCode: 'AMP-QUEUE_GUARDRAILS',
        ctaId: 'amp_queue_guardrails',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Guide -> proof -> Workflow Hardening Sprint once one workflow owner is clear.',
    },
    {
      key: 'amp_team_rollout_owner',
      audience: 'Team evaluating Amp for production or approval-boundary workflows',
      evidence: `${productionTargetCount} current production-style target(s) reinforce the same B2B motion: prove one workflow is safe before expanding Amp autonomy.`,
      proofTrigger: 'They already described one workflow where repeated failures, rollback risk, or approvals make the cost of another mistake obvious.',
      proofAsset: HARNESS_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedAmpLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'amp_queue_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_rollout',
        offerCode: 'AMP-QUEUE_SPRINT',
        ctaId: 'amp_queue_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'amp_workflow_queue',
      }),
      recommendedMotion: 'Qualify one repeated workflow for the Workflow Hardening Sprint.',
    },
    {
      key: 'amp_solo_operator',
      audience: 'Solo Amp operator who wants a proof-backed self-serve lane first',
      evidence: `${selfServeTargetCount} current self-serve target(s) still point to install-first demand before any team-motion pitch.`,
      proofTrigger: 'They want the local install path first and will only consider paid follow-on after one blocked repeat is concrete.',
      proofAsset: SETUP_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedAmpLink(SETUP_GUIDE_URL, {
        utmCampaign: 'amp_queue_setup',
        utmContent: 'setup',
        campaignVariant: 'solo_install',
        offerCode: 'AMP-QUEUE_SETUP',
        ctaId: 'amp_queue_setup',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Setup guide -> proof -> Pro only after one blocked repeat is provable.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const ampGuideLink = buildTrackedAmpLink(AMP_GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'amp_outreach_guardrails',
    utmContent: 'guide',
    campaignVariant: 'workflow_guardrails',
    offerCode: 'AMP-OUTREACH_GUARDRAILS',
    ctaId: 'amp_outreach_guardrails',
    ctaPlacement: 'outreach_draft',
    surface: 'amp_outreach',
  });
  const proLink = buildTrackedAmpLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'amp_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'solo_follow_on',
    offerCode: 'AMP-OUTREACH_PRO',
    ctaId: 'amp_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'amp_outreach',
  });
  const sprintLink = buildTrackedAmpLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'amp_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'team_workflow',
    offerCode: 'AMP-OUTREACH_SPRINT',
    ctaId: 'amp_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'amp_outreach',
  });

  return [
    {
      key: 'workflow_guardrails',
      channel: 'GitHub DM or email',
      audience: 'Solo Amp operator',
      draft: `If Amp keeps repeating the same shell, file-edit, or workflow mistake, the missing piece is not another harness reminder. It is a runtime gate before the next risky tool call runs. The shortest proof-backed path is here: ${ampGuideLink} .`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Solo operator who already confirmed one repeated failure',
      draft: `Now that the repeated failure is concrete, move from general guardrails talk to proof plus the paid operator lane. Send Verification Evidence first, then route them to the personal dashboard path only if they want durable exports and proof-ready review: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'team_workflow',
      channel: 'Founder note',
      audience: 'Workflow owner or platform lead',
      draft: `I am not pitching another agent platform into Amp. I am pitching one workflow hardening lane: one repeated failure, one owner, one approval boundary, and a proof run before rollout expands. If that maps to a real workflow on your side, start here: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'amp_guide_to_paid_intent',
    policy: 'Treat Amp guide visits as acquisition evidence only after a tracked proof click, Pro checkout start, or qualified workflow-sprint conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified team conversation sourced from an Amp-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across Pro checkout starts or workflow sprint conversations.',
    metrics: [
      'amp_guardrails_guide_views',
      'amp_harness_proof_clicks',
      'amp_setup_guide_clicks',
      'pro_checkout_starts',
      'sprint_intake_submissions',
      'qualified_team_conversations',
      'paid_pro_conversions',
    ],
    guardrails: [
      'Do not claim revenue, installs, or partner approval without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Refresh the Amp guide, harness-proof lane, and setup guide copy with tracked CTAs and consistent install language.',
        decisionRule: 'Do not rewrite the value proposition unless Amp-tagged guide clicks fail to produce proof clicks or paid intent.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever Amp lane converts best: solo Pro or workflow sprint.',
        decisionRule: 'If guide traffic rises without paid intent, move proof and follow-on offers higher in the Amp guide and outreach copy.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether Amp stays guide-led or earns more direct outbound focus.',
        decisionRule: 'Only scale direct Amp outreach once there is qualified conversation or paid-intent evidence.',
      },
    ],
    doNotCountAsSuccess: [
      'guide views without proof clicks',
      'proof clicks without a tracked paid-intent event',
      'unverified revenue or partner claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'Amp demand in ThumbGate is workflow-first: start with one repeated autonomy failure, show harness proof, then route solo installs to Pro or teams to the Workflow Hardening Sprint.',
    directiveHeadline || 'No verified revenue and no active pipeline. Use Amp demand surfaces to create proof-backed intent, not vanity traffic.',
  ].join(' ');
}

function buildAmpWorkflowHardeningPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn Amp workflow-hardening demand into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report),
    canonicalIdentity: {
      displayName: 'ThumbGate',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
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

function renderAmpOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderAmpWorkflowHardeningPackMarkdown(pack = {}) {
  return renderRevenuePackMarkdown({
    title: 'Amp Workflow Hardening Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of sent outreach, installs, paid revenue, or partner approval by itself.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
}

function writeAmpWorkflowHardeningPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'amp-workflow-hardening-pack.md'),
    markdown: renderAmpWorkflowHardeningPackMarkdown(pack),
    jsonName: 'amp-workflow-hardening-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'amp-operator-queue.csv',
        value: renderAmpOperatorQueueCsv(pack),
      },
    ],
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildAmpWorkflowHardeningPack(readRevenueLoopReport());
  const written = writeAmpWorkflowHardeningPack(pack, options);

  console.log('Amp workflow hardening pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: pack.surfaces.length,
    followOnOffers: pack.followOnOffers.length,
    operatorQueue: pack.operatorQueue.length,
    northStar: pack.measurementPlan.northStar,
  }, null, 2));
}

function parseArgs(argv = []) {
  return parseReportArgs(argv);
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  AMP_GUIDE_URL,
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  HARNESS_GUIDE_URL,
  REVENUE_LOOP_REPORT_PATH,
  SETUP_GUIDE_URL,
  buildAmpWorkflowHardeningPack,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedAmpLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderAmpOperatorQueueCsv,
  renderAmpWorkflowHardeningPackMarkdown,
  writeAmpWorkflowHardeningPack,
};
