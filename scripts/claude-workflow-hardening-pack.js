#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildUTMLink } = require('./social-analytics/utm');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');
const {
  csvCell,
  isCliInvocation: isCliCall,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const CLAUDE_SOURCE = 'claude';
const GUIDE_MEDIUM = 'guide_surface';
const OUTREACH_MEDIUM = 'operator_outreach';
const CLAUDE_SURFACE = 'claude';
const CLAUDE_DESKTOP_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/claude-desktop';
const CLAUDE_CODE_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/claude-code-prevent-repeated-mistakes';
const CLAUDE_SECTION_URL = 'https://thumbgate-production.up.railway.app/#claude-desktop';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const CLAUDE_BUNDLE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb';
const CLAUDE_REVIEW_PACKET_URL = 'https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip';
const CLAUDE_DESKTOP_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/claude-desktop.html';
const CLAUDE_CODE_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/claude-code-prevent-repeated-mistakes.html';
const CLAUDE_PLUGIN_README_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/.claude-plugin/README.md';
const CLAUDE_EXTENSION_PLAN_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/CLAUDE_DESKTOP_EXTENSION.md';
const CLAUDE_LANDING_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/landing-page.html';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn Claude install demand into workflow-hardening paid intent.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives Claude Desktop and Claude Code a proof-backed install path, thumbs-up/down feedback capture, and Pre-Action Checks that block repeated workflow mistakes before the next risky action runs.';

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function buildTrackedClaudeLink(baseUrl, tracking = {}) {
  const url = new URL(buildUTMLink(baseUrl, {
    source: tracking.utmSource || CLAUDE_SOURCE,
    medium: tracking.utmMedium || GUIDE_MEDIUM,
    campaign: tracking.utmCampaign || 'claude_workflow_hardening',
    content: tracking.utmContent || 'guide',
  }));
  const extras = {
    campaign_variant: tracking.campaignVariant,
    offer_code: tracking.offerCode,
    cta_id: tracking.ctaId,
    cta_placement: tracking.ctaPlacement,
    plan_id: tracking.planId,
    surface: tracking.surface || CLAUDE_SURFACE,
  };

  for (const [key, value] of Object.entries(extras)) {
    const normalized = normalizeText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }

  return url.toString();
}

function hasEvidence(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function isWarmTarget(target) {
  return normalizeText(target?.temperature).toLowerCase() === 'warm';
}

function isClaudeTarget(target) {
  const haystack = [
    target?.accountName,
    target?.repoName,
    target?.description,
    target?.source,
    target?.channel,
  ].map((value) => normalizeText(value)).join(' ').toLowerCase();
  return /claude/.test(haystack);
}

function countTargets(matcher, report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'claude_desktop_guide',
      name: 'Claude Desktop guide',
      url: buildTrackedClaudeLink(CLAUDE_DESKTOP_GUIDE_URL, {
        utmCampaign: 'claude_desktop_guide',
        utmContent: 'seo_page',
        campaignVariant: 'desktop_install',
        offerCode: 'CLAUDE-DESKTOP_GUIDE',
        ctaId: 'claude_desktop_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: CLAUDE_DESKTOP_GUIDE_SOURCE_URL,
      evidenceSource: 'public/guides/claude-desktop.html',
      operatorUse: 'Primary install and buyer-education surface for Claude Desktop users who want a proof-backed local setup path.',
      buyerSignal: 'High-intent evaluators who want to install now, keep data local, and avoid building a bundle from source.',
    },
    {
      key: 'claude_code_repeat_mistakes_guide',
      name: 'Claude Code repeated-mistakes guide',
      url: buildTrackedClaudeLink(CLAUDE_CODE_GUIDE_URL, {
        utmCampaign: 'claude_code_repeat_mistakes',
        utmContent: 'seo_page',
        campaignVariant: 'workflow_pain',
        offerCode: 'CLAUDE-CODE_REPEAT',
        ctaId: 'claude_code_repeat_mistakes',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: CLAUDE_CODE_GUIDE_SOURCE_URL,
      evidenceSource: 'public/guides/claude-code-prevent-repeated-mistakes.html',
      operatorUse: 'Use when the buyer already feels repeated Claude Code mistakes and needs the shortest path from pain to prevention.',
      buyerSignal: 'Claude Code users who can already name one repeated command, branch, or file-edit mistake they want blocked.',
    },
    {
      key: 'claude_bundle_download',
      name: 'Direct Claude Desktop bundle download',
      url: CLAUDE_BUNDLE_URL,
      supportUrl: CLAUDE_PLUGIN_README_URL,
      evidenceSource: '.claude-plugin/README.md',
      operatorUse: 'Portable install lane for buyers who want a ready-to-install bundle instead of a local build.',
      buyerSignal: 'Warm evaluators ready to install if the bundle, privacy path, and proof links are explicit.',
    },
    {
      key: 'claude_review_ready_lane',
      name: 'Review-ready Claude install lane',
      url: buildTrackedClaudeLink(CLAUDE_SECTION_URL, {
        utmCampaign: 'claude_review_ready_lane',
        utmContent: 'landing_section',
        campaignVariant: 'marketplace_review',
        offerCode: 'CLAUDE-REVIEW_READY',
        ctaId: 'claude_review_ready_lane',
        ctaPlacement: 'landing_surface',
      }),
      supportUrl: CLAUDE_EXTENSION_PLAN_URL,
      evidenceSource: 'docs/CLAUDE_DESKTOP_EXTENSION.md',
      operatorUse: 'Use when a team wants install-now clarity, repo marketplace fallback, and review-packet evidence without claiming directory approval.',
      buyerSignal: 'Platform owners who need privacy, proof, and rollout documentation before broader team distribution.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
}

function buildListingCopy(links = buildRevenueLinks()) {
  return {
    headline: 'Install ThumbGate for Claude and block the same mistake before it runs again.',
    subhead: 'ThumbGate gives Claude Desktop and Claude Code a local-first install path, proof-backed docs, and Pre-Action Checks that turn repeated workflow mistakes into enforced gates.',
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    proofBullets: [
      'Claude Desktop has a real install lane today: guide, direct .mcpb bundle, and review-ready source packet.',
      'Claude Code can install from the repo marketplace path while official directory review remains separate.',
      'Commercial Truth and Verification Evidence stay one click from the install and workflow-hardening path.',
    ],
    primaryCta: {
      label: 'Open Claude Desktop guide',
      url: buildTrackedClaudeLink(CLAUDE_DESKTOP_GUIDE_URL, {
        utmCampaign: 'claude_listing_primary',
        utmContent: 'guide',
        campaignVariant: 'desktop_install',
        offerCode: 'CLAUDE-LISTING_PRIMARY',
        ctaId: 'claude_listing_primary',
        ctaPlacement: 'listing_copy',
      }),
    },
    secondaryCta: {
      label: 'Download Claude bundle',
      url: CLAUDE_BUNDLE_URL,
    },
    proofCta: {
      label: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
    },
    marketplaceNote: 'Official directory review is separate. Use the repo marketplace path and review packet honestly while approval is pending.',
    followOnOffers: [
      {
        label: 'Workflow Hardening Sprint',
        url: buildTrackedClaudeLink(links.sprintLink, {
          utmCampaign: 'claude_listing_sprint',
          utmContent: 'workflow_sprint',
          campaignVariant: 'team_follow_on',
          offerCode: 'CLAUDE-LISTING_SPRINT',
          ctaId: 'claude_listing_sprint',
          ctaPlacement: 'listing_copy',
          surface: 'claude_post_install',
        }),
      },
      {
        label: 'ThumbGate Pro',
        url: buildTrackedClaudeLink(links.proCheckoutLink, {
          utmCampaign: 'claude_listing_pro',
          utmContent: 'pro',
          campaignVariant: 'solo_follow_on',
          offerCode: 'CLAUDE-LISTING_PRO',
          ctaId: 'claude_listing_pro',
          ctaPlacement: 'listing_copy',
          planId: 'pro',
          surface: 'claude_post_install',
        }),
      },
    ],
  };
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with a 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated Claude workflow failure, one owner, and one approval boundary.',
      cta: buildTrackedClaudeLink(links.sprintLink, {
        utmCampaign: 'claude_workflow_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'CLAUDE-TEAMS_FOLLOW_ON',
        ctaId: 'claude_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'claude_post_install',
      }),
    },
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Claude Desktop or Claude Code operators who proved one blocked repeat and want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedClaudeLink(links.proCheckoutLink, {
        utmCampaign: 'claude_workflow_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'solo_follow_on',
        offerCode: 'CLAUDE-PRO_FOLLOW_ON',
        ctaId: 'claude_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'claude_post_install',
      }),
    },
  ];
}

function buildProspectQueue(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];

  return targets.slice(0, 6).map((target, index) => ({
    key: `prospect_${index + 1}`,
    account: normalizeText(target.repoName)
      ? `${normalizeText(target.username)}/${normalizeText(target.repoName)}`
      : `@${normalizeText(target.username) || 'unknown'}`,
    temperature: normalizeText(target.temperature) || 'cold',
    motion: normalizeText(target.motionLabel || target.motion) || 'Workflow Hardening Sprint',
    reason: normalizeText(target.motionReason || target.outreachAngle || target.description) || 'No motion reason recorded.',
    evidence: Array.isArray(target.evidence) && target.evidence.length
      ? target.evidence.map((entry) => normalizeText(entry)).filter(Boolean).join(', ')
      : 'n/a',
    sourceUrl: normalizeText(target.repoUrl || target.contactUrl) || '',
    nextAsk: normalizeText(target.cta) || '',
  }));
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const installGuideLink = buildTrackedClaudeLink(CLAUDE_DESKTOP_GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'claude_outreach_install',
    utmContent: 'guide',
    campaignVariant: 'desktop_install',
    offerCode: 'CLAUDE-OUTREACH_INSTALL',
    ctaId: 'claude_outreach_install',
    ctaPlacement: 'outreach_draft',
    surface: 'claude_outreach',
  });
  const sprintLink = buildTrackedClaudeLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'claude_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'pain_confirmed',
    offerCode: 'CLAUDE-OUTREACH_SPRINT',
    ctaId: 'claude_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'claude_outreach',
  });
  const proLink = buildTrackedClaudeLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'claude_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'solo_follow_up',
    offerCode: 'CLAUDE-OUTREACH_PRO',
    ctaId: 'claude_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'claude_outreach',
  });

  return [
    {
      key: 'desktop_install_follow_up',
      channel: 'GitHub DM or email',
      audience: 'Claude Desktop or Claude Code operator',
      draft: `Claude already has a real ThumbGate install lane: local-first setup guide, direct bundle download, and repo-backed docs without pretending directory approval already happened. If one repeated branch, review-boundary, or file-edit mistake keeps showing up, start here: ${installGuideLink} .`,
    },
    {
      key: 'pain_confirmed_sprint',
      channel: 'Pain-confirmed follow-up',
      audience: 'Team owner who confirmed one repeated Claude workflow failure',
      draft: `Once the failure pattern is real, the next useful step is one workflow hardening sprint with proof, not another generic governance conversation. Use the sprint intake first, then attach Commercial Truth and Verification Evidence so the rollout stays inspectable: ${sprintLink} then ${COMMERCIAL_TRUTH_LINK} and ${VERIFICATION_EVIDENCE_LINK} .`,
    },
    {
      key: 'solo_pro_follow_up',
      channel: 'Follow-up note',
      audience: 'Solo operator who already proved one blocked repeat',
      draft: `If the local install already blocked one repeated Claude mistake, the paid next step is the personal dashboard plus proof-ready exports, not a bigger team rollout. Route that buyer to the Pro path only after the blocked repeat is concrete: ${proLink} .`,
    },
  ];
}

