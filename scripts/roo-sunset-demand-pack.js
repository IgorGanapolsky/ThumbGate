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
const ROO_MIGRATION_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/roo-code-alternative-cline';
const CLINE_INSTALL_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md';
const ROO_SUNSET_DOC_URL = 'https://docs.roocode.com/';
const ROO_SUNSET_BLOG_URL = 'https://roocode.com/blog/sunsetting-roo-code-extension-cloud-and-router';
const OUTREACH_MEDIUM = 'operator_outreach';
const REDDIT_MEDIUM = 'reddit_post';
const LINKEDIN_MEDIUM = 'linkedin_post';
const THREADS_MEDIUM = 'threads_post';
const BLUESKY_MEDIUM = 'bluesky_post';
const ROO_SOURCE = 'roo_sunset';
const ROO_SURFACE = 'roo_migration';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn Roo shutdown urgency into memory-portable paid intent.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives Roo migrants one durable asset to keep: local lesson memory that survives the move to Cline and becomes enforceable Pre-Action Checks.';
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];
const TRACKING_DEFAULTS = {
  utmSource: ROO_SOURCE,
  utmMedium: 'migration_pack',
  utmCampaign: 'roo_sunset_migration',
  utmContent: 'pack',
  surface: ROO_SURFACE,
};

function buildTrackedRooLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function buildTrackedRooMigrationGuideLink(tracking = {}) {
  return buildTrackedRooLink(ROO_MIGRATION_GUIDE_URL, tracking);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function countTargets(report, matcher) {
  const resolvedReport = report || {};
  const targets = Array.isArray(resolvedReport.targets) ? resolvedReport.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function hasEvidence(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function buildEvidenceBackstop(report = {}) {
  return {
    warmTargetCount: countTargets(report, (target) => normalizeText(target.temperature).toLowerCase() === 'warm'),
    selfServeTargetCount: countTargets(report, (target) => normalizeText(target.offer).toLowerCase() === 'pro_self_serve'),
    sprintTargetCount: countTargets(report, (target) => normalizeText(target.offer).toLowerCase() === 'workflow_hardening_sprint'),
    workflowControlSurfaceCount: countTargets(report, (target) => hasEvidence(target, 'workflow control surface')),
    businessSystemTargetCount: countTargets(report, (target) => hasEvidence(target, 'business-system integration')),
  };
}

function buildEvidenceSurfaces(links, about) {
  const resolvedLinks = links || buildRevenueLinks();
  const resolvedAbout = about || readGitHubAbout();

  return [
    {
      key: 'roo_shutdown_notice',
      name: 'Roo shutdown notice',
      url: ROO_SUNSET_DOC_URL,
      supportUrl: ROO_SUNSET_BLOG_URL,
      evidenceSource: 'Primary Roo documentation and announcement',
      operatorUse: 'Use as the time-bound trigger only to establish why Roo users need a migration path now.',
      buyerSignal: 'Roo users facing a hard May 15, 2026 shutdown who need a successor and a way to keep lesson memory.',
    },
    {
      key: 'roo_migration_guide',
      name: 'ThumbGate Roo migration guide',
      url: buildTrackedRooMigrationGuideLink({
        utmCampaign: 'roo_migration_guide',
        utmContent: 'guide',
        campaignVariant: 'owned_surface',
        offerCode: 'ROO-MIGRATION_GUIDE',
        ctaId: 'roo_migration_guide',
        ctaPlacement: 'pack_surface',
      }),
      supportUrl: CLINE_INSTALL_URL,
      evidenceSource: 'public/guides/roo-code-alternative-cline.html',
      operatorUse: 'Primary first-touch surface when the buyer needs the migration story, the successor recommendation, and the next install step in one owned page.',
      buyerSignal: 'Roo users who have not yet accepted the successor path and need a migration rationale before they ask for the exact install doc.',
    },
    {
      key: 'cline_install_guide',
      name: 'Cline install guide',
      url: buildTrackedRooLink(CLINE_INSTALL_URL, {
        utmCampaign: 'roo_cline_install',
        utmContent: 'install_doc',
        campaignVariant: 'migration_path',
        offerCode: 'ROO-CLINE_INSTALL',
        ctaId: 'roo_cline_install',
        ctaPlacement: 'pack_surface',
      }),
      supportUrl: CLINE_INSTALL_URL,
      evidenceSource: 'adapters/cline/INSTALL.md',
      operatorUse: 'Use after the owned migration guide lands and the buyer asks for the exact install path.',
      buyerSignal: 'Roo users who already accepted Cline as the successor and want the shortest install path plus local memory continuity.',
    },
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedRooLink(GUIDE_URL, {
        utmCampaign: 'roo_setup_guide',
        utmContent: 'setup',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'ROO-SETUP_GUIDE',
        ctaId: 'roo_setup_guide',
        ctaPlacement: 'pack_surface',
      }),
      supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
      evidenceSource: 'public/guide.html',
      operatorUse: 'Use after the migration story lands and the buyer wants proof, install clarity, and pricing guardrails.',
      buyerSignal: 'Operators who want a clean self-serve path and only then want the paid lane.',
    },
    {
      key: 'verification_evidence',
      name: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
      supportUrl: COMMERCIAL_TRUTH_LINK,
      evidenceSource: 'docs/VERIFICATION_EVIDENCE.md',
      operatorUse: 'Send only after the buyer confirms the workflow pain or asks for proof and commercial truth.',
      buyerSignal: 'Pain-confirmed Roo migrants who need evidence before choosing Pro or a workflow sprint.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: resolvedAbout.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: resolvedLinks.appOrigin,
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Roo migrants who want the self-serve dashboard, proof-ready exports, and local-first lesson continuity after the Cline move.',
      cta: buildTrackedRooLink(links.proCheckoutLink, {
        utmCampaign: 'roo_follow_on_pro',
        utmContent: 'pro',
        campaignVariant: 'self_serve_follow_on',
        offerCode: 'ROO-FOLLOW_ON_PRO',
        ctaId: 'roo_follow_on_pro',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'roo_follow_on',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already know their Roo migration touches one production workflow with approval boundaries, rollback risk, or bad handoffs.',
      cta: buildTrackedRooLink(links.sprintLink, {
        utmCampaign: 'roo_follow_on_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'ROO-FOLLOW_ON_SPRINT',
        ctaId: 'roo_follow_on_sprint',
        ctaPlacement: 'post_install',
        surface: 'roo_follow_on',
      }),
    },
  ];
}

function buildOperatorQueue(links, report) {
  const resolvedLinks = links || buildRevenueLinks();
  const resolvedReport = report || {};
  const backstop = buildEvidenceBackstop(resolvedReport);
  return [
    {
      key: 'roo_memory_migrant',
      audience: 'Roo user who needs lesson memory to survive the move to Cline',
      evidence: 'Roo officially documents the May 15, 2026 shutdown and recommends Cline as the open-source successor. ThumbGate already ships the Cline install guide and keeps lessons in a local SQLite file.',
      proofTrigger: 'They can name one correction from Roo they do not want to reteach after migrating.',
      proofAsset: ROO_MIGRATION_GUIDE_URL,
      nextAsk: buildTrackedRooMigrationGuideLink({
        utmCampaign: 'roo_queue_guide',
        utmContent: 'guide',
        campaignVariant: 'memory_migrant',
        offerCode: 'ROO-QUEUE_GUIDE',
        ctaId: 'roo_queue_guide',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Roo migration guide -> Cline install guide -> setup guide -> Pro only after one saved correction is concrete.',
    },
    {
      key: 'roo_workflow_owner',
      audience: 'Team migrating one risky workflow off Roo',
      evidence: `${backstop.workflowControlSurfaceCount} workflow-control target(s), ${backstop.businessSystemTargetCount} business-system target(s), and ${backstop.sprintTargetCount} sprint-fit target(s) already favor workflow hardening over a generic plugin pitch.`,
      proofTrigger: 'They can point to one approval boundary, rollback risk, or repo workflow that cannot afford repeated mistakes during migration.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      nextAsk: buildTrackedRooLink(resolvedLinks.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'roo_queue_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'migration_workflow',
        offerCode: 'ROO-QUEUE_SPRINT',
        ctaId: 'roo_queue_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'roo_outreach',
      }),
      recommendedMotion: 'Workflow Hardening Sprint first. Use proof only after the workflow risk is explicit.',
    },
    {
      key: 'roo_self_serve_evaluator',
      audience: 'Local-first buyer who wants the tool path before founder-led help',
      evidence: `${backstop.selfServeTargetCount} self-serve target(s) in the live queue already skew toward guide-first evaluation once the migration urgency is understood.`,
      proofTrigger: 'They ask for install, pricing, or the dashboard path instead of workflow consulting.',
      proofAsset: GUIDE_URL,
      nextAsk: buildTrackedRooLink(GUIDE_URL, {
        utmCampaign: 'roo_queue_guide',
        utmContent: 'setup',
        campaignVariant: 'self_serve_interest',
        offerCode: 'ROO-QUEUE_GUIDE',
        ctaId: 'roo_queue_guide',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Setup guide -> commercial truth -> Pro after the buyer asks for the tool path.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const migrationGuideLink = buildTrackedRooMigrationGuideLink({
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'roo_outreach_guide',
    utmContent: 'guide',
    campaignVariant: 'memory_migrant',
    offerCode: 'ROO-OUTREACH_GUIDE',
    ctaId: 'roo_outreach_guide',
    ctaPlacement: 'outreach_draft',
    surface: 'roo_outreach',
  });
  const guideLink = buildTrackedRooLink(GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'roo_outreach_guide',
    utmContent: 'guide',
    campaignVariant: 'proof_backed_setup',
    offerCode: 'ROO-OUTREACH_GUIDE',
    ctaId: 'roo_outreach_guide',
    ctaPlacement: 'outreach_draft',
    surface: 'roo_outreach',
  });
  const sprintLink = buildTrackedRooLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'roo_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'migration_workflow',
    offerCode: 'ROO-OUTREACH_SPRINT',
    ctaId: 'roo_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'roo_outreach',
  });
  const proLink = buildTrackedRooLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'roo_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'self_serve_follow_on',
    offerCode: 'ROO-OUTREACH_PRO',
    ctaId: 'roo_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'roo_outreach',
  });

  return [
    {
      key: 'memory_migrant_dm',
      channel: 'GitHub DM or founder reply',
      audience: 'Roo user who wants their corrections to survive the move to Cline',
      draft: `Roo can sunset. Your lesson memory should not. The clean first step is the migration guide: ${migrationGuideLink} . It explains the Cline successor path, why portable lesson memory matters, and where the exact install doc lives when they are ready.`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'Buyer who already named one repeated workflow failure',
      draft: `Once the migration risk is concrete, move from urgency to proof. Send Verification Evidence plus Commercial Truth first: ${VERIFICATION_EVIDENCE_LINK} and ${COMMERCIAL_TRUTH_LINK} . If they want the self-serve lane, use ${guideLink} then ${proLink} . If they want help hardening one workflow before rollout, route them to ${sprintLink} .`,
    },
    {
      key: 'workflow_owner_note',
      channel: 'Founder note',
      audience: 'Team owner migrating one production workflow off Roo',
      draft: `A Roo-to-Cline move is not the hard part. Keeping one risky workflow from relearning the same repo, approval, or rollback mistake is the hard part. If that workflow already exists on your side, use the Workflow Hardening Sprint intake here: ${sprintLink} .`,
    },
  ];
}

function buildChannelDrafts(links, report) {
  const resolvedLinks = links || buildRevenueLinks();
  const resolvedReport = report || {};
  const backstop = buildEvidenceBackstop(resolvedReport);
  return [
    {
      key: 'roo_reddit_memory',
      channel: 'Reddit',
      format: 'Migration post',
      audience: 'Roo user evaluating Cline as the successor',
      evidenceSummary: 'The public Roo shutdown notice creates urgency, but the strongest first-touch angle is still memory portability rather than abstract governance.',
      cta: buildTrackedRooMigrationGuideLink({
        utmMedium: REDDIT_MEDIUM,
        utmCampaign: 'roo_channel_reddit',
        utmContent: 'guide',
        campaignVariant: 'memory_portability',
        offerCode: 'ROO-CHANNEL-REDDIT',
        ctaId: 'roo_channel_reddit',
        ctaPlacement: 'channel_draft',
        surface: 'roo_reddit',
      }),
      proofTiming: 'Lead with the migration path first. Hold proof links for replies or DMs after the buyer names the repeated mistake.',
      draft: `Roo sunsets on May 15, 2026. Cline is the obvious successor, but the real migration question is whether your agent keeps its corrections. ThumbGate keeps those lessons in a local SQLite file so the move is not “reteach everything from scratch.” Migration guide: ${buildTrackedRooMigrationGuideLink({
        utmMedium: REDDIT_MEDIUM,
        utmCampaign: 'roo_channel_reddit',
        utmContent: 'guide',
        campaignVariant: 'memory_portability',
        offerCode: 'ROO-CHANNEL-REDDIT',
        ctaId: 'roo_channel_reddit',
        ctaPlacement: 'channel_draft',
        surface: 'roo_reddit',
      })} .`,
    },
    {
      key: 'roo_linkedin_workflow',
      channel: 'LinkedIn',
      format: 'Founder post',
      audience: 'Platform or AI-product lead migrating one workflow off Roo',
      evidenceSummary: `${backstop.sprintTargetCount} sprint-fit target(s) plus ${backstop.businessSystemTargetCount} business-system target(s) make workflow-risk migration the strongest B2B Roo angle.`,
      cta: buildTrackedRooLink(resolvedLinks.sprintLink, {
        utmMedium: LINKEDIN_MEDIUM,
        utmCampaign: 'roo_channel_linkedin',
        utmContent: 'workflow_sprint',
        campaignVariant: 'migration_workflow',
        offerCode: 'ROO-CHANNEL-LINKEDIN',
        ctaId: 'roo_channel_linkedin',
        ctaPlacement: 'channel_draft',
        surface: 'roo_linkedin',
      }),
      proofTiming: 'Public post can reference the shutdown, but hold proof links until the buyer confirms one workflow risk.',
      draft: `Roo shutting down is a forcing function, not the real problem. The real problem is migrating one live workflow without reteaching approval boundaries, rollback rules, and repo-specific mistakes from zero. If your team already has that workflow in mind, start with the Workflow Hardening Sprint here: ${buildTrackedRooLink(resolvedLinks.sprintLink, {
        utmMedium: LINKEDIN_MEDIUM,
        utmCampaign: 'roo_channel_linkedin',
        utmContent: 'workflow_sprint',
        campaignVariant: 'migration_workflow',
        offerCode: 'ROO-CHANNEL-LINKEDIN',
        ctaId: 'roo_channel_linkedin',
        ctaPlacement: 'channel_draft',
        surface: 'roo_linkedin',
      })} .`,
    },
    {
      key: 'roo_threads_setup',
      channel: 'Threads',
      format: 'Short post',
      audience: 'Solo Roo builder who wants the cleanest self-serve move',
      evidenceSummary: `${backstop.selfServeTargetCount} current self-serve target(s) already support a guide-first motion once the buyer accepts the memory-portability story.`,
      cta: buildTrackedRooMigrationGuideLink({
        utmMedium: THREADS_MEDIUM,
        utmCampaign: 'roo_channel_threads',
        utmContent: 'guide',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'ROO-CHANNEL-THREADS',
        ctaId: 'roo_channel_threads',
        ctaPlacement: 'channel_draft',
        surface: 'roo_threads',
      }),
      proofTiming: 'Keep first touch on the Roo-specific guide. Send proof links only after the buyer replies with a concrete migration or workflow risk.',
      draft: `Roo can go away without taking your agent memory with it. ThumbGate keeps the lessons local, then turns them into Pre-Action Checks after you move to Cline. Start with the Roo migration guide: ${buildTrackedRooMigrationGuideLink({
        utmMedium: THREADS_MEDIUM,
        utmCampaign: 'roo_channel_threads',
        utmContent: 'guide',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'ROO-CHANNEL-THREADS',
        ctaId: 'roo_channel_threads',
        ctaPlacement: 'channel_draft',
        surface: 'roo_threads',
      })} .`,
    },
    {
      key: 'roo_bluesky_local_first',
      channel: 'Bluesky',
      format: 'Short post',
      audience: 'Local-first evaluator burned by vendor-scoped memory',
      evidenceSummary: `${backstop.warmTargetCount} warm target(s) and the Roo sunset itself reinforce the local-first point: vendor-scoped memory is operational debt.`,
      cta: buildTrackedRooMigrationGuideLink({
        utmMedium: BLUESKY_MEDIUM,
        utmCampaign: 'roo_channel_bluesky',
        utmContent: 'guide',
        campaignVariant: 'local_first',
        offerCode: 'ROO-CHANNEL-BLUESKY',
        ctaId: 'roo_channel_bluesky',
        ctaPlacement: 'channel_draft',
        surface: 'roo_bluesky',
      }),
      proofTiming: 'Lead with the local-first claim and the Roo-specific guide, not proof links, on the public post.',
      draft: `Roo shutting down is a reminder that vendor-scoped memory is a bad design. Keep the lessons in your repo, move to Cline, and turn them into enforceable checks instead of another lost context window. Start here: ${buildTrackedRooMigrationGuideLink({
        utmMedium: BLUESKY_MEDIUM,
        utmCampaign: 'roo_channel_bluesky',
        utmContent: 'guide',
        campaignVariant: 'local_first',
        offerCode: 'ROO-CHANNEL-BLUESKY',
        ctaId: 'roo_channel_bluesky',
        ctaPlacement: 'channel_draft',
        surface: 'roo_bluesky',
      })} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'roo_migration_to_paid_intent',
    policy: 'Treat Roo migration traffic as acquisition evidence only after a tracked install-doc click, setup-guide click, qualified sprint conversation, or Pro checkout start exists.',
    minimumUsefulSignal: 'One tracked install-doc click plus one paid-intent event sourced from a Roo-tagged migration surface.',
    strongSignal: 'Three tracked paid-intent events across sprint conversations or Pro checkout starts sourced from Roo migration surfaces.',
    metrics: [
      'roo_install_doc_clicks',
      'roo_setup_guide_clicks',
      'roo_sprint_intake_submissions',
      'roo_qualified_workflow_conversations',
      'roo_pro_checkout_starts',
      'paid_orders_by_source_roo_sunset',
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
        goal: 'Exploit the shutdown window with one migration story: keep lesson memory, move to Cline, then route to proof-backed setup or one workflow sprint.',
        decisionRule: 'Do not broaden the angle beyond Roo migration unless the tracked clicks fail to produce qualified replies or paid intent.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote the better-converting Roo lane: self-serve Pro or workflow sprint.',
        decisionRule: 'If clicks exist without paid intent, move the proof-backed setup and commercial-truth handoff earlier in follow-up copy.',
      },
      {
        window: 'days_61_90',
        goal: 'Retire the event-specific Roo framing unless it still produces paid-intent evidence versus broader workflow-hardening lanes.',
        decisionRule: 'Only keep the Roo-specific pack prominent while it still outperforms broader memory-portability positioning.',
      },
    ],
    doNotCountAsSuccess: [
      'shutdown-post impressions without tracked clicks',
      'install-doc clicks without paid-intent evidence',
      'unverified revenue, install, or partner-approval claims',
    ],
  };
}

function buildRooSunsetDemandPack(report, links, about) {
  const resolvedReport = report || readRevenueLoopReport();
  const resolvedLinks = links || buildRevenueLinks();
  const resolvedAbout = about || readGitHubAbout();
  const directive = resolvedReport.directive || {};
  const state = normalizeText(directive.state) || 'post-first-dollar';
  const summary = normalizeText(directive.headline)
    || 'Use the Roo shutdown window to sell one honest migration outcome: keep lesson memory, prove the install path, then route buyers to Pro or one workflow sprint.';

  return {
    generatedAt: resolvedReport.generatedAt || new Date().toISOString(),
    objective: 'Turn Roo shutdown urgency into tracked migration clicks, proof-backed setup demand, and paid intent without inventing traction.',
    state,
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary,
    canonicalIdentity: {
      displayName: 'ThumbGate',
      repositoryUrl: resolvedAbout.repositoryUrl,
      homepageUrl: resolvedAbout.homepageUrl,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(resolvedLinks, resolvedAbout),
    followOnOffers: buildFollowOnOffers(resolvedLinks),
    operatorQueue: buildOperatorQueue(resolvedLinks, resolvedReport),
    outreachDrafts: buildOutreachDrafts(resolvedLinks),
    channelDrafts: buildChannelDrafts(resolvedLinks, resolvedReport),
    measurementPlan: buildMeasurementPlan(),
    evidenceBackstop: buildEvidenceBackstop(resolvedReport),
    proofLinks: [...PROOF_LINKS, ROO_SUNSET_DOC_URL, ROO_SUNSET_BLOG_URL],
  };
}

function renderChannelDraftsCsv(pack = {}) {
  const drafts = Array.isArray(pack.channelDrafts) ? pack.channelDrafts : [];
  const rows = [
    ['key', 'channel', 'format', 'audience', 'evidenceSummary', 'cta', 'proofTiming', 'draft'],
    ...drafts.map((entry) => ([
      entry.key,
      entry.channel,
      entry.format,
      entry.audience,
      entry.evidenceSummary,
      entry.cta,
      entry.proofTiming,
      entry.draft,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderRooSunsetDemandPackMarkdown(pack = {}) {
  const channelDrafts = Array.isArray(pack.channelDrafts) ? pack.channelDrafts : [];
  const channelLines = channelDrafts.length
    ? channelDrafts.flatMap((draft) => ([
      `### ${draft.channel} — ${draft.format}`,
      `- Audience: ${draft.audience}`,
      `- Evidence: ${draft.evidenceSummary}`,
      `- CTA: ${draft.cta}`,
      `- Proof timing: ${draft.proofTiming}`,
      draft.draft,
      '',
    ]))
    : ['- No channel drafts available.', ''];
  const backstop = pack.evidenceBackstop || {};

  return [
    '# Roo Sunset Demand Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of sent outreach, installs, paid revenue, or partner approval by itself.',
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
    ...CANONICAL_FIELDS.map((field) => `- ${field.label}: ${normalizeText(pack.canonicalIdentity?.[field.key]) || field.fallback}`),
    '',
    '## Demand Surfaces',
    ...(pack.surfaces || []).flatMap((surface) => ([
      `### ${surface.name}`,
      `- Buyer signal: ${surface.buyerSignal}`,
      `- Operator use: ${surface.operatorUse}`,
      `- Surface URL: ${surface.url}`,
      `- Support: ${surface.supportUrl}`,
      `- Proof: ${surface.proofUrl}`,
      '',
    ])),
    '## Follow-On Offers',
    ...(pack.followOnOffers || []).map((offer) => `- ${offer.label}: ${offer.pricing}\n  Buyer: ${offer.buyer}\n  CTA: ${offer.cta}`),
    '',
    '## Operator Queue',
    ...(pack.operatorQueue || []).flatMap((entry) => ([
      `### ${entry.audience}`,
      `- Evidence: ${entry.evidence}`,
      `- Proof trigger: ${entry.proofTrigger}`,
      `- Proof asset: ${entry.proofAsset}`,
      `- Next ask: ${entry.nextAsk}`,
      `- Recommended motion: ${entry.recommendedMotion}`,
      '',
    ])),
    '## Outreach Drafts',
    ...(pack.outreachDrafts || []).flatMap((draft) => ([
      `### ${draft.channel} — ${draft.audience}`,
      draft.draft,
      '',
    ])),
    '## Active Channel Drafts',
    ...channelLines,
    '## Evidence Backstop',
    `- Warm targets: ${backstop.warmTargetCount || 0}`,
    `- Self-serve targets: ${backstop.selfServeTargetCount || 0}`,
    `- Sprint-fit targets: ${backstop.sprintTargetCount || 0}`,
    `- Workflow-control targets: ${backstop.workflowControlSurfaceCount || 0}`,
    `- Business-system targets: ${backstop.businessSystemTargetCount || 0}`,
    '',
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...((pack.measurementPlan?.metrics || []).map((metric) => `- ${metric}`)),
    'Guardrails:',
    ...((pack.measurementPlan?.guardrails || []).map((item) => `- ${item}`)),
    'Milestones:',
    ...((pack.measurementPlan?.milestones || []).map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)),
    'Do not count as success:',
    ...((pack.measurementPlan?.doNotCountAsSuccess || []).map((item) => `- ${item}`)),
    '',
    '## Proof Links',
    ...((pack.proofLinks || []).map((link) => `- ${link}`)),
    '',
  ].join('\n');
}

function writeRooSunsetDemandPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'roo-sunset-demand-pack.md'),
    markdown: renderRooSunsetDemandPackMarkdown(pack),
    jsonName: 'roo-sunset-demand-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'roo-sunset-operator-queue.csv',
        value: renderOperatorQueueCsv(pack?.operatorQueue),
      },
      {
        name: 'roo-sunset-channel-drafts.csv',
        value: renderChannelDraftsCsv(pack),
      },
    ],
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  return parseReportArgs(argv);
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

if (isCliInvocation(process.argv)) {
  const options = parseArgs(process.argv.slice(2));
  const pack = buildRooSunsetDemandPack();
  writeRooSunsetDemandPack(pack, options);
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  CLINE_INSTALL_URL,
  GUIDE_URL,
  ROO_MIGRATION_GUIDE_URL,
  ROO_SUNSET_BLOG_URL,
  ROO_SUNSET_DOC_URL,
  buildChannelDrafts,
  buildEvidenceBackstop,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildRooSunsetDemandPack,
  buildTrackedRooLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderChannelDraftsCsv,
  renderRooSunsetDemandPackMarkdown,
  writeRooSunsetDemandPack,
};
