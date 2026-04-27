'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureDir } = require('./fs-utils');
const { buildUTMLink } = require('./social-analytics/utm');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');

const CODEX_SOURCE = 'codex';
const INSTALL_PAGE_MEDIUM = 'install_page';
const SETUP_GUIDE_MEDIUM = 'setup_guide';
const BUNDLE_MEDIUM = 'bundle';
const CODEX_INSTALL_PAGE_URL = 'https://thumbgate-production.up.railway.app/codex-plugin';
const CODEX_BUNDLE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip';
const CANONICAL_SHORT_DESCRIPTION = 'Auto-updating MCP plugin and hook launcher for Codex with Pre-Action Checks, thumbs-up/down feedback memory, and a local-first Reliability Gateway.';
const CANONICAL_LONG_DESCRIPTION = [
  'ThumbGate gives Codex a proof-backed install path, pre-action gate enforcement, and local-first feedback memory.',
  'Use the install page when the buyer needs screenshots and trust context before download, then route serious install intent through the setup guide before any upgrade ask.',
  'Use the direct bundle only after the buyer already wants the portable asset or repo-local marketplace surface.',
].join(' ');
const CODEX_PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  if (!/[",\n]/.exec(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function readGitHubAbout(repoRoot = path.resolve(__dirname, '..')) {
  const aboutPath = path.join(repoRoot, 'config', 'github-about.json');
  return JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
}

function buildTrackedCodexLink(baseUrl, tracking = {}) {
  const url = new URL(buildUTMLink(baseUrl, {
    source: tracking.utmSource,
    medium: tracking.utmMedium,
    campaign: tracking.utmCampaign,
    content: tracking.utmContent,
  }));
  const extras = {
    campaign_variant: tracking.campaignVariant,
    offer_code: tracking.offerCode,
    cta_id: tracking.ctaId,
    cta_placement: tracking.ctaPlacement,
    plan_id: tracking.planId,
    surface: tracking.surface,
  };

  for (const [key, value] of Object.entries(extras)) {
    if (normalizeText(value)) {
      url.searchParams.set(key, normalizeText(value));
    }
  }

  return url.toString();
}

function buildCodexTrackingMetadata(key, overrides = {}) {
  const normalizedKey = normalizeText(key).toLowerCase();
  const upperKey = normalizedKey.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');

  return {
    utmSource: CODEX_SOURCE,
    utmMedium: overrides.utmMedium || INSTALL_PAGE_MEDIUM,
    utmCampaign: overrides.utmCampaign || `codex_${normalizedKey}`,
    utmContent: overrides.utmContent || 'surface',
    campaignVariant: overrides.campaignVariant || normalizedKey,
    offerCode: overrides.offerCode || `CODEX-${upperKey}`,
    ctaPlacement: overrides.ctaPlacement || 'codex_surface',
    ctaId: overrides.ctaId || `codex_${normalizedKey}`,
    planId: overrides.planId || '',
    surface: overrides.surface || normalizedKey,
  };
}

function hasEvidenceLabel(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function summarizeExamples(targets = [], limit = 3) {
  return targets.slice(0, limit).map((target) => (
    normalizeText(target?.repoName)
      ? `${target.username}/${target.repoName}`
      : `@${target.username}`
  ));
}

function buildSignalSummary(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const warmTargets = targets.filter((target) => normalizeText(target.temperature).toLowerCase() === 'warm');
  const workflowControlTargets = targets.filter((target) => hasEvidenceLabel(target, 'workflow control surface'));
  const productionTargets = targets.filter((target) => hasEvidenceLabel(target, 'production or platform workflow'));

  return [
    {
      key: 'warm_discovery',
      label: 'Warm discovery leads already exist',
      count: warmTargets.length,
      summary: `${warmTargets.length} current targets already named concrete workflow pain before any Codex-specific pitch.`,
      examples: summarizeExamples(warmTargets),
    },
    {
      key: 'workflow_control',
      label: 'Workflow control surfaces remain the strongest buyer signal',
      count: workflowControlTargets.length,
      summary: `${workflowControlTargets.length} current targets expose review, approval, governance, or workflow control surfaces where a Codex install story can convert into a workflow-hardening offer.`,
      examples: summarizeExamples(workflowControlTargets),
    },
    {
      key: 'production_rollout',
      label: 'Production rollout proof matters',
      count: productionTargets.length,
      summary: `${productionTargets.length} targets touch production-sensitive workflows where proof and rollback safety should appear before the buyer expands usage.`,
      examples: summarizeExamples(productionTargets),
    },
  ].filter((entry) => entry.count > 0);
}

function buildPackTargets(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.slice(0, 6).map((target) => ({
    account: normalizeText(target.repoName)
      ? `${target.username}/${target.repoName}`
      : `@${target.username}`,
    temperature: normalizeText(target.temperature) || 'cold',
    why: normalizeText(target.motionReason) || normalizeText(target.outreachAngle),
    motion: normalizeText(target.motionLabel),
  }));
}

function buildCodexSurface(config, links, about) {
  const tracking = buildCodexTrackingMetadata(config.trackingKey, config.tracking);
  let baseUrl = CODEX_INSTALL_PAGE_URL;
  if (config.baseUrl === 'guide') {
    baseUrl = links.guideLink;
  } else if (config.baseUrl === 'bundle') {
    baseUrl = CODEX_BUNDLE_URL;
  }
  const tags = typeof config.tags === 'function' ? config.tags(about) : config.tags;

  return {
    key: config.key,
    name: config.name,
    role: config.role,
    operatorStatus: config.operatorStatus,
    buyer: config.buyer,
    conversionGoal: config.conversionGoal,
    submissionUrl: config.submissionUrl,
    shortDescription: config.shortDescription,
    longDescription: Array.isArray(config.longDescription)
      ? config.longDescription.join(' ')
      : config.longDescription,
    repositoryUrl: about.repositoryUrl,
    homepageUrl: buildTrackedCodexLink(baseUrl, tracking),
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    supportUrl: `${about.repositoryUrl}/blob/main/${config.supportPath}`,
    tags,
    proofLinks: [...CODEX_PROOF_LINKS],
  };
}

function buildCodexPluginSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const surfaceConfigs = [
    {
      key: 'install_page',
      name: 'Codex plugin install page',
      role: 'Human install and trust-building surface',
      operatorStatus: 'Refresh when CTA order, screenshots, proof links, or pricing guardrails change.',
      buyer: 'Codex users who want a documented install path before trusting a bundle or CLI setup.',
      conversionGoal: 'install_page_to_setup_guide',
      submissionUrl: CODEX_INSTALL_PAGE_URL,
      shortDescription: CANONICAL_SHORT_DESCRIPTION,
      longDescription: CANONICAL_LONG_DESCRIPTION,
      supportPath: 'docs/CODEX_PLUGIN_OPERATIONS.md',
      trackingKey: 'install_page',
      tracking: {
        utmMedium: INSTALL_PAGE_MEDIUM,
        utmCampaign: 'codex_plugin_install_page',
        utmContent: 'page',
        surface: 'codex_install_page',
      },
      tags: ({ topics }) => topics.filter((topic) => [
        'thumbgate',
        'codex',
        'pre-action-checks',
        'agent-reliability',
        'guardrails',
        'developer-tools',
      ].includes(topic)),
    },
    {
      key: 'setup_guide',
      name: 'Proof-backed setup guide',
      role: 'Self-serve activation surface after install intent',
      operatorStatus: 'Use when the buyer wants steps, proof, and Commercial Truth before checkout.',
      buyer: 'Codex users who need setup clarity and proof before they decide between free install, Pro, or workflow hardening.',
      conversionGoal: 'setup_guide_to_paid_intent',
      submissionUrl: links.guideLink,
      shortDescription: 'Proof-backed setup path for Codex buyers who want the install flow, Commercial Truth, and verification evidence in one place.',
      longDescription: [
        'Send the setup guide after the buyer already wants the tool path.',
        'Keep the guide as the self-serve bridge between Codex install intent and either Pro checkout or the Workflow Hardening Sprint.',
      ],
      supportPath: 'docs/CODEX_PLUGIN_OPERATIONS.md',
      baseUrl: 'guide',
      trackingKey: 'setup_guide',
      tracking: {
        utmMedium: SETUP_GUIDE_MEDIUM,
        utmCampaign: 'codex_setup_guide',
        utmContent: 'guide',
        surface: 'codex_setup_guide',
      },
      tags: ['codex', 'setup-guide', 'proof', 'workflow-hardening'],
    },
    {
      key: 'release_bundle',
      name: 'GitHub release bundle',
      role: 'Portable plugin distribution surface',
      operatorStatus: 'Use only after the buyer asked for the direct asset or bundle path.',
      buyer: 'Codex users who want the standalone zip with manifest, MCP config, marketplace entry, and install docs.',
      conversionGoal: 'bundle_download_to_follow_on',
      submissionUrl: CODEX_BUNDLE_URL,
      shortDescription: 'Portable Codex plugin bundle with the manifest, MCP config, marketplace entry, and install docs in one asset.',
      longDescription: [
        'Do not lead with the raw zip.',
        'Use the bundle after the buyer already wants the portable asset, then route serious usage to the guide, proof links, and paid-intent follow-on offers.',
      ],
      supportPath: 'plugins/codex-profile/INSTALL.md',
      baseUrl: 'bundle',
      trackingKey: 'release_bundle',
      tracking: {
        utmMedium: BUNDLE_MEDIUM,
        utmCampaign: 'codex_release_bundle',
        utmContent: 'download',
        surface: 'codex_release_bundle',
      },
      tags: ['codex', 'bundle', 'mcp', 'pre-action-checks'],
    },
  ];

  return surfaceConfigs.map((config) => buildCodexSurface(config, links, about));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  const proTracking = buildCodexTrackingMetadata('pro_follow_on', {
    utmMedium: SETUP_GUIDE_MEDIUM,
    utmCampaign: 'codex_pro_follow_on',
    utmContent: 'pro',
    ctaPlacement: 'codex_follow_on',
    ctaId: 'codex_pro_follow_on',
    planId: 'pro',
    surface: 'codex_follow_on',
  });
  const sprintTracking = buildCodexTrackingMetadata('sprint_follow_on', {
    utmMedium: SETUP_GUIDE_MEDIUM,
    utmCampaign: 'codex_sprint_follow_on',
    utmContent: 'workflow_sprint',
    ctaPlacement: 'codex_follow_on',
    ctaId: 'codex_sprint_follow_on',
    surface: 'codex_follow_on',
  });

  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricingModel: links.proPriceLabel,
      buyer: 'Solo Codex operators who want the self-serve dashboard and proof-ready exports after install.',
      cta: buildTrackedCodexLink(links.proCheckoutLink, proTracking),
    },
    {
      key: 'teams',
      label: 'Workflow Hardening Sprint',
      pricingModel: 'Workflow Hardening Sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams who already named one repeated Codex-adjacent workflow failure and need rollout proof.',
      cta: buildTrackedCodexLink(links.sprintLink, sprintTracking),
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'codex_install_intent_to_paid_intent',
    policy: 'Treat Codex page views, guide opens, and bundle downloads as acquisition evidence only after a tracked checkout start or qualified workflow-hardening conversation exists.',
    metrics: [
      'codex_install_page_views',
      'setup_guide_clicks',
      'bundle_download_clicks',
      'pro_checkout_starts',
      'qualified_team_conversations',
      'paid_conversions',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Keep the Codex install page, setup guide, and release bundle aligned with proof links and tracked follow-on offers.',
        decision: 'Do not rewrite the Codex value prop until guide clicks or checkout starts show a mismatch.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever paid motion converts better after Codex install intent: Pro or Workflow Hardening Sprint.',
        decision: 'If setup-guide traffic rises without paid intent, move the proof-backed offer stack higher on the Codex page and guide.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether Codex remains a self-serve lane or becomes a workflow-hardening entry point for teams.',
        decision: 'Only prioritize team rollout motion when qualified conversations exist.',
      },
    ],
    successThresholds: {
      minimumUsefulSignal: 'one tracked Pro checkout start or one qualified workflow-hardening conversation',
      strongSignal: 'three tracked paid-intent events across Pro or Workflow Hardening Sprint motion',
      doNotCountAsSuccess: [
        'page views without guide clicks',
        'bundle downloads without a tracked follow-on event',
        'unverified revenue, install, or marketplace approval claims',
      ],
    },
  };
}

