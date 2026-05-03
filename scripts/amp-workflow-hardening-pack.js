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
const AMP_SOURCE = 'amp';
const REPO_MEDIUM = 'repo_install';
const OUTREACH_MEDIUM = 'operator_outreach';
const REDDIT_MEDIUM = 'reddit_dm';
const LINKEDIN_MEDIUM = 'linkedin_post';
const THREADS_MEDIUM = 'threads_post';
const BLUESKY_MEDIUM = 'bluesky_post';
const AMP_SURFACE = 'amp_cli';
const CANONICAL_HEADLINE = 'Turn Amp skill-install intent into proof-backed workflow safety.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives Amp a repo-backed skill install path, local feedback capture, and Pre-Action Checks that block repeated workflow mistakes before the next risky action runs.';
const README_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/README.md';
const AMP_INSTALL_DOC_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/amp-skill/INSTALL.md';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const AMP_MANUAL_URL = 'https://ampcode.com/manual';
const AMP_INVOKABLE_SKILLS_URL = 'https://ampcode.com/news/user-invokable-skills';
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'amp-workflow-hardening-pack.md');
const JSON_NAME = 'amp-workflow-hardening-pack.json';
const OPERATOR_QUEUE_CSV_NAME = 'amp-operator-queue.csv';
const CHANNEL_DRAFTS_CSV_NAME = 'amp-channel-drafts.csv';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const TRACKING_DEFAULTS = {
  utmSource: AMP_SOURCE,
  utmMedium: REPO_MEDIUM,
  utmCampaign: 'amp_skill_install',
  utmContent: 'install_doc',
  surface: AMP_SURFACE,
};

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

