#!/usr/bin/env node
'use strict';

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
const GEMINI_SOURCE = 'gemini';
const GUIDE_MEDIUM = 'seo_guide';
const OUTREACH_MEDIUM = 'operator_outreach';
const GEMINI_SURFACE = 'gemini_cli';
const CANONICAL_HEADLINE = 'Turn Gemini CLI memory demand into enforced workflow safety.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives Gemini CLI local-first memory that can become prevention rules and Pre-Action Checks before the next risky MCP call runs.';
const GEMINI_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/gemini-cli-feedback-memory';
const GCP_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/gcp-mcp-guardrails';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const MEM0_COMPARE_URL = 'https://thumbgate-production.up.railway.app/compare/mem0';
const GEMINI_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/gemini-cli-feedback-memory.html';
const GCP_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/gcp-mcp-guardrails.html';
const MEM0_COMPARE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/compare/mem0.html';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const TRACKING_DEFAULTS = {
  utmSource: GEMINI_SOURCE,
  utmMedium: GUIDE_MEDIUM,
  utmCampaign: 'gemini_cli_demand',
  utmContent: 'guide',
  surface: GEMINI_SURFACE,
};
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

function buildTrackedGeminiLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const guideSurface = {
    key: 'memory_enforcement_guide',
    name: 'Gemini CLI memory guide',
    url: buildTrackedGeminiLink(GEMINI_GUIDE_URL, {
      utmCampaign: 'gemini_cli_memory_guide',
      utmContent: 'seo_page',
      campaignVariant: 'memory_enforcement',
      offerCode: 'GEMINI-MEMORY_GUIDE',
      ctaId: 'gemini_memory_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: GEMINI_GUIDE_SOURCE_URL,
    evidenceSource: 'public/guides/gemini-cli-feedback-memory.html',
    operatorUse: 'Primary SEO and buyer-education surface for Gemini CLI users who search for memory first.',
    buyerSignal: 'Searchers already asking for better memory who become viable buyers only when enforcement and proof stay close to the path.',
  };
  const gcpSurface = {
    key: 'gcp_guardrails_guide',
    name: 'Google Cloud MCP guardrails guide',
    url: buildTrackedGeminiLink(GCP_GUIDE_URL, {
      utmCampaign: 'gemini_gcp_guardrails',
      utmContent: 'cloud_next',
      campaignVariant: 'gcp_guardrails',
      offerCode: 'GEMINI-GCP_GUARDRAILS',
      ctaId: 'gemini_gcp_guardrails',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: GCP_GUIDE_SOURCE_URL,
    evidenceSource: 'public/guides/gcp-mcp-guardrails.html',
    operatorUse: 'Proof-backed demand surface for Gemini CLI teams touching BigQuery, Spanner, AlloyDB, or Cloud SQL through MCP.',
    buyerSignal: 'Cloud and data workflow owners who already understand blast radius and need approval boundaries before rollout.',
  };
  const localFirstSurface = {
    key: 'local_first_comparison',
    name: 'Local-first memory comparison',
    url: buildTrackedGeminiLink(MEM0_COMPARE_URL, {
      utmCampaign: 'gemini_local_first_compare',
      utmContent: 'comparison',
      campaignVariant: 'local_first',
      offerCode: 'GEMINI-LOCAL_FIRST',
      ctaId: 'gemini_local_first_compare',
      ctaPlacement: 'comparison_surface',
    }),
    supportUrl: MEM0_COMPARE_SOURCE_URL,
    evidenceSource: 'public/compare/mem0.html',
    operatorUse: 'Use when a Gemini buyer wants local-first memory and needs a proof-backed distinction versus hosted memory tools.',
    buyerSignal: 'Security-sensitive or privacy-sensitive evaluators who reject hosted memory before they will consider a paid operator workflow.',
  };
  const setupSurface = {
    key: 'proof_backed_setup_guide',
    name: 'Proof-backed setup guide',
    url: buildTrackedGeminiLink(GUIDE_URL, {
      utmCampaign: 'gemini_setup_guide',
      utmContent: 'setup',
      campaignVariant: 'proof_backed_setup',
      offerCode: 'GEMINI-SETUP_GUIDE',
      ctaId: 'gemini_setup_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
    evidenceSource: 'public/guide.html',
    operatorUse: 'General setup path once the buyer accepts the memory-to-enforcement story and wants the shortest install route.',
    buyerSignal: 'Operators who want one install path plus explicit proof and pricing guardrails before they keep evaluating.',
  };

  return [guideSurface, gcpSurface, localFirstSurface, setupSurface].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
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

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Gemini CLI operators who proved one blocked repeat and now want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedGeminiLink(links.proCheckoutLink, {
        utmCampaign: 'gemini_cli_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'GEMINI-PRO_FOLLOW_ON',
        ctaId: 'gemini_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'gemini_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated workflow failure, one owner, and one approval boundary.',
      cta: buildTrackedGeminiLink(links.sprintLink, {
        utmCampaign: 'gemini_cli_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'teams_follow_on',
        offerCode: 'GEMINI-TEAMS_FOLLOW_ON',
        ctaId: 'gemini_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'gemini_post_install',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const productionTargetCount = countTargets(report, (target) => hasEvidence(target, 'production or platform workflow'));
  const businessSystemTargetCount = countTargets(report, (target) => hasEvidence(target, 'business-system integration'));

  return [
    {
      key: 'memory_first_builder',
      audience: 'Gemini CLI builder searching for better memory',
      evidence: 'The Gemini CLI guide explicitly says searchers often begin with memory but buy because of enforcement, with a proof-led path from guide to Pro.',
      proofTrigger: 'They can name one repeated tool or workflow mistake they want blocked before the next session.',
      proofAsset: GEMINI_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedGeminiLink(GEMINI_GUIDE_URL, {
        utmCampaign: 'gemini_queue_memory',
        utmContent: 'seo_page',
        campaignVariant: 'memory_first_builder',
        offerCode: 'GEMINI-QUEUE_MEMORY',
        ctaId: 'gemini_queue_memory',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Guide -> proof -> Pro once one blocked repeat is real.',
    },
    {
      key: 'gcp_workflow_owner',
      audience: 'Google Cloud workflow owner running Gemini CLI near data or production systems',
      evidence: `The GCP guardrails guide documents BigQuery, Spanner, AlloyDB, Cloud SQL, and IAM escalation patterns. Current report production-style targets: ${productionTargetCount}.`,
      proofTrigger: 'They already described one risky BigQuery, Spanner, or MCP-backed workflow that cannot afford another destructive repeat.',
      proofAsset: GCP_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedGeminiLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'gemini_queue_gcp_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'gcp_workflow_owner',
        offerCode: 'GEMINI-QUEUE_GCP_SPRINT',
        ctaId: 'gemini_queue_gcp_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'gemini_workflow_queue',
      }),
      recommendedMotion: 'Qualify one high-risk workflow for the Workflow Hardening Sprint.',
    },
    {
      key: 'local_first_evaluator',
      audience: 'Security-sensitive evaluator comparing hosted memory versus local-first enforcement',
      evidence: `The Gemini guide keeps local-first posture explicit, and the compare surface supports buyers who object to hosted memory first. Current business-system targets: ${businessSystemTargetCount}.`,
      proofTrigger: 'They care about keeping workflow history local and need proof that enforcement happens without a hosted memory dependency.',
      proofAsset: MEM0_COMPARE_SOURCE_URL,
      nextAsk: buildTrackedGeminiLink(GUIDE_URL, {
        utmCampaign: 'gemini_queue_local_first',
        utmContent: 'setup',
        campaignVariant: 'local_first_evaluator',
        offerCode: 'GEMINI-QUEUE_LOCAL_FIRST',
        ctaId: 'gemini_queue_local_first',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Local-first comparison -> setup guide -> Pro only after one blocked repeat is provable.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const memoryGuideLink = buildTrackedGeminiLink(GEMINI_GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'gemini_outreach_memory',
    utmContent: 'guide',
    campaignVariant: 'memory_follow_up',
    offerCode: 'GEMINI-OUTREACH_MEMORY',
    ctaId: 'gemini_outreach_memory',
    ctaPlacement: 'outreach_draft',
    surface: 'gemini_outreach',
  });
  const proLink = buildTrackedGeminiLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'gemini_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'proof_after_pain',
    offerCode: 'GEMINI-OUTREACH_PRO',
    ctaId: 'gemini_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'gemini_outreach',
  });
  const sprintLink = buildTrackedGeminiLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'gemini_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'cloud_workflow',
    offerCode: 'GEMINI-OUTREACH_SPRINT',
    ctaId: 'gemini_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'gemini_outreach',
  });

  return [
    {
      key: 'memory_follow_up',
      channel: 'GitHub DM or email',
      audience: 'Solo Gemini CLI builder',
      draft: `You already know memory matters. The missing piece is turning one repeated Gemini CLI mistake into an enforced gate before the next tool call runs. The shortest proof-backed path is here: ${memoryGuideLink} . If you can name one repeat you want blocked, that guide is the fastest way to test the loop without drifting into generic AI governance.`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Solo operator who already confirmed one repeated failure',
      draft: `Now that the failure pattern is concrete, the next useful step is proof plus the paid operator path, not more abstract memory talk. Use Verification Evidence first, then route the buyer to the personal dashboard lane only if they want their own exports and proof-ready review surface: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'cloud_workflow',
      channel: 'Founder note',
      audience: 'Data or platform team owner',
      draft: `Google turned BigQuery, Spanner, AlloyDB, and Cloud SQL into MCP-call surfaces for Gemini CLI. If one of those workflows already has a repeated failure or approval-boundary risk, I am not pitching a generic plugin. I am pitching one workflow hardening sprint with proof: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'gemini_guide_to_paid_intent',
    policy: 'Treat Gemini guide visits as acquisition evidence only after a tracked proof click, Pro checkout start, or qualified sprint conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified team conversation sourced from a Gemini-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across Pro checkout starts or workflow sprint conversations.',
    metrics: [
      'gemini_memory_guide_views',
      'gcp_guardrails_guide_views',
      'proof_clicks',
      'pro_checkout_starts',
      'sprint_intake_submissions',
      'qualified_team_conversations',
      'paid_pro_conversions',
    ],
    guardrails: [
      'Do not claim rankings, installs, revenue, or partner approval without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Refresh Gemini guide, local-first comparison, and GCP guardrails copy with tracked CTAs and consistent install language.',
        decisionRule: 'Do not rewrite the value proposition unless guide clicks or proof clicks clearly fail to convert into paid intent.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever Gemini lane converts best: solo Pro or workflow sprint.',
        decisionRule: 'If guide traffic exists without paid intent, move proof and follow-on offers higher in the guide and follow-up copy.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether Gemini remains a guide-led acquisition lane or earns more direct outbound focus.',
        decisionRule: 'Only increase direct Gemini-specific outbound once there is qualified conversation or paid-intent evidence.',
      },
    ],
    doNotCountAsSuccess: [
      'guide views without proof clicks',
      'proof clicks without a tracked paid-intent event',
      'unverified revenue or approval claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'Gemini CLI demand in ThumbGate is guide-led: memory query first, then enforcement proof, then paid intent.',
    directiveHeadline || 'No verified revenue and no active pipeline. Use Gemini demand surfaces to create proof-backed intent, not vanity traffic.',
  ].join(' ');
}

function buildGeminiCliDemandPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn Gemini CLI memory demand and Google Cloud MCP guardrail demand into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
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

function renderGeminiCliOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderGeminiCliDemandPackMarkdown(pack = {}) {
  return renderRevenuePackMarkdown({
    title: 'Gemini CLI Demand Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of rankings, sent outreach, installs, paid revenue, or marketplace approval by itself.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
}

function writeGeminiCliDemandPack(pack, options = {}) {
  return writeStandardRevenuePack({
    repoRoot: REPO_ROOT,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'gemini-cli-demand-pack.md'),
    pack,
    options,
    renderMarkdown: renderGeminiCliDemandPackMarkdown,
    jsonName: 'gemini-cli-demand-pack.json',
    csvName: 'gemini-cli-operator-queue.csv',
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildGeminiCliDemandPack();
  const written = writeGeminiCliDemandPack(pack, options);

  console.log('Gemini CLI demand pack ready.');
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
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GCP_GUIDE_URL,
  GEMINI_GUIDE_URL,
  MEM0_COMPARE_URL,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildGeminiCliDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedGeminiLink,
  buildMeasurementPlan,
  isCliInvocation,
  parseArgs,
  renderGeminiCliDemandPackMarkdown,
  renderGeminiCliOperatorQueueCsv,
  writeGeminiCliDemandPack,
};