function buildChannelDrafts(report = {}, links = buildRevenueLinks()) {
  const warmClaudeTargetCount = countTargets((target) => isWarmTarget(target) && isClaudeTarget(target), report);
  const productionTargetCount = countTargets((target) => hasEvidence(target, 'production or platform workflow'), report);
  const businessSystemTargetCount = countTargets((target) => hasEvidence(target, 'business-system integration'), report);
  const redditSprintLink = buildTrackedClaudeLink(links.sprintLink, {
    utmMedium: 'reddit_dm',
    utmCampaign: 'claude_channel_reddit',
    utmContent: 'workflow_sprint',
    campaignVariant: 'warm_discovery',
    offerCode: 'CLAUDE-CHANNEL-REDDIT',
    ctaId: 'claude_channel_reddit',
    ctaPlacement: 'channel_draft',
    surface: 'claude_reddit',
  });
  const linkedinLaneLink = buildTrackedClaudeLink(CLAUDE_SECTION_URL, {
    utmMedium: 'linkedin_post',
    utmCampaign: 'claude_channel_linkedin',
    utmContent: 'landing_section',
    campaignVariant: 'review_ready',
    offerCode: 'CLAUDE-CHANNEL-LINKEDIN',
    ctaId: 'claude_channel_linkedin',
    ctaPlacement: 'channel_draft',
    surface: 'claude_linkedin',
  });
  const threadsGuideLink = buildTrackedClaudeLink(CLAUDE_DESKTOP_GUIDE_URL, {
    utmMedium: 'threads_post',
    utmCampaign: 'claude_channel_threads',
    utmContent: 'guide',
    campaignVariant: 'desktop_install',
    offerCode: 'CLAUDE-CHANNEL-THREADS',
    ctaId: 'claude_channel_threads',
    ctaPlacement: 'channel_draft',
    surface: 'claude_threads',
  });
  const blueskyGuideLink = buildTrackedClaudeLink(CLAUDE_CODE_GUIDE_URL, {
    utmMedium: 'bluesky_post',
    utmCampaign: 'claude_channel_bluesky',
    utmContent: 'guide',
    campaignVariant: 'workflow_pain',
    offerCode: 'CLAUDE-CHANNEL-BLUESKY',
    ctaId: 'claude_channel_bluesky',
    ctaPlacement: 'channel_draft',
    surface: 'claude_bluesky',
  });

  return [
    {
      key: 'reddit_warm_discovery',
      channel: 'Reddit',
      format: 'DM or reply follow-up',
      audience: 'Warm Claude or Cursor engager who already named a repeated workflow risk',
      evidenceSummary: `${warmClaudeTargetCount} warm Claude-flavored target(s) in the current report already named context risk, rollback risk, or brittle review boundaries.`,
      cta: redditSprintLink,
      proofTiming: 'Do not attach Commercial Truth or Verification Evidence until the buyer confirms the failure pattern.',
      draft: `You already called out the risky part of Claude workflows: the same failure keeps coming back when context shifts or review boundaries get blurry. I am not trying to sell you another agent platform. I am offering to harden one workflow end-to-end so the repeated failure becomes a Pre-Action Check with proof behind it. If you want to pick one workflow, start here: ${redditSprintLink} .`,
    },
    {
      key: 'linkedin_platform_post',
      channel: 'LinkedIn',
      format: 'Founder post',
      audience: 'Platform lead, consultancy owner, or AI delivery lead evaluating Claude rollout risk',
      evidenceSummary: `${productionTargetCount} production/platform targets and ${businessSystemTargetCount} business-system targets in the current report point to approval boundaries, rollback safety, and review-ready rollout proof as the strongest B2B angle.`,
      cta: linkedinLaneLink,
      proofTiming: 'Public post can mention proof-ready rollout, but keep the proof links for the reply or DM after pain is confirmed.',
      draft: `Teams already shipping with Claude usually do not need another agent platform. They need one workflow that stops repeating the same mistake before it touches a repo, approval step, or customer system. ThumbGate is the lane I use for that: local-first install, repeated-mistake capture, and Pre-Action Checks before the next risky action runs. If you are evaluating Claude rollout risk, start with the review-ready install lane here: ${linkedinLaneLink} .`,
    },
    {
      key: 'threads_operator_post',
      channel: 'Threads',
      format: 'Short post',
      audience: 'Solo Claude Desktop or Claude Code operator who wants a fast install-first proof path',
      evidenceSummary: 'Claude Desktop already has a live guide plus direct bundle path, so the strongest Threads motion is install-first and proof-second.',
      cta: threadsGuideLink,
      proofTiming: 'Keep the first touch install-first. Bring proof links in only after the buyer names the repeated mistake.',
      draft: `If Claude keeps repeating the same branch, review-boundary, or file-edit mistake, the useful fix is not another reminder in chat. Install a local-first gate and block the repeat before it runs again. ThumbGate for Claude starts here: ${threadsGuideLink} .`,
    },
    {
      key: 'bluesky_workflow_post',
      channel: 'Bluesky',
      format: 'Short post',
      audience: 'AI tooling builder or Claude Code operator who can already name one repeated workflow mistake',
      evidenceSummary: 'The current report shows the best cold-fit targets are workflow-control and production-proof buyers, so Bluesky should lead with one repeated workflow failure instead of generic governance.',
      cta: blueskyGuideLink,
      proofTiming: 'Use the guide link first. Only send Commercial Truth and Verification Evidence after the buyer replies with a concrete failure mode.',
      draft: `Claude Code is useful right up until it repeats the same risky workflow mistake. ThumbGate turns that repeat into a Pre-Action Check instead of another memory note. If you already know the failure pattern, start with the repeated-mistakes guide: ${blueskyGuideLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'claude_install_to_paid_intent',
    policy: 'Treat Claude installs as useful only when they produce a tracked sprint intake, Pro checkout start, or qualified team conversation.',
    minimumUsefulSignal: 'One tracked Workflow Hardening Sprint intake or Pro checkout start sourced from a Claude-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across sprint intakes, Pro checkout starts, or qualified team conversations.',
    metrics: [
      'claude_desktop_guide_views',
      'claude_code_repeat_mistakes_views',
      'claude_bundle_downloads',
      'claude_marketplace_doc_clicks',
      'claude_proof_clicks',
      'claude_sprint_intake_submissions',
      'claude_pro_checkout_starts',
      'claude_qualified_team_conversations',
    ],
    guardrails: [
      'Do not claim directory approval, installs, revenue, or outreach sends without direct command evidence.',
      'Do not lead first-touch Claude outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Keep the Claude Desktop guide, bundle path, and review-ready landing section aligned so install demand can convert into a named workflow problem.',
        decisionRule: 'Do not rewrite the Claude value proposition unless guide visits or bundle downloads fail to create paid-intent events.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever Claude lane converts best: install-first Pro or workflow-hardening sprint.',
        decisionRule: 'If install demand exists without paid intent, move the sprint CTA and proof path closer to the highest-intent Claude surface.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether to scale marketplace-style promotion or stay focused on workflow-hardening outreach.',
        decisionRule: 'Only increase marketplace/distribution effort once Claude-tagged installs or guide visits generate qualified conversations or checkout starts.',
      },
    ],
    doNotCountAsSuccess: [
      'bundle downloads without paid-intent events',
      'proof clicks without sprint intake or Pro checkout starts',
      'unverified directory approval or revenue claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'Claude demand in ThumbGate should stay install-first for evaluators and workflow-hardening-first for teams that already feel the pain.',
    directiveHeadline || 'No verified revenue and no active pipeline. Use the Claude install lane to create proof-backed paid intent, not vanity distribution.',
  ].join(' ');
}

function buildClaudeWorkflowHardeningPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  const warmClaudeTargetCount = countTargets((target) => isWarmTarget(target) && isClaudeTarget(target), report);
  const productionTargetCount = countTargets((target) => hasEvidence(target, 'production or platform workflow'), report);
  const businessSystemTargetCount = countTargets((target) => hasEvidence(target, 'business-system integration'), report);

  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn Claude install demand and workflow-hardening pain into tracked sprint intakes, proof clicks, and Pro checkout starts without making approval or revenue claims the repo cannot verify.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report),
    canonicalIdentity: {
      displayName: 'ThumbGate for Claude',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(links, about),
    listingCopy: buildListingCopy(links),
    followOnOffers: buildFollowOnOffers(links),
    prospectQueue: buildProspectQueue(report),
    outreachDrafts: buildOutreachDrafts(links),
    channelDrafts: buildChannelDrafts(report, links),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
    evidenceBackstop: {
      warmClaudeTargetCount,
      productionTargetCount,
      businessSystemTargetCount,
      landingSourceUrl: CLAUDE_LANDING_SOURCE_URL,
      reviewPacketUrl: CLAUDE_REVIEW_PACKET_URL,
    },
  };
}

function renderClaudeProspectQueueCsv(pack = {}) {
  const queue = Array.isArray(pack.prospectQueue) ? pack.prospectQueue : [];
  const rows = [
    ['key', 'account', 'temperature', 'motion', 'reason', 'evidence', 'sourceUrl', 'nextAsk'],
    ...queue.map((entry) => ([
      entry.key,
      entry.account,
      entry.temperature,
      entry.motion,
      entry.reason,
      entry.evidence,
      entry.sourceUrl,
      entry.nextAsk,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderClaudeSurfacesCsv(pack = {}) {
  const surfaces = Array.isArray(pack.surfaces) ? pack.surfaces : [];
  const rows = [
    ['key', 'name', 'buyerSignal', 'operatorUse', 'surfaceUrl', 'supportUrl', 'evidenceSource', 'proofUrl', 'proofLinks'],
    ...surfaces.map((surface) => ([
      surface.key,
      surface.name,
      surface.buyerSignal,
      surface.operatorUse,
      surface.url,
      surface.supportUrl,
      surface.evidenceSource,
      surface.proofUrl,
      Array.isArray(surface.proofLinks) ? surface.proofLinks.join('; ') : '',
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderClaudeSurfaceLines(pack = {}) {
  return Array.isArray(pack.surfaces) && pack.surfaces.length
    ? pack.surfaces.flatMap((surface) => ([
      `### ${surface.name}`,
      `- Buyer signal: ${surface.buyerSignal}`,
      `- Operator use: ${surface.operatorUse}`,
      `- Surface URL: ${surface.url}`,
      `- Support: ${surface.supportUrl}`,
      `- Proof: ${surface.proofUrl}`,
      '',
    ]))
    : ['- No verified Claude surfaces available.', ''];
}