function buildExternalEvidence() {
  return [
    {
      key: 'amp_manual',
      label: 'Amp manual',
      url: AMP_MANUAL_URL,
      summary: 'Official Amp docs currently describe project-specific and user-wide skills, plus the `amp skill` CLI for managing skills.',
    },
    {
      key: 'amp_user_invokable_skills',
      label: 'Amp user-invokable skills',
      url: AMP_INVOKABLE_SKILLS_URL,
      summary: 'Amp published user-invokable skills on January 7, 2026, which makes evaluation-driven “use this skill on the next prompt” outreach credible.',
    },
  ];
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      key: 'amp_repo_skill_install',
      name: 'Amp repo-backed skill install',
      url: buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
        utmCampaign: 'amp_repo_skill_install',
        utmContent: 'install_doc',
        campaignVariant: 'repo_backed_skill',
        offerCode: 'AMP-REPO_INSTALL',
        ctaId: 'amp_repo_install',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: AMP_INSTALL_DOC_URL,
      evidenceSource: 'plugins/amp-skill/INSTALL.md',
      operatorUse: 'Primary install and trust surface for Amp operators who want a repo-backed skill path before they test one repeated failure.',
      buyerSignal: 'Amp operators evaluating whether ThumbGate already ships a committed skill install path without custom plugin packaging.',
      repositoryUrl: about.repositoryUrl,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      proofLinks: [...PROOF_LINKS],
      appOrigin: links.appOrigin,
    },
    {
      key: 'amp_supported_agent_path',
      name: 'Amp supported-agent entry point',
      url: buildTrackedAmpLink(README_URL, {
        utmCampaign: 'amp_supported_agent_path',
        utmContent: 'supported_agents',
        campaignVariant: 'agent_matrix',
        offerCode: 'AMP-AGENT_MATRIX',
        ctaId: 'amp_agent_matrix',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: README_URL,
      evidenceSource: 'README.md',
      operatorUse: 'Use when the buyer first asks whether ThumbGate already treats Amp as a first-class agent surface before discussing rollout.',
      buyerSignal: 'Evaluators who want to see Amp listed beside the other supported agents before they invest attention in the install path.',
      repositoryUrl: about.repositoryUrl,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      proofLinks: [...PROOF_LINKS],
      appOrigin: links.appOrigin,
    },
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedAmpLink(GUIDE_URL, {
        utmMedium: 'setup_guide',
        utmCampaign: 'amp_setup_guide',
        utmContent: 'setup',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'AMP-SETUP_GUIDE',
        ctaId: 'amp_setup_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
      evidenceSource: 'public/guide.html',
      operatorUse: 'General follow-on surface once the Amp buyer accepts the install story and wants proof, pricing guardrails, and next steps in one place.',
      buyerSignal: 'Operators who want an install path plus explicit proof and pricing guardrails before deciding between self-serve and a workflow-hardening conversation.',
      repositoryUrl: about.repositoryUrl,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      proofLinks: [...PROOF_LINKS],
      appOrigin: links.appOrigin,
    },
  ];
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Amp operators who proved one blocked repeat and want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedAmpLink(links.proCheckoutLink, {
        utmMedium: 'setup_guide',
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
        utmMedium: 'setup_guide',
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

function buildListingCopy(links = buildRevenueLinks()) {
  const primaryCta = buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmCampaign: 'amp_listing_primary',
    utmContent: 'install_doc',
    campaignVariant: 'repo_backed_skill',
    offerCode: 'AMP-LISTING_PRIMARY',
    ctaId: 'amp_listing_primary',
    ctaPlacement: 'listing_copy',
  });
  const secondaryCta = buildTrackedAmpLink(GUIDE_URL, {
    utmMedium: 'setup_guide',
    utmCampaign: 'amp_listing_setup_guide',
    utmContent: 'setup',
    campaignVariant: 'proof_backed_setup',
    offerCode: 'AMP-LISTING_SETUP',
    ctaId: 'amp_listing_setup',
    ctaPlacement: 'listing_copy',
  });
  const sprintCta = buildTrackedAmpLink(links.sprintLink, {
    utmMedium: 'setup_guide',
    utmCampaign: 'amp_listing_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'team_follow_on',
    offerCode: 'AMP-LISTING_SPRINT',
    ctaId: 'amp_listing_sprint',
    ctaPlacement: 'listing_copy',
    surface: 'amp_post_install',
  });
  const proCta = buildTrackedAmpLink(links.proCheckoutLink, {
    utmMedium: 'setup_guide',
    utmCampaign: 'amp_listing_pro',
    utmContent: 'pro',
    campaignVariant: 'solo_follow_on',
    offerCode: 'AMP-LISTING_PRO',
    ctaId: 'amp_listing_pro',
    ctaPlacement: 'listing_copy',
    planId: 'pro',
    surface: 'amp_post_install',
  });

  return {
    headline: 'Install ThumbGate for Amp and block the next repeated workflow mistake before it runs.',
    subhead: 'ThumbGate gives Amp a repo-backed skill install path, local feedback capture, and Pre-Action Checks that turn repeated workflow failures into enforceable gates.',
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    proofBullets: [
      'The repo already ships `plugins/amp-skill/INSTALL.md` with a copy-and-verify path for Amp.',
      'README.md already keeps `npx thumbgate init --agent amp` visible in the supported-agent matrix.',
      'Amp\'s current docs explicitly support project and user skills plus `amp skill` management, so the install-first motion is real.',
    ],
    primaryCta: {
      label: 'Open Amp install doc',
      url: primaryCta,
    },
    secondaryCta: {
      label: 'Open proof-backed setup guide',
      url: secondaryCta,
    },
    proofCta: {
      label: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
    },
    marketplaceNote: 'Do not imply a dedicated Amp marketplace or hosted guide that the repo cannot prove today. Lead with the repo-backed skill install path first.',
    followOnOffers: [
      {
        label: 'Workflow Hardening Sprint',
        url: sprintCta,
      },
      {
        label: 'ThumbGate Pro',
        url: proCta,
      },
    ],
  };
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const selfServeTargetCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));
  const workflowControlTargetCount = countTargets(report, (target) => hasEvidence(target, 'workflow control surface'));
  const warmTargetCount = countTargets(report, (target) => normalizeText(target.temperature).toLowerCase() === 'warm');

  return [
    {
      key: 'repo_skill_operator',
      audience: 'Amp operator who wants a repo-backed skill install before testing one repeated failure',
      evidence: 'The repo already ships `plugins/amp-skill/INSTALL.md` with a copy command, verify flow, and feedback-capture smoke test.',
      proofTrigger: 'They can name one repeated Amp workflow mistake or risky tool call they want blocked after install.',
      proofAsset: AMP_INSTALL_DOC_URL,
      nextAsk: buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
        utmCampaign: 'amp_queue_repo_install',
        utmContent: 'install_doc',
        campaignVariant: 'repo_skill_operator',
        offerCode: 'AMP-QUEUE_REPO_INSTALL',
        ctaId: 'amp_queue_repo_install',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Repo install -> prove one blocked repeat -> Pro only after the repeat is concrete.',
    },
    {
      key: 'committed_skill_rollout',
      audience: 'Team evaluating Amp project-skill rollout with reviewable repo state',
      evidence: `Amp\'s official manual supports project-specific skills that can be committed to git, and the current report still shows ${workflowControlTargetCount} workflow-control target(s) where repo-backed rollout proof matters.`,
      proofTrigger: 'One workflow owner wants a committed skill, approval boundaries, and proof before they roll Amp wider across a team.',
      proofAsset: AMP_MANUAL_URL,
      nextAsk: buildTrackedAmpLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'amp_queue_rollout_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'committed_skill_rollout',
        offerCode: 'AMP-QUEUE_ROLLOUT_SPRINT',
        ctaId: 'amp_queue_rollout_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'amp_workflow_queue',
      }),
      recommendedMotion: 'Commit-ready skill story -> Workflow Hardening Sprint once one owner and one repeated failure are explicit.',
    },
    {
      key: 'invokable_skill_evaluator',
      audience: 'Amp evaluator who wants to force one skill on the next prompt before deciding',
      evidence: `Amp published user-invokable skills on January 7, 2026, and the current report still has ${warmTargetCount} warm target(s) plus ${selfServeTargetCount} self-serve tooling target(s) where a narrow evaluation ask is stronger than a generic pitch.`,
      proofTrigger: 'They want to invoke the skill on one real repeated failure and judge whether ThumbGate catches it before the next risky action.',
      proofAsset: AMP_INVOKABLE_SKILLS_URL,
      nextAsk: buildTrackedAmpLink(GUIDE_URL, {
        utmMedium: 'setup_guide',
        utmCampaign: 'amp_queue_invokable_eval',
        utmContent: 'setup',
        campaignVariant: 'invokable_skill_evaluator',
        offerCode: 'AMP-QUEUE_INVOKABLE',
        ctaId: 'amp_queue_invokable',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Invoke the skill on one repeat -> prove value -> route solo buyers to Pro or teams to the sprint.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const installDocLink = buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'amp_outreach_install',
    utmContent: 'install_doc',
    campaignVariant: 'repo_backed_skill',
    offerCode: 'AMP-OUTREACH_INSTALL',
    ctaId: 'amp_outreach_install',
    ctaPlacement: 'outreach_draft',
    surface: 'amp_outreach',
  });
  const sprintLink = buildTrackedAmpLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'amp_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'pain_confirmed',
    offerCode: 'AMP-OUTREACH_SPRINT',
    ctaId: 'amp_outreach_sprint',
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

  return [
    {
      key: 'repo_backed_install',
      channel: 'GitHub DM or email',
      audience: 'Amp operator who wants the shortest repo-backed install path',
      draft: `Amp already supports project and user skills, and ThumbGate already ships a repo-backed Amp install path here: ${installDocLink} . If you want to see whether one repeated workflow mistake can become a Pre-Action Check without inventing a new plugin surface first, start there and test one real repeat.`,
    },
    {
      key: 'pain_confirmed_sprint',
      channel: 'Pain-confirmed follow-up',
      audience: 'Team owner who already confirmed one repeated Amp workflow failure',
      draft: `Once the repeated failure is real, the next useful step is one workflow-hardening sprint with proof, not another generic guardrails conversation. Use the sprint intake first, then attach Commercial Truth and Verification Evidence so the rollout stays inspectable: ${sprintLink} then ${COMMERCIAL_TRUTH_LINK} and ${VERIFICATION_EVIDENCE_LINK} .`,
    },
    {
      key: 'solo_pro_follow_up',
      channel: 'Follow-up note',
      audience: 'Solo Amp operator who already proved one blocked repeat',
      draft: `If the Amp skill already blocked one repeated mistake, the paid next step is the personal dashboard plus proof-ready exports, not a bigger rollout story. Route that buyer to the Pro path only after the blocked repeat is concrete: ${proLink} .`,
    },
  ];
}

