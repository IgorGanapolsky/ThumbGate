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
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const REPEAT_MISTAKES_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/claude-code-prevent-repeated-mistakes';
const GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html';
const REPEAT_MISTAKES_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/claude-code-prevent-repeated-mistakes.html';
const LANDING_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/landing-page.html';
const LINKEDIN_SOURCE = 'linkedin';
const LINKEDIN_MEDIUM = 'organic_social';
const DM_MEDIUM = 'linkedin_dm';
const COMMENT_MEDIUM = 'linkedin_comment';
const LINKEDIN_SURFACE = 'linkedin_workflow_hardening';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn LinkedIn workflow-risk conversations into sprint-qualified paid intent.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives founder-led LinkedIn outreach one honest offer: harden one AI-agent workflow with approval boundaries, rollback safety, and proof before wider rollout.';
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];
const TRACKING_DEFAULTS = {
  utmSource: LINKEDIN_SOURCE,
  utmMedium: LINKEDIN_MEDIUM,
  utmCampaign: 'linkedin_workflow_hardening',
  utmContent: 'founder_post',
  surface: LINKEDIN_SURFACE,
};

function buildTrackedLinkedinLink(baseUrl, tracking = {}) {
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

function collectPainSignals(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const seen = new Set();
  const signals = [];
  const painPrefix = 'workflow pain named:';

  for (const target of targets) {
    const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
    for (const entry of evidence) {
      const normalizedEntry = normalizeText(entry);
      if (!normalizedEntry.toLowerCase().startsWith(painPrefix)) {
        continue;
      }
      const signal = normalizedEntry.slice(painPrefix.length).trim().replace(/\.$/, '');
      const key = signal.toLowerCase();
      if (!signal || seen.has(key)) {
        continue;
      }
      seen.add(key);
      signals.push(signal);
      if (signals.length >= 4) {
        return signals;
      }
    }
  }

  return signals;
}

function formatPainSignals(report = {}) {
  const signals = collectPainSignals(report);
  if (!signals.length) {
    return 'repeated workflow failures';
  }
  if (signals.length === 1) {
    return signals[0];
  }
  return `${signals.slice(0, -1).join(', ')}, and ${signals.at(-1)}`;
}

function buildEvidenceBackstop(report = {}) {
  return {
    warmTargetCount: countTargets(report, (target) => normalizeText(target.temperature).toLowerCase() === 'warm'),
    productionTargetCount: countTargets(report, (target) => hasEvidence(target, 'production or platform workflow')),
    businessSystemTargetCount: countTargets(report, (target) => hasEvidence(target, 'business-system integration')),
    workflowControlSurfaceCount: countTargets(report, (target) => hasEvidence(target, 'workflow control surface')),
    sprintMotionCount: countTargets(report, (target) => normalizeText(target.motion).toLowerCase() === 'sprint'),
    proMotionCount: countTargets(report, (target) => normalizeText(target.motion).toLowerCase() === 'pro'),
    painSignals: collectPainSignals(report),
  };
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'workflow_sprint_intake',
      name: 'Workflow Hardening Sprint intake',
      url: buildTrackedLinkedinLink(links.sprintLink, {
        utmCampaign: 'linkedin_sprint_intake',
        utmContent: 'workflow_sprint',
        campaignVariant: 'pain_confirmed',
        offerCode: 'LINKEDIN-SPRINT_INTAKE',
        ctaId: 'linkedin_sprint_intake',
        ctaPlacement: 'pack_surface',
        surface: 'linkedin_sprint',
      }),
      supportUrl: LANDING_SOURCE_URL,
      evidenceSource: 'docs/landing-page.html',
      operatorUse: 'Primary CTA once a buyer names one repeated workflow failure, one owner, and one approval boundary.',
      buyerSignal: 'Platform, engineering, or AI-product lead who already feels rollout risk in one active workflow.',
    },
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedLinkedinLink(GUIDE_URL, {
        utmCampaign: 'linkedin_setup_guide',
        utmContent: 'setup',
        campaignVariant: 'self_serve_interest',
        offerCode: 'LINKEDIN-SETUP_GUIDE',
        ctaId: 'linkedin_setup_guide',
        ctaPlacement: 'pack_surface',
      }),
      supportUrl: GUIDE_SOURCE_URL,
      evidenceSource: 'public/guide.html',
      operatorUse: 'Use when the buyer asks for the install path before they are ready for a sprint conversation.',
      buyerSignal: 'Builder or engineering lead who wants to evaluate install friction, proof, and pricing before deeper discovery.',
    },
    {
      key: 'repeat_mistakes_guide',
      name: 'Repeated-mistakes guide',
      url: buildTrackedLinkedinLink(REPEAT_MISTAKES_GUIDE_URL, {
        utmCampaign: 'linkedin_repeat_mistakes',
        utmContent: 'guide',
        campaignVariant: 'workflow_risk',
        offerCode: 'LINKEDIN-REPEAT_GUIDE',
        ctaId: 'linkedin_repeat_mistakes',
        ctaPlacement: 'pack_surface',
      }),
      supportUrl: REPEAT_MISTAKES_GUIDE_SOURCE_URL,
      evidenceSource: 'public/guides/claude-code-prevent-repeated-mistakes.html',
      operatorUse: 'Lead with this surface when the buyer names repeated review drift, context risk, or unsafe tool-call repetition.',
      buyerSignal: 'Teams that can already name one recurring workflow mistake and need a proof-backed explanation of the fix loop.',
    },
    {
      key: 'verification_evidence',
      name: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
      supportUrl: COMMERCIAL_TRUTH_LINK,
      evidenceSource: 'docs/VERIFICATION_EVIDENCE.md',
      operatorUse: 'Send only after pain is confirmed and the buyer asks for proof, quality, or rollout evidence.',
      buyerSignal: 'Pain-confirmed buyer who asks to see proof before committing to a sprint or self-serve path.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with a 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated workflow failure, one owner, and one approval boundary.',
      cta: buildTrackedLinkedinLink(links.sprintLink, {
        utmCampaign: 'linkedin_follow_on_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'LINKEDIN-FOLLOW_ON_SPRINT',
        ctaId: 'linkedin_follow_on_sprint',
        ctaPlacement: 'post_install',
        surface: 'linkedin_follow_on',
      }),
    },
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo operators who confirmed the failure pattern and now want the self-serve path, dashboard, and proof-ready exports.',
      cta: buildTrackedLinkedinLink(links.proCheckoutLink, {
        utmCampaign: 'linkedin_follow_on_pro',
        utmContent: 'pro',
        campaignVariant: 'solo_follow_on',
        offerCode: 'LINKEDIN-FOLLOW_ON_PRO',
        ctaId: 'linkedin_follow_on_pro',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'linkedin_follow_on',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const backstop = buildEvidenceBackstop(report);
  const painSignals = formatPainSignals(report);
  const sprintLink = buildTrackedLinkedinLink(links.sprintLink, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_queue_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'pain_confirmed',
    offerCode: 'LINKEDIN-QUEUE_SPRINT',
    ctaId: 'linkedin_queue_sprint',
    ctaPlacement: 'operator_queue',
    surface: 'linkedin_outreach',
  });
  const guideLink = buildTrackedLinkedinLink(GUIDE_URL, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_queue_guide',
    utmContent: 'guide',
    campaignVariant: 'self_serve_interest',
    offerCode: 'LINKEDIN-QUEUE_GUIDE',
    ctaId: 'linkedin_queue_guide',
    ctaPlacement: 'operator_queue',
    surface: 'linkedin_outreach',
  });
  const proLink = buildTrackedLinkedinLink(links.proCheckoutLink, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_queue_pro',
    utmContent: 'pro',
    campaignVariant: 'self_serve_follow_on',
    offerCode: 'LINKEDIN-QUEUE_PRO',
    ctaId: 'linkedin_queue_pro',
    ctaPlacement: 'operator_queue',
    planId: 'pro',
    surface: 'linkedin_outreach',
  });

  return [
    {
      key: 'warm_workflow_owner',
      audience: 'Warm workflow owner who already named repeated rollout pain',
      evidence: `${backstop.warmTargetCount} warm target(s) already named ${painSignals}.`,
      proofTrigger: 'The buyer confirms the workflow is active now and wants one founder-led diagnostic instead of more generic AI tooling.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      nextAsk: sprintLink,
      recommendedMotion: 'Workflow Hardening Sprint first. Use proof only after pain is confirmed.',
    },
    {
      key: 'business_system_operator',
      audience: 'Platform or ops lead wiring agents into Jira, GitHub, ServiceNow, Slack, or CRM workflows',
      evidence: `${backstop.productionTargetCount} production-style target(s), ${backstop.businessSystemTargetCount} business-system target(s), and ${backstop.workflowControlSurfaceCount} workflow-control target(s) point to approval boundaries and rollback safety as the strongest LinkedIn angle.`,
      proofTrigger: 'They can name one approval boundary, rollback risk, or bad handoff that blocks broader rollout.',
      proofAsset: COMMERCIAL_TRUTH_LINK,
      nextAsk: sprintLink,
      recommendedMotion: 'Discovery DM -> sprint intake -> proof pack once the workflow risk is explicit.',
    },
    {
      key: 'self_serve_follow_on',
      audience: 'Individual builder who asks for the tool path after the workflow pain is qualified',
      evidence: `${backstop.proMotionCount} current target(s) skew self-serve after qualification, but the guide should still carry the proof and pricing guardrails first.`,
      proofTrigger: 'The buyer explicitly asks for install, pricing, or self-serve instead of founder-led workflow help.',
      proofAsset: GUIDE_SOURCE_URL,
      nextAsk: `${guideLink} then ${proLink}`,
      recommendedMotion: 'Guide -> proof -> Pro after the buyer asks for the tool path.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks(), report = {}) {
  const painSignals = formatPainSignals(report);
  const sprintLink = buildTrackedLinkedinLink(links.sprintLink, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'pain_confirmed',
    offerCode: 'LINKEDIN-OUTREACH_SPRINT',
    ctaId: 'linkedin_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'linkedin_outreach',
  });
  const guideLink = buildTrackedLinkedinLink(GUIDE_URL, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_outreach_guide',
    utmContent: 'guide',
    campaignVariant: 'self_serve_interest',
    offerCode: 'LINKEDIN-OUTREACH_GUIDE',
    ctaId: 'linkedin_outreach_guide',
    ctaPlacement: 'outreach_draft',
    surface: 'linkedin_outreach',
  });
  const proLink = buildTrackedLinkedinLink(links.proCheckoutLink, {
    utmMedium: DM_MEDIUM,
    utmCampaign: 'linkedin_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'self_serve_follow_on',
    offerCode: 'LINKEDIN-OUTREACH_PRO',
    ctaId: 'linkedin_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'linkedin_outreach',
  });

  return [
    {
      key: 'connection_request',
      channel: 'LinkedIn connection request',
      audience: 'Platform, engineering, or AI-product lead',
      draft: 'I work on one narrow problem: making one AI-agent workflow safe enough to roll out before it touches a repo, approval step, or customer system. If you are already seeing repeated workflow mistakes, approval-boundary drift, or rollback risk, that is exactly the lane I would like to compare notes on.',
    },
    {
      key: 'warm_dm',
      channel: 'LinkedIn DM',
      audience: 'Pain-aware buyer who already named one workflow risk',
      draft: `The strongest signals in this week’s queue are not generic AI interest. They are repeated workflow failures like ${painSignals}. I am not selling a generic agent platform into that. I am offering to harden one workflow end-to-end with prevention rules, approval boundaries, and a proof run. If that maps to one workflow on your side, start here: ${sprintLink} .`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Buyer who asked for proof or the self-serve path',
      draft: `Now that the workflow failure is concrete, move from pitch to evidence. Send Verification Evidence plus Commercial Truth first: ${VERIFICATION_EVIDENCE_LINK} and ${COMMERCIAL_TRUTH_LINK} . If they want founder-led help, route them to ${sprintLink} . If they only want the install path, use ${guideLink} and then ${proLink} .`,
    },
  ];
}