function renderClaudeProofBulletLines(pack = {}) {
  return Array.isArray(pack.listingCopy?.proofBullets) && pack.listingCopy.proofBullets.length
    ? pack.listingCopy.proofBullets.map((entry) => `- ${entry}`)
    : ['- No proof bullets available.'];
}

function renderClaudeFollowOnOfferLines(pack = {}) {
  return Array.isArray(pack.followOnOffers) && pack.followOnOffers.length
    ? pack.followOnOffers.map((offer) => `- ${offer.label}: ${offer.pricing}\n  Buyer: ${offer.buyer}\n  CTA: ${offer.cta}`)
    : ['- No follow-on offers available.'];
}

function renderClaudeProspectLines(pack = {}) {
  return Array.isArray(pack.prospectQueue) && pack.prospectQueue.length
    ? pack.prospectQueue.map((entry) => {
      const nextAsk = entry.nextAsk ? ` Next ask: ${entry.nextAsk}` : '';
      return `- ${entry.account} (${entry.temperature}) -> ${entry.motion}. Reason: ${entry.reason} Evidence: ${entry.evidence}${nextAsk}`;
    })
    : ['- No queued prospects were available in this run.'];
}

function renderClaudeDraftLines(pack = {}) {
  return Array.isArray(pack.outreachDrafts) && pack.outreachDrafts.length
    ? pack.outreachDrafts.flatMap((draft) => ([
      `### ${draft.channel} — ${draft.audience}`,
      draft.draft,
      '',
    ]))
    : ['- No outreach drafts available.', ''];
}

