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
const OPENCODE_SOURCE = 'opencode';
const GUIDE_MEDIUM = 'seo_guide';
const OUTREACH_MEDIUM = 'operator_outreach';
const GITHUB_MEDIUM = 'github_comment';
const LINKEDIN_MEDIUM = 'linkedin_post';
const REDDIT_MEDIUM = 'reddit_dm';
const OPENCODE_SURFACE = 'opencode';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const OPENCODE_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/opencode-guardrails';
const OPENCODE_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/opencode-guardrails.html';
const OPENCODE_INTEGRATION_DOC_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md';
const OPENCODE_INSTALL_DOC_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn OpenCode install intent into proof-backed local workflow control.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives OpenCode buyers a repo-local and portable guardrail path so repeated agent mistakes become worktree-safe Pre-Action Checks before the next risky command runs.';
const TRACKING_DEFAULTS = {
  utmSource: OPENCODE_SOURCE,
  utmMedium: GUIDE_MEDIUM,
  utmCampaign: 'opencode_demand_pack',
  utmContent: 'guide',
  surface: OPENCODE_SURFACE,
};
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
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

function hasEvidence(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function targetMentionsOpenCode(target = {}) {
  const haystacks = [
    target.repoName,
    target.description,
    target.message,
    target.firstTouchDraft,
  ].map((value) => normalizeText(value).toLowerCase());

  return haystacks.some((value) => value.includes('opencode'));
}

function countTargets(report = {}, matcher) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const guideSurface = {
    key: 'opencode_guardrails_guide',
    name: 'OpenCode guardrails guide',
    url: buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
      utmCampaign: 'opencode_guardrails_guide',
      utmContent: 'seo_page',
      campaignVariant: 'guardrails_guide',
      offerCode: 'OPENCODE-GUIDE',
      ctaId: 'opencode_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: OPENCODE_GUIDE_SOURCE_URL,
    evidenceSource: 'public/guides/opencode-guardrails.html',
    operatorUse: 'Primary acquisition page for buyers who search for OpenCode guardrails, local workflow safety, or repeated mistake prevention.',
    buyerSignal: 'OpenCode users who already want local-first autonomy and now need enforcement before the next risky repo action.',
  };
  const integrationSurface = {
    key: 'repo_local_integration',
    name: 'Repo-local OpenCode integration',
    url: OPENCODE_INTEGRATION_DOC_URL,
    supportUrl: OPENCODE_INTEGRATION_DOC_URL,
    evidenceSource: 'docs/guides/opencode-integration.md',
    operatorUse: 'Use when a buyer asks whether ThumbGate already has a real OpenCode workflow surface instead of generic compatibility copy.',
    buyerSignal: 'Technical evaluators who want proof that worktree-safe permissions, review lanes, and runtime boundaries are already shipped.',
  };
  const portableSurface = {
    key: 'portable_profile_install',
    name: 'Portable OpenCode profile install',
    url: OPENCODE_INSTALL_DOC_URL,
    supportUrl: OPENCODE_INSTALL_DOC_URL,
    evidenceSource: 'plugins/opencode-profile/INSTALL.md',
    operatorUse: 'Use after install intent is explicit and the buyer wants the portable profile path outside this repo.',
    buyerSignal: 'Self-serve buyers who already want the MCP config and do not need the general pitch repeated.',
  };
  const setupSurface = {
    key: 'proof_backed_setup_guide',
    name: 'Proof-backed setup guide',
    url: buildTrackedOpenCodeLink(GUIDE_URL, {
      utmCampaign: 'opencode_setup_guide',
      utmContent: 'setup',
      campaignVariant: 'proof_backed_setup',
      offerCode: 'OPENCODE-SETUP_GUIDE',
      ctaId: 'opencode_setup_guide',
      ctaPlacement: 'guide_surface',
    }),
    supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
    evidenceSource: 'public/guide.html',
    operatorUse: 'Bridge from OpenCode-specific install intent into the shared setup guide, Pro, or workflow-hardening motion.',
    buyerSignal: 'Operators who now want one install route plus honest proof and pricing guardrails before deciding between self-serve and service-led help.',
  };

  return [guideSurface, integrationSurface, portableSurface, setupSurface].map((surface) => ({
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
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo OpenCode operators who want the self-serve dashboard and proof-ready exports after one blocked repeat is real.',
      cta: buildTrackedOpenCodeLink(links.proCheckoutLink, {
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
      buyer: 'Teams that already named one repeated OpenCode-adjacent workflow failure and need rollout proof before they scale usage.',
      cta: buildTrackedOpenCodeLink(links.sprintLink, {
        utmCampaign: 'opencode_sprint_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'sprint_follow_on',
        offerCode: 'OPENCODE-SPRINT_FOLLOW_ON',
        ctaId: 'opencode_sprint_follow_on',
        ctaPlacement: 'post_install',
        surface: 'opencode_post_install',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const workflowControlCount = countTargets(report, (target) => hasEvidence(target, 'workflow control surface'));
  const selfServeCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));
  const opencodeAdjacentCount = countTargets(report, (target) => targetMentionsOpenCode(target));

  return [
    {
      key: 'opencode_self_serve_builder',
      audience: 'OpenCode builder who wants the tool path first',
      evidence: `ThumbGate already ships a public OpenCode guardrails page, repo-local integration doc, and portable profile install path. Current OpenCode-adjacent targets in the GTM report: ${opencodeAdjacentCount}.`,
      proofTrigger: 'They can name one repeated local workflow failure or ask for the exact OpenCode install path.',
      proofAsset: OPENCODE_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
        utmCampaign: 'opencode_queue_guide',
        utmContent: 'seo_page',
        campaignVariant: 'self_serve_builder',
        offerCode: 'OPENCODE-QUEUE_GUIDE',
        ctaId: 'opencode_queue_guide',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Guide -> setup guide -> Pro only after one blocked repeat is concrete.',
    },
    {
      key: 'workflow_control_owner',
      audience: 'Workflow-control owner evaluating OpenCode in a production-sensitive workflow',
      evidence: `Current GTM report shows ${workflowControlCount} workflow-control targets where repeated failures, approvals, or rollout boundaries are visible and expensive.`,
      proofTrigger: 'They already described one repeated failure, review boundary, or rollback concern that should turn into a hard gate.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      nextAsk: buildTrackedOpenCodeLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'opencode_queue_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'workflow_control_owner',
        offerCode: 'OPENCODE-QUEUE_SPRINT',
        ctaId: 'opencode_queue_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'opencode_workflow_queue',
      }),
      recommendedMotion: 'Qualify one repeated workflow failure for the Workflow Hardening Sprint.',
    },
    {
      key: 'local_first_evaluator',
      audience: 'Local-first evaluator comparing plugin, hook, and repo-backed agent surfaces',
      evidence: `Current GTM report includes ${selfServeCount} self-serve tooling targets where the guide-to-Pro lane is more credible than a services-first pitch.`,
      proofTrigger: 'They care about portable local config, worktree-safe permissions, or keeping the workflow inside their own repo.',
      proofAsset: OPENCODE_INSTALL_DOC_URL,
      nextAsk: buildTrackedOpenCodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_queue_setup',
        utmContent: 'setup',
        campaignVariant: 'local_first_evaluator',
        offerCode: 'OPENCODE-QUEUE_SETUP',
        ctaId: 'opencode_queue_setup',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Portable install proof -> setup guide -> Pro after explicit self-serve intent.',
    },
  ];
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const guideLink = buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_guide',
    utmContent: 'guide',
    campaignVariant: 'guardrails_follow_up',
    offerCode: 'OPENCODE-OUTREACH_GUIDE',
    ctaId: 'opencode_outreach_guide',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const proLink = buildTrackedOpenCodeLink(links.proCheckoutLink, {
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
  const sprintLink = buildTrackedOpenCodeLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'workflow_control',
    offerCode: 'OPENCODE-OUTREACH_SPRINT',
    ctaId: 'opencode_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });

  return [
    {
      key: 'self_serve_first_touch',
      channel: 'GitHub note or DM',
      audience: 'OpenCode builder',
      draft: `If you want the clean OpenCode path first, start here: ${guideLink} . It keeps the local-first install story, repo-safe boundaries, and setup path in one place without forcing a team-motion pitch too early.`,
    },
    {
      key: 'proof_after_pain',
      channel: 'Pain-confirmed follow-up',
      audience: 'OpenCode operator who already named one repeated failure',
      draft: `Now that the failure mode is concrete, use proof before the upsell. Share Verification Evidence first, then the self-serve Pro lane only if they want the personal dashboard and exports: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'workflow_hardening_pitch',
      channel: 'Founder note',
      audience: 'Workflow owner with review or rollout risk',
      draft: `If OpenCode is already touching a workflow where a repeated mistake means review churn, rollback pain, or a bad release, the next step is not another generic setup doc. It is one workflow hardening sprint with proof attached: ${sprintLink} .`,
    },
  ];
}

function buildChannelDrafts(links = buildRevenueLinks(), report = {}) {
  const opencodeAdjacentCount = countTargets(report, (target) => targetMentionsOpenCode(target));
  const workflowControlCount = countTargets(report, (target) => hasEvidence(target, 'workflow control surface'));
  const selfServeCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));

  const githubCta = buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
    utmMedium: GITHUB_MEDIUM,
    utmCampaign: 'opencode_channel_github',
    utmContent: 'guide',
    campaignVariant: 'self_serve',
    offerCode: 'OPENCODE-CHANNEL-GITHUB',
    ctaId: 'opencode_channel_github',
    ctaPlacement: 'channel_draft',
    surface: 'opencode_github',
  });
  const linkedinCta = buildTrackedOpenCodeLink(GUIDE_URL, {
    utmMedium: LINKEDIN_MEDIUM,
    utmCampaign: 'opencode_channel_linkedin',
    utmContent: 'workflow_sprint',
    campaignVariant: 'workflow_control',
    offerCode: 'OPENCODE-CHANNEL-LINKEDIN',
    ctaId: 'opencode_channel_linkedin',
    ctaPlacement: 'channel_draft',
    surface: 'opencode_linkedin',
  });
  const redditCta = buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
    utmMedium: REDDIT_MEDIUM,
    utmCampaign: 'opencode_channel_reddit',
    utmContent: 'guide',
    campaignVariant: 'local_first',
    offerCode: 'OPENCODE-CHANNEL-REDDIT',
    ctaId: 'opencode_channel_reddit',
    ctaPlacement: 'channel_draft',
    surface: 'opencode_reddit',
  });

  return [
    {
      key: 'github_self_serve',
      channel: 'GitHub',
      format: 'Comment or outreach note',
      audience: 'OpenCode-adjacent repo maintainer',
      evidenceSummary: `${opencodeAdjacentCount} current GTM targets already mention OpenCode or OpenCode-adjacent tooling.`,
      cta: githubCta,
      proofTiming: 'Do not lead with proof links. Use the guide first, proof only after pain is confirmed.',
      draft: `OpenCode already gives builders a local-first surface. The missing piece is a hard stop for the same risky command or workflow mistake showing up again. ThumbGate’s OpenCode guardrails page keeps the install and control story in one place: ${githubCta}`,
    },
    {
      key: 'linkedin_workflow_control',
      channel: 'LinkedIn',
      format: 'Founder post',
      audience: 'Workflow-control and platform operators',
      evidenceSummary: `${workflowControlCount} current GTM targets expose workflow-control surfaces where repeated agent failures are expensive.`,
      cta: linkedinCta,
      proofTiming: 'Lead with the workflow problem, not proof links.',
      draft: `OpenCode does not reduce the need for workflow control. It raises the stakes because the agent is closer to the repo. The right motion is to harden one repeated failure, prove the guardrail, then scale usage. ThumbGate’s setup path: ${linkedinCta}`,
    },
    {
      key: 'reddit_local_first',
      channel: 'Reddit',
      format: 'Reply or DM',
      audience: 'Local-first evaluator',
      evidenceSummary: `${selfServeCount} current GTM targets look like plugin, hook, or config buyers who should see the tool path before any services pitch.`,
      cta: redditCta,
      proofTiming: 'Keep first touch tool-first and local-first. Save proof links for follow-up.',
      draft: `If you already like OpenCode because it stays local, the useful next question is how you stop the same bad move from recurring in that local workflow. ThumbGate’s OpenCode guide is the shortest proof-backed answer: ${redditCta}`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'opencode_guide_to_paid_intent',
    policy: 'Treat OpenCode guide visits as acquisition evidence only after a tracked setup-guide click, Pro checkout start, or qualified workflow-hardening conversation exists.',
    minimumUsefulSignal: 'One tracked Pro checkout start or one qualified workflow-hardening conversation sourced from an OpenCode-tagged surface.',
    strongSignal: 'Three tracked paid-intent events across setup-guide clicks, Pro checkout starts, or workflow sprint conversations.',
    metrics: [
      'opencode_guide_views',
      'portable_profile_clicks',
      'setup_guide_clicks',
      'pro_checkout_starts',
      'workflow_sprint_intake_submissions',
      'qualified_team_conversations',
      'paid_conversions',
    ],
    guardrails: [
      'Do not claim installs, revenue, marketplace approval, or rankings without direct command evidence.',
      'Do not lead first-touch OpenCode outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Publish the OpenCode guide, portable-profile proof, and tracked setup-guide bridge as one coherent self-serve lane.',
        decisionRule: 'Do not rewrite the OpenCode value proposition unless guide clicks fail to turn into paid-intent events.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever follow-on converts better from OpenCode traffic: Pro or Workflow Hardening Sprint.',
        decisionRule: 'If guide traffic grows without paid intent, move proof and follow-on offers higher on the OpenCode guide and outreach follow-ups.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether OpenCode remains a self-serve lane or earns a stronger workflow-hardening motion.',
        decisionRule: 'Only increase direct OpenCode outbound once there is qualified conversation or paid-intent evidence.',
      },
    ],
    doNotCountAsSuccess: [
      'guide views without a tracked follow-on click',
      'proof clicks without paid intent',
      'unverified install or revenue claims',
    ],
  };
}

function buildPackSummary(report = {}) {
  const directiveHeadline = normalizeText(report?.directive?.headline);

  return [
    'OpenCode demand in ThumbGate is local-first: guide and install proof first, then setup clarity, then paid intent.',
    directiveHeadline || 'Use the shipped OpenCode support surface to create proof-backed paid intent instead of inventing traction.',
  ].join(' ');
}

function buildOpencodeDemandPack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn OpenCode guardrails demand into tracked guide visits, setup-guide clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
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
    channelDrafts: buildChannelDrafts(links, report),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderOpencodeOperatorQueueCsv(pack = {}) {
  return renderOperatorQueueCsv(pack.operatorQueue);
}

function renderOpencodeChannelDraftsCsv(pack = {}) {
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

function renderOpencodeDemandPackMarkdown(pack = {}) {
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
    : ['- No active channel drafts available.', ''];
  const listLines = (values = []) => (Array.isArray(values) && values.length ? values.map((entry) => `- ${entry}`) : ['- n/a']);
  const milestoneLines = Array.isArray(pack.measurementPlan?.milestones) && pack.measurementPlan.milestones.length
    ? pack.measurementPlan.milestones.map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
    : ['- No milestones available.'];

  return [
    '# OpenCode Demand Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of rankings, sent outreach, installs, paid revenue, or marketplace approval by itself.',
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

function writeOpencodeDemandPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'opencode-demand-pack.md'),
    markdown: renderOpencodeDemandPackMarkdown(pack),
    jsonName: 'opencode-demand-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'opencode-operator-queue.csv',
        value: renderOpencodeOperatorQueueCsv(pack),
      },
      {
        name: 'opencode-channel-drafts.csv',
        value: renderOpencodeChannelDraftsCsv(pack),
      },
    ],
  });
}

function parseArgs(argv = []) {
  return parseReportArgs(argv);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildOpencodeDemandPack(readRevenueLoopReport());
  const written = writeOpencodeDemandPack(pack, options);

  console.log('OpenCode demand pack ready.');
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

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

if (isCliInvocation(process.argv)) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GUIDE_URL,
  OPENCODE_GUIDE_URL,
  OPENCODE_INSTALL_DOC_URL,
  OPENCODE_INTEGRATION_DOC_URL,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOpencodeDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedOpenCodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpencodeChannelDraftsCsv,
  renderOpencodeDemandPackMarkdown,
  renderOpencodeOperatorQueueCsv,
  writeOpencodeDemandPack,
};