function buildOperatorSequences(links = buildRevenueLinks()) {
  const installPageCta = buildTrackedCodexLink(CODEX_INSTALL_PAGE_URL, buildCodexTrackingMetadata('install_page', {
    utmMedium: INSTALL_PAGE_MEDIUM,
    utmCampaign: 'codex_plugin_install_page',
    utmContent: 'page',
    surface: 'codex_install_page',
  }));
  const guideCta = buildTrackedCodexLink(links.guideLink, buildCodexTrackingMetadata('setup_guide', {
    utmMedium: SETUP_GUIDE_MEDIUM,
    utmCampaign: 'codex_setup_guide',
    utmContent: 'guide',
    surface: 'codex_setup_guide',
  }));
  const [proOffer, sprintOffer] = buildFollowOnOffers(links);

  return [
    {
      key: 'install_trust_surface',
      trigger: 'Buyer wants a documented Codex path before trusting a zip or CLI setup.',
      evidence: 'The install page is the primary human trust surface and keeps proof plus support links close to the download path.',
      goal: 'Move cold install curiosity into a tracked guide or setup click.',
      cta: installPageCta,
      draft: `If you want to see the Codex install path before downloading anything, start with the install page: ${installPageCta} . It shows the bundle path, install docs, and proof links in one place so you can decide whether the free setup is enough first.`,
    },
    {
      key: 'setup_guide_follow_up',
      trigger: 'Buyer already wants the tool path and asks for steps, proof, or setup clarity.',
      evidence: 'The setup guide is the designated self-serve bridge between Codex install intent and paid intent.',
      goal: 'Move install intent into either a qualified sprint conversation or a tracked Pro checkout start.',
      cta: guideCta,
      draft: `Here is the proof-backed Codex setup guide: ${guideCta} . Use it when the buyer wants the exact install flow plus Commercial Truth and verification evidence before choosing between free install, Pro, or a workflow-hardening conversation.`,
    },
    {
      key: 'post_proof_pro_upgrade',
      trigger: 'Solo operator already proved one blocked repeat and wants the self-serve lane.',
      evidence: 'The pack keeps Pro as the post-proof follow-on after one blocked repeat is real.',
      goal: 'Move proven solo usage into tracked Pro checkout intent.',
      cta: proOffer.cta,
      draft: `If you already proved one blocked repeat in Codex and just want the self-serve lane, Pro is the clean next step: ${proOffer.cta} . That keeps the dashboard and proof-ready exports attached without forcing a services motion.`,
    },
    {
      key: 'workflow_hardening_escalation',
      trigger: 'Team already named one repeated approval-boundary, handoff, or rollout failure.',
      evidence: 'The Workflow Hardening Sprint remains the primary paid motion when one owner and one repeated failure are explicit.',
      goal: 'Move team pain into a qualified workflow-hardening conversation.',
      cta: sprintOffer.cta,
      draft: `If one approval, handoff, or rollout failure keeps repeating around Codex or a neighboring review lane, route it to the Workflow Hardening Sprint instead of a generic plugin pitch: ${sprintOffer.cta} . That keeps the conversation anchored on one workflow, one owner, and one proof review.`,
    },
  ];
}