function renderClaudeChannelDraftLines(pack = {}) {
  return Array.isArray(pack.channelDrafts) && pack.channelDrafts.length
    ? pack.channelDrafts.flatMap((draft) => ([
      `### ${draft.channel} — ${draft.format}`,
      `- Audience: ${draft.audience}`,
      `- Evidence: ${draft.evidenceSummary}`,
      `- CTA: ${draft.cta}`,
      `- Proof timing: ${draft.proofTiming}`,
      draft.draft,
      '',
    ]))
    : ['- No active-channel drafts available.', ''];
}

function renderClaudeMilestoneLines(pack = {}) {
  return Array.isArray(pack.measurementPlan?.milestones) && pack.measurementPlan.milestones.length
    ? pack.measurementPlan.milestones.map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
    : ['- No milestones available.'];
}

function renderClaudeProofLines(pack = {}) {
  return Array.isArray(pack.proofLinks) && pack.proofLinks.length
    ? pack.proofLinks.map((link) => `- ${link}`)
    : ['- No proof links available.'];
}

function renderClaudeListLines(values = []) {
  return Array.isArray(values) ? values.map((entry) => `- ${entry}`) : ['- n/a'];
}

function renderClaudeWorkflowHardeningPackMarkdown(pack = {}) {
  const listingOfferLines = renderClaudeListLines(pack.listingCopy?.followOnOffers?.map((offer) => `${offer.label} -> ${offer.url}`));

  return [
    '# Claude Workflow Hardening Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of sent outreach, directory approval, paid revenue, or deployment success by itself.',
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
    `- Display name: ${pack.canonicalIdentity?.displayName || 'ThumbGate for Claude'}`,
    `- Repository: ${pack.canonicalIdentity?.repositoryUrl || ''}`,
    `- Homepage: ${pack.canonicalIdentity?.homepageUrl || ''}`,
    `- Commercial truth: ${pack.canonicalIdentity?.commercialTruthUrl || ''}`,
    `- Verification evidence: ${pack.canonicalIdentity?.verificationEvidenceUrl || ''}`,
    '',
    '## Verified Claude Surfaces',
    ...renderClaudeSurfaceLines(pack),
    '## Marketplace Listing Copy',
    `- Headline: ${pack.listingCopy?.headline || 'n/a'}`,
    `- Subhead: ${pack.listingCopy?.subhead || 'n/a'}`,
    `- Short description: ${pack.listingCopy?.shortDescription || 'n/a'}`,
    'Proof bullets:',
    ...renderClaudeProofBulletLines(pack),
    `- Primary CTA: ${pack.listingCopy?.primaryCta?.label || 'n/a'} -> ${pack.listingCopy?.primaryCta?.url || ''}`,
    `- Secondary CTA: ${pack.listingCopy?.secondaryCta?.label || 'n/a'} -> ${pack.listingCopy?.secondaryCta?.url || ''}`,
    `- Proof CTA: ${pack.listingCopy?.proofCta?.label || 'n/a'} -> ${pack.listingCopy?.proofCta?.url || ''}`,
    `- Marketplace note: ${pack.listingCopy?.marketplaceNote || 'n/a'}`,
    'Follow-on listing offers:',
    ...listingOfferLines,
    '',
    '## Follow-On Offers',
    ...renderClaudeFollowOnOfferLines(pack),
    '',
    '## Prospect Queue',
    ...renderClaudeProspectLines(pack),
    '',
    '## Outreach Drafts',
    ...renderClaudeDraftLines(pack),
    '## Active Channel Drafts',
    ...renderClaudeChannelDraftLines(pack),
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...renderClaudeListLines(pack.measurementPlan?.metrics),
    'Guardrails:',
    ...renderClaudeListLines(pack.measurementPlan?.guardrails),
    'Milestones:',
    ...renderClaudeMilestoneLines(pack),
    'Do not count as success:',
    ...renderClaudeListLines(pack.measurementPlan?.doNotCountAsSuccess),
    '',
    '## Evidence Backstop',
    `- Warm Claude targets in current report: ${pack.evidenceBackstop?.warmClaudeTargetCount ?? 0}`,
    `- Production or platform targets in current report: ${pack.evidenceBackstop?.productionTargetCount ?? 0}`,
    `- Business-system targets in current report: ${pack.evidenceBackstop?.businessSystemTargetCount ?? 0}`,
    `- Landing source: ${pack.evidenceBackstop?.landingSourceUrl || ''}`,
    `- Review packet: ${pack.evidenceBackstop?.reviewPacketUrl || ''}`,
    '',
    '## Proof Links',
    ...renderClaudeProofLines(pack),
    '',
  ].join('\n');
}