function buildChannelDrafts(links = buildRevenueLinks(), report = {}) {
  const warmTargetCount = countTargets(report, (target) => normalizeText(target.temperature).toLowerCase() === 'warm');
  const workflowControlTargetCount = countTargets(report, (target) => hasEvidence(target, 'workflow control surface'));
  const selfServeTargetCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));

  const redditCta = buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmMedium: REDDIT_MEDIUM,
    utmCampaign: 'amp_channel_reddit',
    utmContent: 'install_doc',
    campaignVariant: 'repo_backed_skill',
    offerCode: 'AMP-CHANNEL-REDDIT',
    ctaId: 'amp_channel_reddit',
    ctaPlacement: 'channel_draft',
    surface: 'amp_reddit',
  });
  const linkedinCta = buildTrackedAmpLink(GUIDE_URL, {
    utmMedium: LINKEDIN_MEDIUM,
    utmCampaign: 'amp_channel_linkedin',
    utmContent: 'setup',
    campaignVariant: 'team_rollout',
    offerCode: 'AMP-CHANNEL-LINKEDIN',
    ctaId: 'amp_channel_linkedin',
    ctaPlacement: 'channel_draft',
    surface: 'amp_linkedin',
  });
  const threadsCta = buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmMedium: THREADS_MEDIUM,
    utmCampaign: 'amp_channel_threads',
    utmContent: 'install_doc',
    campaignVariant: 'repeat_mistake',
    offerCode: 'AMP-CHANNEL-THREADS',
    ctaId: 'amp_channel_threads',
    ctaPlacement: 'channel_draft',
    surface: 'amp_threads',
  });
  const blueskyCta = buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmMedium: BLUESKY_MEDIUM,
    utmCampaign: 'amp_channel_bluesky',
    utmContent: 'install_doc',
    campaignVariant: 'invokable_skill',
    offerCode: 'AMP-CHANNEL-BLUESKY',
    ctaId: 'amp_channel_bluesky',
    ctaPlacement: 'channel_draft',
    surface: 'amp_bluesky',
  });

  return [
    {
      key: 'amp_reddit_repo_install',
      channel: 'Reddit',
      format: 'DM or reply follow-up',
      audience: 'Warm Amp or agent-tooling builder who already named one repeated workflow mistake',
      evidenceSummary: `${warmTargetCount} current warm target(s) already named repeated workflow pain, so Reddit should stay install-first and pain-specific instead of broad governance-first.`,
      cta: redditCta,
      proofTiming: 'Keep first touch install-first. Send Commercial Truth and Verification Evidence only after the buyer confirms the repeated failure.',
      draft: `If Amp keeps repeating the same workflow mistake, the fastest useful test is not another abstract guardrails thread. It is installing one repo-backed skill and checking whether it catches the next repeat before the risky action runs. Start here: ${redditCta} .`,
    },
    {
      key: 'amp_linkedin_rollout',
      channel: 'LinkedIn',
      format: 'Founder post',
      audience: 'Platform or engineering lead evaluating Amp rollout with reviewable repo state',
      evidenceSummary: `${workflowControlTargetCount} current workflow-control target(s) still make reviewable rollout state more credible than a generic AI productivity pitch.`,
      cta: linkedinCta,
      proofTiming: 'Keep the public post workflow-first and guide-first. Hold proof links for replies or DMs after the workflow risk is named.',
      draft: `Amp gets materially more interesting when the skill path is project-specific, reviewable, and tied to one repeated workflow failure instead of one-off personal prompts. That is the ThumbGate angle I trust: repo-backed install, local feedback capture, and one enforceable Pre-Action Check before the next risky action runs. If you are evaluating that rollout shape, start with the proof-backed setup guide here: ${linkedinCta} .`,
    },
    {
      key: 'amp_threads_repeat',
      channel: 'Threads',
      format: 'Short post',
      audience: 'Solo Amp operator who wants a fast path from install to one blocked repeat',
      evidenceSummary: `${selfServeTargetCount} current self-serve tooling target(s) reinforce the same solo motion: install first, prove one blocked repeat, then ask for the paid lane.`,
      cta: threadsCta,
      proofTiming: 'Do not attach proof links in the first touch. Keep the post install-first and move proof into follow-up only after pain is confirmed.',
      draft: `Amp skills are useful when they stop the next repeated workflow mistake, not when they only add one more markdown file. ThumbGate already ships the Amp skill path here: ${threadsCta} . Install it, prove one blocked repeat, then decide whether the workflow needs Pro or a harder team rollout.`,
    },
    {
      key: 'amp_bluesky_invokable',
      channel: 'Bluesky',
      format: 'Short post',
      audience: 'Evaluator who wants to force one Amp skill on the next prompt and judge the result fast',
      evidenceSummary: 'Amp now supports user-invokable skills, which makes a narrow “try this on your next repeated failure” message more credible than a broad automation pitch.',
      cta: blueskyCta,
      proofTiming: 'Lead with the install path first. Keep proof links in reserve until the buyer replies with a concrete failure pattern.',
      draft: `Amp now has user-invokable skills, which means you can test one real workflow failure instead of debating guardrails in the abstract. ThumbGate already ships the repo-backed Amp skill path here: ${blueskyCta} . Use it on one repeated mistake and decide from evidence instead of vibes.`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'amp_install_to_paid_intent',
    policy: 'Treat Amp install-doc clicks and setup-guide clicks as acquisition evidence only after a tracked Pro checkout start or qualified workflow-hardening conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified team conversation sourced from an Amp-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across Pro checkout starts or workflow sprint conversations.',
    metrics: [
      'amp_install_doc_clicks',
      'amp_setup_guide_clicks',
      'pro_checkout_starts',
      'sprint_intake_submissions',
      'qualified_team_conversations',
      'paid_conversions',
    ],
    guardrails: [
      'Do not claim a dedicated Amp marketplace, hosted guide, installs, or revenue without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Keep the repo-backed Amp install doc, setup guide follow-on, and outreach copy aligned around one blocked repeat.',
        decisionRule: 'Do not expand the Amp lane into a bigger launch story unless install-path clicks or conversations show real paid intent.',
      },
      {
        window: 'days_31_60',
        goal: 'Decide whether Amp converts better as a solo self-serve lane or as a workflow-hardening entry point for teams.',
        decisionRule: 'If install interest appears without paid intent, move proof and the offer split higher before adding more top-of-funnel copy.',
      },
      {
        window: 'days_61_90',
        goal: 'Only add a dedicated hosted Amp guide or broader outbound motion if the repo-backed lane produces qualified conversations or checkout starts.',
        decisionRule: 'Do not build more Amp surface area from speculation alone.',
      },
    ],
    doNotCountAsSuccess: [
      'install-doc clicks without a paid-intent event',
      'proof clicks without a tracked Pro checkout start or sprint conversation',
      'unverified install, marketplace, or revenue claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    'Amp demand in ThumbGate is install-first: prove the repo-backed skill path, then route one concrete repeated failure into either Pro or the Workflow Hardening Sprint.',
    directiveHeadline || 'No verified revenue and no active pipeline. Use Amp install surfaces to create proof-backed paid intent, not vanity traffic.',
  ].join(' ');
}

function buildAmpWorkflowHardeningPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn Amp skill-install intent into tracked repo-guide clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report),
    canonicalIdentity: {
      displayName: 'ThumbGate for Amp',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    surfaces: buildEvidenceSurfaces(links, about),
    externalEvidence: buildExternalEvidence(),
    listingCopy: buildListingCopy(links),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(links, report),
    outreachDrafts: buildOutreachDrafts(links),
    channelDrafts: buildChannelDrafts(links, report),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderAmpOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderAmpChannelDraftsCsv(pack = {}) {
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

function renderAmpWorkflowHardeningPackMarkdown(pack = {}) {
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
  const externalEvidenceLines = Array.isArray(pack.externalEvidence) && pack.externalEvidence.length
    ? pack.externalEvidence.flatMap((entry) => ([
      `- ${entry.label}: ${entry.summary} ${entry.url}`,
    ]))
    : ['- No external evidence sources available.'];
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
    : ['- No channel drafts available.', ''];
  const milestoneLines = Array.isArray(pack.measurementPlan?.milestones) && pack.measurementPlan.milestones.length
    ? pack.measurementPlan.milestones.map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
    : ['- No milestones available.'];
  const listingCopy = pack.listingCopy || {};
  const proofBullets = Array.isArray(listingCopy.proofBullets) && listingCopy.proofBullets.length
    ? listingCopy.proofBullets.map((bullet) => `- ${bullet}`)
    : ['- No listing proof bullets available.'];

  return [
    '# Amp Workflow Hardening Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of sent outreach, installs, paid revenue, or marketplace approval by itself.',
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
    `- Display name: ${pack.canonicalIdentity?.displayName || 'ThumbGate for Amp'}`,
    `- Repository: ${pack.canonicalIdentity?.repositoryUrl || ''}`,
    `- Homepage: ${pack.canonicalIdentity?.homepageUrl || ''}`,
    `- Commercial truth: ${pack.canonicalIdentity?.commercialTruthUrl || ''}`,
    `- Verification evidence: ${pack.canonicalIdentity?.verificationEvidenceUrl || ''}`,
    '',
    '## Demand Surfaces',
    ...surfaceLines,
    '## External Evidence',
    ...externalEvidenceLines,
    '',
    '## Listing Copy',
    `- Headline: ${listingCopy.headline || ''}`,
    `- Subhead: ${listingCopy.subhead || ''}`,
    `- Short description: ${listingCopy.shortDescription || ''}`,
    'Proof bullets:',
    ...proofBullets,
    `- Primary CTA: ${listingCopy.primaryCta?.label || ''} -> ${listingCopy.primaryCta?.url || ''}`,
    `- Secondary CTA: ${listingCopy.secondaryCta?.label || ''} -> ${listingCopy.secondaryCta?.url || ''}`,
    `- Proof CTA: ${listingCopy.proofCta?.label || ''} -> ${listingCopy.proofCta?.url || ''}`,
    `- Marketplace note: ${listingCopy.marketplaceNote || ''}`,
    '',
    '## Follow-On Offers',
    ...offerLines,
    '',
    '## Operator Queue',
    ...queueLines,
    '## Outreach Drafts',
    ...outreachLines,
    '## Active Channel Drafts',
    ...channelLines,
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...(Array.isArray(pack.measurementPlan?.metrics) && pack.measurementPlan.metrics.length
      ? pack.measurementPlan.metrics.map((metric) => `- ${metric}`)
      : ['- n/a']),
    'Guardrails:',
    ...(Array.isArray(pack.measurementPlan?.guardrails) && pack.measurementPlan.guardrails.length
      ? pack.measurementPlan.guardrails.map((guardrail) => `- ${guardrail}`)
      : ['- n/a']),
    'Milestones:',
    ...milestoneLines,
    'Do not count as success:',
    ...(Array.isArray(pack.measurementPlan?.doNotCountAsSuccess) && pack.measurementPlan.doNotCountAsSuccess.length
      ? pack.measurementPlan.doNotCountAsSuccess.map((entry) => `- ${entry}`)
      : ['- n/a']),
    '',
    '## Proof Links',
    ...(Array.isArray(pack.proofLinks) && pack.proofLinks.length
      ? pack.proofLinks.map((link) => `- ${link}`)
      : ['- No proof links available.']),
    '',
  ].join('\n');
}

function writeAmpWorkflowHardeningPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: DOCS_PATH,
    markdown: renderAmpWorkflowHardeningPackMarkdown(pack),
    jsonName: JSON_NAME,
    jsonValue: pack,
    csvArtifacts: [
      {
        name: OPERATOR_QUEUE_CSV_NAME,
        value: renderAmpOperatorQueueCsv(pack),
      },
      {
        name: CHANNEL_DRAFTS_CSV_NAME,
        value: renderAmpChannelDraftsCsv(pack),
      },
    ],
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
  const pack = buildAmpWorkflowHardeningPack(report);
  const written = writeAmpWorkflowHardeningPack(pack, options);

  if (written.docsPath) {
    process.stdout.write(`${written.docsPath}\n`);
  } else {
    process.stdout.write(written.markdown);
  }
}

if (isCliInvocation()) {
  main();
}

module.exports = {
  AMP_INSTALL_DOC_URL,
  AMP_INVOKABLE_SKILLS_URL,
  AMP_MANUAL_URL,
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GUIDE_URL,
  README_URL,
  buildAmpWorkflowHardeningPack,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildExternalEvidence,
  buildFollowOnOffers,
  buildListingCopy,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedAmpLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderAmpChannelDraftsCsv,
  renderAmpOperatorQueueCsv,
  renderAmpWorkflowHardeningPackMarkdown,
  writeAmpWorkflowHardeningPack,
};