function buildCodexPluginRevenuePack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    channel: 'Codex',
    objective: 'Turn Codex plugin discovery into tracked guide opens, bundle downloads, Pro checkout starts, and qualified workflow-hardening conversations.',
    canonicalIdentity: {
      displayName: 'ThumbGate',
      slug: 'thumbgate',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      githubDescription: about.githubDescription,
      shortDescription: CANONICAL_SHORT_DESCRIPTION,
      longDescription: CANONICAL_LONG_DESCRIPTION,
    },
    signals: buildSignalSummary(report),
    surfaces: buildCodexPluginSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorSequences: buildOperatorSequences(links),
    sampleTargets: buildPackTargets(report),
    measurementPlan: buildMeasurementPlan(),
  };
}

function renderCodexPluginRevenuePackMarkdown(pack) {
  const signalLines = Array.isArray(pack.signals) && pack.signals.length
    ? pack.signals.flatMap((signal) => ([
      `### ${signal.label}`,
      `- Count: ${signal.count}`,
      `- Summary: ${signal.summary}`,
      `- Examples: ${signal.examples.length ? signal.examples.join(', ') : 'n/a'}`,
      '',
    ]))
    : ['- No evidence-backed buyer signals were available in this run.', ''];
  const surfaceLines = pack.surfaces.flatMap((surface) => ([
    `### ${surface.name}`,
    `- Role: ${surface.role}`,
    `- Operator status: ${surface.operatorStatus}`,
    `- Conversion goal: ${surface.conversionGoal}`,
    `- Buyer: ${surface.buyer}`,
    `- Submission path: ${surface.submissionUrl}`,
    `- Repository: ${surface.repositoryUrl}`,
    `- Homepage: ${surface.homepageUrl}`,
    `- Proof: ${surface.proofUrl}`,
    `- Support: ${surface.supportUrl}`,
    `- Tags: ${surface.tags.join(', ')}`,
    '',
    `Short description: ${surface.shortDescription}`,
    '',
    surface.longDescription,
    '',
    `Proof links: ${surface.proofLinks.join(' | ')}`,
    '',
  ]));
  const offerLines = pack.followOnOffers.flatMap((offer) => ([
    `- ${offer.label}: ${offer.pricingModel}`,
    `  Buyer: ${offer.buyer}`,
    `  CTA: ${offer.cta}`,
  ]));
  const operatorSequenceLines = Array.isArray(pack.operatorSequences) && pack.operatorSequences.length
    ? pack.operatorSequences.flatMap((sequence) => ([
      `### ${sequence.trigger}`,
      `- Goal: ${sequence.goal}`,
      `- Evidence: ${sequence.evidence}`,
      `- CTA: ${sequence.cta}`,
      '',
      'Draft:',
      `> ${sequence.draft}`,
      '',
    ]))
    : ['- No Codex operator sequences were generated in this run.', ''];
  const sampleTargetLines = Array.isArray(pack.sampleTargets) && pack.sampleTargets.length
    ? pack.sampleTargets.map((target) => `- ${target.account} (${target.temperature}): ${target.why}`)
    : ['- No sample targets available in this run.'];

  return [
    '# Codex Plugin Revenue Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of bundle downloads, installs, paid revenue, or marketplace publication by itself.',
    '',
    '## Objective',
    pack.objective,
    '',
    '## Canonical Identity',
    `- Display name: ${pack.canonicalIdentity.displayName}`,
    `- Slug: ${pack.canonicalIdentity.slug}`,
    `- Repository: ${pack.canonicalIdentity.repositoryUrl}`,
    `- Homepage: ${pack.canonicalIdentity.homepageUrl}`,
    `- GitHub description: ${pack.canonicalIdentity.githubDescription}`,
    `- Short description: ${pack.canonicalIdentity.shortDescription}`,
    '',
    pack.canonicalIdentity.longDescription,
    '',
    '## Evidence-Backed Buyer Signals',
    ...signalLines,
    '## Submission Surfaces',
    ...surfaceLines,
    '## Follow-On Offers',
    ...offerLines,
    '',
    '## Operator Follow-Up Sequences',
    ...operatorSequenceLines,
    'Use Commercial Truth and Verification Evidence only after the buyer confirms the workflow pain or asks for proof.',
    '',
    '## Sample Targets Behind This Pack',
    ...sampleTargetLines,
    '',
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan.northStar}`,
    `- Policy: ${pack.measurementPlan.policy}`,
    `- Minimum useful signal: ${pack.measurementPlan.successThresholds.minimumUsefulSignal}`,
    `- Strong signal: ${pack.measurementPlan.successThresholds.strongSignal}`,
    '',
    'Tracked metrics:',
    ...pack.measurementPlan.metrics.map((metric) => `- ${metric}`),
    '',
    'Milestones:',
    ...pack.measurementPlan.milestones.map((entry) => `- ${entry.window}: ${entry.goal} Decision rule: ${entry.decision}`),
    '',
    'Do not count as success:',
    ...pack.measurementPlan.successThresholds.doNotCountAsSuccess.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function renderCodexPluginRevenuePackCsv(pack) {
  const rows = [
    [
      'key',
      'name',
      'role',
      'operatorStatus',
      'conversionGoal',
      'buyer',
      'submissionUrl',
      'homepageUrl',
      'proofUrl',
      'supportUrl',
      'shortDescription',
      'tags',
    ],
    ...pack.surfaces.map((surface) => ([
      surface.key,
      surface.name,
      surface.role,
      surface.operatorStatus,
      surface.conversionGoal,
      surface.buyer,
      surface.submissionUrl,
      surface.homepageUrl,
      surface.proofUrl,
      surface.supportUrl,
      surface.shortDescription,
      surface.tags.join('; '),
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function parseArgs(argv = []) {
  const options = {
    reportDir: '',
    writeDocs: false,
  };

  for (const [index, arg] of argv.entries()) {
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(argv[index + 1]);
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      const [, value = ''] = arg.split(/=(.*)/s);
      options.reportDir = normalizeText(value);
    }
  }

  return options;
}

function writeCodexPluginRevenuePack(pack, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderCodexPluginRevenuePackMarkdown(pack);
  const csv = renderCodexPluginRevenuePackCsv(pack);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'codex-plugin-revenue-pack.md');

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'codex-plugin-revenue-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'codex-plugin-revenue-pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'codex-plugin-surfaces.csv'), csv, 'utf8');
  }

  if (options.writeDocs) {
    fs.writeFileSync(docsPath, markdown, 'utf8');
  }

  return {
    markdown,
    docsPath: options.writeDocs ? docsPath : null,
    reportDir: reportDir || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildCodexPluginRevenuePack();
  const written = writeCodexPluginRevenuePack(pack, options);

  console.log('Codex plugin revenue pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: pack.surfaces.length,
    followOnOffers: pack.followOnOffers.length,
    northStar: pack.measurementPlan.northStar,
  }, null, 2));
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  BUNDLE_MEDIUM,
  CANONICAL_SHORT_DESCRIPTION,
  CODEX_BUNDLE_URL,
  CODEX_INSTALL_PAGE_URL,
  CODEX_SOURCE,
  INSTALL_PAGE_MEDIUM,
  SETUP_GUIDE_MEDIUM,
  buildCodexPluginRevenuePack,
  buildCodexPluginSurfaces,
  buildCodexTrackingMetadata,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorSequences,
  buildTrackedCodexLink,
  isCliInvocation,
  parseArgs,
  renderCodexPluginRevenuePackCsv,
  renderCodexPluginRevenuePackMarkdown,
  writeCodexPluginRevenuePack,
};
