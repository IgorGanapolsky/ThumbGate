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
const CHATGPT_SOURCE = 'chatgpt';
const GPT_MEDIUM = 'gpt_store';
const OUTREACH_MEDIUM = 'operator_outreach';
const CHATGPT_SURFACE = 'chatgpt_gpt';
const PUBLISHED_GPT_URL = 'https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate';
const GPT_OPEN_REDIRECT_URL = 'https://thumbgate-production.up.railway.app/go/gpt';
const GPT_ACTIONS_INSTALL_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/chatgpt/INSTALL.md';
const GPT_SUBMISSION_PACKET_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/gpt-store-submission.md';
const GPT_INSTRUCTIONS_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/chatgpt-gpt-instructions.md';
const GPT_AUDIT_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/chatgpt-live-audit-2026-04-24.md';
const GPT_TRUST_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/chatgpt-ads-trust';
const GPT_TRUST_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/chatgpt-ads-trust.html';
const GPT_LANDING_SECTION_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/index.html';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Use ChatGPT for discovery, then force risky actions through real checks.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate turns the published ChatGPT GPT into a proof-backed front door for action checks, typed feedback capture, and local enforcement handoff.';
const TRACKING_DEFAULTS = {
  utmSource: CHATGPT_SOURCE,
  utmMedium: GPT_MEDIUM,
  utmCampaign: 'chatgpt_gpt',
  utmContent: 'gpt',
  surface: CHATGPT_SURFACE,
};
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate GPT' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Published GPT', key: 'publishedGptUrl' },
  { label: 'GPT submission packet', key: 'submissionPacketUrl' },
  { label: 'Actions install guide', key: 'actionsInstallUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];
const SURFACE_FIELDS = [
  { label: 'Buyer signal', key: 'buyerSignal' },
  { label: 'Operator use', key: 'operatorUse' },
  { label: 'Surface URL', key: 'url' },
  { label: 'Public URL', key: 'publicUrl' },
  { label: 'Support', key: 'supportUrl' },
  { label: 'Evidence source', key: 'evidenceSource' },
  { label: 'Proof', key: 'proofUrl' },
];

function buildTrackedChatgptLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'published_gpt',
      name: 'Published ThumbGate GPT',
      url: buildTrackedChatgptLink(`${links.appOrigin}/go/gpt`, {
        utmCampaign: 'chatgpt_gpt_open',
        utmContent: 'open_gpt',
        campaignVariant: 'published_gpt',
        offerCode: 'CHATGPT-GPT_OPEN',
        ctaId: 'chatgpt_gpt_open',
        ctaPlacement: 'gpt_surface',
      }),
      publicUrl: PUBLISHED_GPT_URL,
      supportUrl: GPT_ACTIONS_INSTALL_URL,
      evidenceSource: 'public/index.html',
      operatorUse: 'Primary acquisition surface for ChatGPT users who want to preflight one risky action before installing anything locally.',
      buyerSignal: 'They already live inside ChatGPT and will only continue if the first action check or typed lesson feels immediate.',
    },
    {
      key: 'gpt_store_submission_packet',
      name: 'GPT Store submission packet',
      url: GPT_SUBMISSION_PACKET_URL,
      supportUrl: GPT_INSTRUCTIONS_URL,
      evidenceSource: 'docs/gpt-store-submission.md',
      operatorUse: 'Operator repair surface for refreshing GPT Builder copy, conversation starters, Actions auth, and avatar state without inventing new claims.',
      buyerSignal: 'A stale GPT listing is a conversion leak, so the builder owner needs exact copy and repair instructions, not another brainstorm.',
    },
    {
      key: 'live_gpt_audit',
      name: 'Live GPT drift audit',
      url: GPT_AUDIT_URL,
      supportUrl: GPT_SUBMISSION_PACKET_URL,
      evidenceSource: 'docs/chatgpt-live-audit-2026-04-24.md',
      operatorUse: 'Proof surface for why the ChatGPT lane needs repair before more traffic is sent into it.',
      buyerSignal: 'The public GPT can attract interest, but stale auth or copy will kill conversion before the local install handoff.',
    },
    {
      key: 'chatgpt_actions_install',
      name: 'ChatGPT Actions install guide',
      url: GPT_ACTIONS_INSTALL_URL,
      supportUrl: GPT_INSTRUCTIONS_URL,
      evidenceSource: 'adapters/chatgpt/INSTALL.md',
      operatorUse: 'Technical handoff surface for buyers or operators who want the GPT to save typed feedback reliably.',
      buyerSignal: 'They need the direct setup path for Bearer auth and action testing before they will trust the memory loop.',
    },
    {
      key: 'ads_trust_guide',
      name: 'ChatGPT ads trust guide',
      url: buildTrackedChatgptLink(GPT_TRUST_GUIDE_URL, {
        utmCampaign: 'chatgpt_ads_trust',
        utmContent: 'guide',
        campaignVariant: 'trust_boundary',
        offerCode: 'CHATGPT-ADS_TRUST',
        ctaId: 'chatgpt_ads_trust',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: GPT_TRUST_GUIDE_SOURCE_URL,
      evidenceSource: 'public/guides/chatgpt-ads-trust.html',
      operatorUse: 'SEO and demand-capture surface for buyers who already frame the problem as AI trust, discovery, and execution boundaries.',
      buyerSignal: 'Teams reacting to ChatGPT discovery or ads need a clear boundary story before they will book a workflow-hardening conversation.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    homepageUrl: about.homepageUrl,
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
      buyer: 'Solo ChatGPT-first operators who proved one useful action check or saved lesson and want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedChatgptLink(links.proCheckoutLink, {
        utmCampaign: 'chatgpt_gpt_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'CHATGPT-PRO_FOLLOW_ON',
        ctaId: 'chatgpt_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'chatgpt_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already use ChatGPT for discovery or checkpointing and need a real execution boundary before risky workflows run.',
      cta: buildTrackedChatgptLink(links.sprintLink, {
        utmCampaign: 'chatgpt_gpt_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'teams_follow_on',
        offerCode: 'CHATGPT-TEAMS_FOLLOW_ON',
        ctaId: 'chatgpt_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'chatgpt_post_install',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks()) {
  return [
    {
      key: 'gpt_first_operator',
      audience: 'ChatGPT-first operator with one risky action to check before it runs',
      evidence: 'public/index.html, docs/landing-page.html, and the published GPT URL all position the GPT as the fastest front door for action checks and typed feedback capture.',
      proofTrigger: 'They can paste one risky command, deploy, refund, PR action, or file edit they want checked before execution.',
      proofAsset: PUBLISHED_GPT_URL,
      nextAsk: buildTrackedChatgptLink(GPT_OPEN_REDIRECT_URL, {
        utmCampaign: 'chatgpt_queue_open_gpt',
        utmContent: 'open_gpt',
        campaignVariant: 'gpt_first_operator',
        offerCode: 'CHATGPT-QUEUE_OPEN_GPT',
        ctaId: 'chatgpt_queue_open_gpt',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Open the GPT, prove one useful decision or lesson, then route the serious operator to Pro.',
    },
    {
      key: 'builder_repair_owner',
      audience: 'GPT Builder owner whose public listing or Actions auth is stale',
      evidence: 'The 2026-04-24 live audit records empty Action instructions, missing usable avatar metadata, and auth-sensitive capture behavior that can block trust.',
      proofTrigger: 'They care about whether typed feedback actually saves and whether the public GPT points users into a trustworthy next step.',
      proofAsset: GPT_AUDIT_URL,
      nextAsk: GPT_SUBMISSION_PACKET_URL,
      recommendedMotion: 'Repair GPT Builder copy and auth first, then use the GPT lane to generate proof-backed paid intent.',
    },
    {
      key: 'trust_boundary_team',
      audience: 'Team using ChatGPT for discovery but needing a boundary before risky execution',
      evidence: 'The ChatGPT ads trust guide and homepage copy frame ThumbGate as the boundary between conversational discovery and local execution.',
      proofTrigger: 'They already have one workflow, one owner, and one approval-boundary failure they do not want to repeat.',
      proofAsset: GPT_TRUST_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedChatgptLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'chatgpt_queue_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'trust_boundary_team',
        offerCode: 'CHATGPT-QUEUE_SPRINT',
        ctaId: 'chatgpt_queue_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'chatgpt_workflow_queue',
      }),
      recommendedMotion: 'Trust guide -> workflow intake -> Workflow Hardening Sprint.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const gptLink = buildTrackedChatgptLink(GPT_OPEN_REDIRECT_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'chatgpt_outreach_open_gpt',
    utmContent: 'open_gpt',
    campaignVariant: 'gpt_first_touch',
    offerCode: 'CHATGPT-OUTREACH_OPEN_GPT',
    ctaId: 'chatgpt_outreach_open_gpt',
    ctaPlacement: 'outreach_draft',
    surface: 'chatgpt_outreach',
  });
  const proLink = buildTrackedChatgptLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'chatgpt_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'proof_after_pain',
    offerCode: 'CHATGPT-OUTREACH_PRO',
    ctaId: 'chatgpt_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'chatgpt_outreach',
  });
  const sprintLink = buildTrackedChatgptLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'chatgpt_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'trust_boundary_team',
    offerCode: 'CHATGPT-OUTREACH_SPRINT',
    ctaId: 'chatgpt_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'chatgpt_outreach',
  });

  return [
    {
      key: 'gpt_first_touch',
      channel: 'DM or email',
      audience: 'ChatGPT-first solo operator',
      draft: `If you already use ChatGPT as the first place you ask for help, the fastest useful test is not another landing page. It is one risky action check or one typed thumbs-down inside the live ThumbGate GPT: ${gptLink} . If that first interaction feels real, then it is worth talking about the local enforcement layer.`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Operator who already confirmed one repeated failure',
      draft: `Now that the repeated failure is concrete, move from generic GPT usage to proof plus the paid operator lane. Use the verification pack first, then route them to the personal dashboard path only if they want durable exports and reviewable proof: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'trust_boundary_team',
      channel: 'Founder note',
      audience: 'Platform, ops, or AI product lead',
      draft: `I am not pitching ChatGPT as the execution surface. I am pitching a cleaner boundary between ChatGPT discovery and the risky workflow that follows. If your team already has one owner and one approval-boundary failure tied to AI-assisted work, the next useful step is the Workflow Hardening Sprint intake: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'chatgpt_gpt_to_paid_intent',
    policy: 'Treat ChatGPT GPT opens as acquisition evidence only after a tracked proof click, Pro checkout start, or qualified workflow conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified team conversation sourced from the ChatGPT GPT lane.',
    strongSignal: 'Three tracked paid-intent events across Pro checkout starts or workflow sprint conversations.',
    metrics: [
      'chatgpt_gpt_opens',
      'chatgpt_actions_setup_doc_clicks',
      'chatgpt_submission_packet_clicks',
      'chatgpt_proof_clicks',
      'chatgpt_pro_checkout_starts',
      'chatgpt_sprint_intake_submissions',
      'chatgpt_qualified_team_conversations',
    ],
    guardrails: [
      'Do not claim GPT installs, traffic, saved lessons, or paid revenue without direct command evidence.',
      'Do not imply ChatGPT native rating buttons save ThumbGate lessons.',
      'Do not send more paid traffic into the GPT lane until Actions auth and listing copy match the repair docs.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Repair GPT Builder drift, align the public GPT copy with the canonical packet, and keep tracked GPT/open-guide links consistent.',
        decisionRule: 'Do not broaden ChatGPT promotion until the GPT lane has a clean first-touch path and the repair audit is addressed.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever ChatGPT follow-on motion converts better: solo Pro or workflow sprint.',
        decisionRule: 'If GPT opens rise without proof clicks or checkout starts, move proof and local-enforcement handoff higher in the GPT and guide surfaces.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether ChatGPT remains a discovery lane or becomes a stronger team qualification lane.',
        decisionRule: 'Only intensify ChatGPT-specific outbound once qualified conversations or paid-intent events are visible.',
      },
    ],
    doNotCountAsSuccess: [
      'GPT opens without proof clicks',
      'proof clicks without a tracked paid-intent event',
      'unverified traffic, revenue, or GPT-store claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'ChatGPT demand in ThumbGate should start with one useful action check or typed lesson, then hand the buyer into proof and local enforcement.',
    directiveHeadline || 'No verified revenue and no active pipeline. Use the GPT lane to create proof-backed paid intent, not vanity opens.',
  ].join(' ');
}

function buildChatgptGptRevenuePack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn ChatGPT GPT discovery and trust-boundary demand into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report),
    canonicalIdentity: {
      displayName: 'ThumbGate GPT',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      publishedGptUrl: PUBLISHED_GPT_URL,
      submissionPacketUrl: GPT_SUBMISSION_PACKET_URL,
      actionsInstallUrl: GPT_ACTIONS_INSTALL_URL,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(links),
    outreachDrafts: buildOutreachDrafts(links),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
    landingEvidence: GPT_LANDING_SECTION_URL,
  };
}

function renderChatgptOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderChatgptGptRevenuePackMarkdown(pack = {}) {
  return renderRevenuePackMarkdown({
    title: 'ChatGPT GPT Revenue Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of GPT traffic, sent outreach, saved feedback, paid revenue, or GPT Store ranking by itself.',
    pack,
    canonicalFields: CANONICAL_FIELDS,
    surfaceFields: SURFACE_FIELDS,
  });
}

function writeChatgptGptRevenuePack(pack, options = {}) {
  return writeStandardRevenuePack({
    repoRoot: REPO_ROOT,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'chatgpt-gpt-revenue-pack.md'),
    pack,
    options,
    renderMarkdown: renderChatgptGptRevenuePackMarkdown,
    jsonName: 'chatgpt-gpt-revenue-pack.json',
    csvName: 'chatgpt-gpt-operator-queue.csv',
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildChatgptGptRevenuePack();
  const written = writeChatgptGptRevenuePack(pack, options);

  console.log('ChatGPT GPT revenue pack ready.');
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

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

const parseArgs = parseReportArgs;

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
  GPT_ACTIONS_INSTALL_URL,
  GPT_AUDIT_URL,
  GPT_SUBMISSION_PACKET_URL,
  GPT_TRUST_GUIDE_URL,
  PUBLISHED_GPT_URL,
  buildChatgptGptRevenuePack,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedChatgptLink,
  isCliInvocation,
  parseArgs,
  renderChatgptGptRevenuePackMarkdown,
  renderChatgptOperatorQueueCsv,
  writeChatgptGptRevenuePack,
};