function writeClaudeWorkflowHardeningPack(pack, options = {}) {
  const docsPath = path.join(REPO_ROOT, 'docs', 'marketing', 'claude-workflow-hardening-pack.md');

  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath,
    markdown: renderClaudeWorkflowHardeningPackMarkdown(pack),
    jsonName: 'claude-workflow-hardening-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'claude-prospect-queue.csv',
        value: renderClaudeProspectQueueCsv(pack),
      },
      {
        name: 'claude-install-surfaces.csv',
        value: renderClaudeSurfacesCsv(pack),
      },
    ],
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildClaudeWorkflowHardeningPack(readRevenueLoopReport());
  const written = writeClaudeWorkflowHardeningPack(pack, options);

  console.log('Claude workflow hardening pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: pack.surfaces.length,
    prospectQueue: pack.prospectQueue.length,
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
  CLAUDE_BUNDLE_URL,
  CLAUDE_CODE_GUIDE_URL,
  CLAUDE_DESKTOP_GUIDE_URL,
  CLAUDE_REVIEW_PACKET_URL,
  REVENUE_LOOP_REPORT_PATH,
  buildClaudeWorkflowHardeningPack,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildChannelDrafts,
  buildListingCopy,
  buildMeasurementPlan,
  buildOutreachDrafts,
  buildProspectQueue,
  buildTrackedClaudeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderClaudeProspectQueueCsv,
  renderClaudeSurfacesCsv,
  renderClaudeWorkflowHardeningPackMarkdown,
  writeClaudeWorkflowHardeningPack,
};