function buildChannelDrafts(links = buildRevenueLinks(), report = {}) {
  const backstop = buildEvidenceBackstop(report);
  const painSignals = formatPainSignals(report);
  const guideLink = buildTrackedLinkedinLink(GUIDE_URL, {
    utmCampaign: 'linkedin_channel_guide',
    utmContent: 'guide',
    campaignVariant: 'proof_backed_setup',
    offerCode: 'LINKEDIN-CHANNEL_GUIDE',
    ctaId: 'linkedin_channel_guide',
    ctaPlacement: 'channel_draft',
    surface: 'linkedin_post',
  });
  const sprintLink = buildTrackedLinkedinLink(links.sprintLink, {
    utmMedium: COMMENT_MEDIUM,
    utmCampaign: 'linkedin_channel_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'pain_confirmed',
    offerCode: 'LINKEDIN-CHANNEL_SPRINT',
    ctaId: 'linkedin_channel_sprint',
    ctaPlacement: 'channel_draft',
    surface: 'linkedin_comment',
  });
  const repeatGuideLink = buildTrackedLinkedinLink(REPEAT_MISTAKES_GUIDE_URL, {
    utmMedium: COMMENT_MEDIUM,
    utmCampaign: 'linkedin_channel_repeat_guide',
    utmContent: 'guide',
    campaignVariant: 'workflow_risk',
    offerCode: 'LINKEDIN-CHANNEL_REPEAT',
    ctaId: 'linkedin_channel_repeat_guide',
    ctaPlacement: 'channel_draft',
    surface: 'linkedin_comment',
  });

  return [
    {
      key: 'linkedin_founder_post',
      channel: 'LinkedIn',
      format: 'Founder post',
      audience: 'Platform, engineering, and AI-product leaders',
      evidenceSummary: `${backstop.warmTargetCount} warm target(s) plus ${backstop.productionTargetCount} production-style target(s) show the strongest LinkedIn motion is workflow hardening, not generic AI hype.`,
      cta: guideLink,
      proofTiming: 'Keep the public post workflow-first and guide-first. Hold proof links for comments or DMs after the buyer names the workflow risk.',
      draft: `The strongest AI workflow conversations I am seeing right now are not about replacing engineers. They are about one workflow that still is not safe enough to roll out. The repeated pain shows up as ${painSignals}. Once agents touch repos, approvals, or customer systems, the real question becomes: what stops the same mistake from running again? My answer is one workflow hardening lane: feedback, prevention rules, approval boundaries, rollback safety, and proof. If that is the problem you are evaluating, start with the proof-backed guide here: ${guideLink} .`,
    },
    {
      key: 'linkedin_first_comment',
      channel: 'LinkedIn',
      format: 'First comment',
      audience: 'Buyer who engages with the public post',
      evidenceSummary: 'The first comment should keep one CTA live without turning the post into a proof dump.',
      cta: sprintLink,
      proofTiming: 'Comment can carry the sprint CTA, but keep Commercial Truth and Verification Evidence in reserve until pain is confirmed.',
      draft: `If you already have one workflow where approval boundaries, rollback safety, or repeated tool-call mistakes are blocking rollout, use the Workflow Hardening Sprint intake here: ${sprintLink} .`,
    },
    {
      key: 'linkedin_reply_follow_up',
      channel: 'LinkedIn',
      format: 'Reply or DM follow-up',
      audience: 'Commenter who named repeated workflow risk',
      evidenceSummary: `${backstop.workflowControlSurfaceCount} workflow-control target(s) and ${backstop.businessSystemTargetCount} business-system target(s) make workflow-risk follow-up more credible than a generic product pitch.`,
      cta: repeatGuideLink,
      proofTiming: 'Use the repeated-mistakes guide in the reply first. Send proof links only if they ask for evidence after naming the workflow.',
      draft: `That is exactly the kind of workflow risk I am talking about. The useful next step is not a bigger AI pitch. It is isolating the repeated mistake and deciding what check should fire before the next risky action runs. This guide is the shortest explanation of that loop: ${repeatGuideLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'linkedin_workflow_risk_to_paid_intent',
    policy: 'Treat LinkedIn traffic as acquisition evidence only after a tracked guide click, sprint-intake movement, or qualified conversation exists.',
    minimumUsefulSignal: 'One tracked qualified workflow-hardening conversation or one sprint-intake submission sourced from LinkedIn.',
    strongSignal: 'Three tracked paid-intent events across qualified conversations, sprint-intake moves, or Pro checkout starts sourced from LinkedIn.',
    metrics: [
      'linkedin_post_clicks',
      'linkedin_comment_clicks',
      'linkedin_dm_replies',
      'workflow_sprint_intake_submissions',
      'qualified_workflow_conversations',
      'pro_checkout_starts',
      'paid_orders_by_source_linkedin',
    ],
    guardrails: [
      'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Run founder-post plus comment and DM follow-up using one workflow-hardening offer with tracked CTAs.',
        decisionRule: 'If LinkedIn clicks exist without qualified replies, tighten the post around one explicit workflow pain instead of broad AI-governance framing.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote the better-converting LinkedIn path: sprint-first or guide-first.',
        decisionRule: 'Only move proof earlier if replies show clear pain but stall before a tracked intake or guide click.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether LinkedIn remains a founder-led acquisition lane or needs more direct outbound and proof sequencing.',
        decisionRule: 'Do not scale LinkedIn outbound volume until there is qualified-conversation or paid-intent evidence from the tracked links.',
      },
    ],
    doNotCountAsSuccess: [
      'impressions or reactions without tracked clicks',
      'guide clicks without qualified workflow pain',
      'unverified revenue, install, or marketplace claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'LinkedIn should carry one offer: workflow hardening for teams that already feel rollout risk.',
    directiveHeadline || 'Use LinkedIn to create proof-backed workflow conversations, not vanity engagement.',
  ].join(' ');
}

function buildLinkedinWorkflowHardeningPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn LinkedIn workflow-risk conversations into tracked guide clicks, qualified workflow-hardening conversations, sprint-intake movement, and self-serve follow-on only after pain is qualified.',
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
    outreachDrafts: buildOutreachDrafts(links, report),
    channelDrafts: buildChannelDrafts(links, report),
    measurementPlan: buildMeasurementPlan(),
    evidenceBackstop: buildEvidenceBackstop(report),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderLinkedinOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderLinkedinChannelDraftsCsv(pack = {}) {
  const drafts = Array.isArray(pack.channelDrafts) ? pack.channelDrafts : [];
  const rows = [
    ['key', 'channel', 'format', 'audience', 'evidenceSummary', 'cta', 'proofTiming', 'draft'],
    ...drafts.map((draft) => ([
      draft.key,
      draft.channel,
      draft.format,
      draft.audience,
      draft.evidenceSummary,
      draft.cta,
      draft.proofTiming,
      draft.draft,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderLinkedinWorkflowHardeningPackMarkdown(pack = {}) {
  const surfaceLines = Array.isArray(pack.surfaces) && pack.surfaces.length
    ? pack.surfaces.flatMap((surface) => ([
      `### ${surface.name}`,
      `- Buyer signal: ${surface.buyerSignal}`,
      `- Operator use: ${surface.operatorUse}`,
      `- Surface URL: ${surface.url}`,
      `- Support: ${surface.supportUrl}`,
      `- Proof: ${surface.proofUrl}`,
      '',
    ]))
    : ['- No demand surfaces available.', ''];
  const offerLines = Array.isArray(pack.followOnOffers) && pack.followOnOffers.length
    ? pack.followOnOffers.map((offer) => `- ${offer.label}: ${offer.pricing}\n  Buyer: ${offer.buyer}\n  CTA: ${offer.cta}`)
    : ['- No follow-on offers available.'];
  const queueLines = Array.isArray(pack.operatorQueue) && pack.operatorQueue.length
    ? pack.operatorQueue.flatMap((entry) => ([
      `### ${entry.audience}`,
      `- Evidence: ${entry.evidence}`,
      `- Proof trigger: ${entry.proofTrigger}`,
      `- Proof asset: ${entry.proofAsset}`,
      `- Next ask: ${entry.nextAsk}`,
      `- Recommended motion: ${entry.recommendedMotion}`,
      '',
    ]))
    : ['- No operator queue entries available.', ''];
  const outreachLines = Array.isArray(pack.outreachDrafts) && pack.outreachDrafts.length
    ? pack.outreachDrafts.flatMap((draft) => ([
      `### ${draft.channel} — ${draft.audience}`,
      draft.draft,
      '',
    ]))
    : ['- No outreach drafts available.', ''];
  const channelLines = Array.isArray(pack.channelDrafts) && pack.channelDrafts.length
    ? pack.channelDrafts.flatMap((draft) => ([
      `### ${draft.channel} — ${draft.format}`,
      `- Audience: ${draft.audience}`,
      `- Evidence: ${draft.evidenceSummary}`,
      `- CTA: ${draft.cta}`,
      `- Proof timing: ${draft.proofTiming}`,
      draft.draft,
      '',
    ]))
    : ['- No LinkedIn channel drafts available.', ''];
  const listLines = (values = []) => (Array.isArray(values) && values.length ? values.map((entry) => `- ${entry}`) : ['- n/a']);
  const milestoneLines = Array.isArray(pack.measurementPlan?.milestones) && pack.measurementPlan.milestones.length
    ? pack.measurementPlan.milestones.map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
    : ['- No milestones available.'];
  const painSignals = Array.isArray(pack.evidenceBackstop?.painSignals) ? pack.evidenceBackstop.painSignals : [];

  return [
    '# LinkedIn Workflow Hardening Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of sent outreach, paid revenue, installs, or marketplace approval by itself.',
    '',
    '## Objective',
    pack.objective,
    '',
    '## Positioning',
    `- State: ${pack.state}`,
    `- Headline: ${pack.headline}`,
    `- Short description: ${pack.shortDescription}`,
    `- Summary: ${pack.summary}`,
    '',
    '## Canonical Identity',
    ...CANONICAL_FIELDS.map((field) => `- ${field.label}: ${pack.canonicalIdentity?.[field.key] || field.fallback || ''}`),
    '',
    '## Demand Surfaces',
    ...surfaceLines,
    '## Follow-On Offers',
    ...offerLines,
    '',
    '## Operator Queue',
    ...queueLines,
    '## Outreach Drafts',
    ...outreachLines,
    '## Active Channel Drafts',
    ...channelLines,
    '## Evidence Backstop',
    `- Warm targets: ${pack.evidenceBackstop?.warmTargetCount ?? 0}`,
    `- Production-style targets: ${pack.evidenceBackstop?.productionTargetCount ?? 0}`,
    `- Business-system targets: ${pack.evidenceBackstop?.businessSystemTargetCount ?? 0}`,
    `- Workflow-control targets: ${pack.evidenceBackstop?.workflowControlSurfaceCount ?? 0}`,
    `- Sprint-motion targets: ${pack.evidenceBackstop?.sprintMotionCount ?? 0}`,
    `- Pro-motion targets: ${pack.evidenceBackstop?.proMotionCount ?? 0}`,
    `- Named pain signals: ${painSignals.length ? painSignals.join(', ') : 'n/a'}`,
    '',
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...listLines(pack.measurementPlan?.metrics),
    'Guardrails:',
    ...listLines(pack.measurementPlan?.guardrails),
    'Milestones:',
    ...milestoneLines,
    'Do not count as success:',
    ...listLines(pack.measurementPlan?.doNotCountAsSuccess),
    '',
    '## Proof Links',
    ...listLines(pack.proofLinks),
    '',
  ].join('\n');
}

function writeLinkedinWorkflowHardeningPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'linkedin-workflow-hardening-pack.md'),
    markdown: renderLinkedinWorkflowHardeningPackMarkdown(pack),
    jsonName: 'linkedin-workflow-hardening-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'linkedin-operator-queue.csv',
        value: renderLinkedinOperatorQueueCsv(pack),
      },
      {
        name: 'linkedin-channel-drafts.csv',
        value: renderLinkedinChannelDraftsCsv(pack),
      },
    ],
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildLinkedinWorkflowHardeningPack(readRevenueLoopReport());
  const written = writeLinkedinWorkflowHardeningPack(pack, options);

  console.log('LinkedIn workflow hardening pack ready.');
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
    channelDrafts: pack.channelDrafts.length,
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
  GUIDE_URL,
  REPEAT_MISTAKES_GUIDE_URL,
  REVENUE_LOOP_REPORT_PATH,
  buildChannelDrafts,
  buildEvidenceBackstop,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildLinkedinWorkflowHardeningPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedLinkedinLink,
  buildMeasurementPlan,
  collectPainSignals,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderLinkedinChannelDraftsCsv,
  renderLinkedinOperatorQueueCsv,
  renderLinkedinWorkflowHardeningPackMarkdown,
  writeLinkedinWorkflowHardeningPack,
};
