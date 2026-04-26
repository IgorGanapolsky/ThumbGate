#!/usr/bin/env node
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

const CURSOR_SOURCE = 'cursor';
const MARKETPLACE_MEDIUM = 'marketplace';
const DIRECTORY_MEDIUM = 'directory';
const TEAM_MARKETPLACE_MEDIUM = 'team_marketplace';
const CURSOR_PUBLISH_URL = 'https://cursor.com/marketplace/publish';
const CURSOR_DIRECTORY_URL = 'https://cursor.directory/plugins/thumbgate';
const CANONICAL_SHORT_DESCRIPTION = '👍👎 Thumbs down a mistake — your AI agent won\'t repeat it. Thumbs up good work — it remembers the pattern.';
const CANONICAL_LONG_DESCRIPTION = [
  CANONICAL_SHORT_DESCRIPTION,
  'ThumbGate adds pre-action checks, prevention rules, history-aware lesson distillation, and proof-ready workflow evidence for Cursor agents.',
  'When the feedback starts as a vague thumbs-down, ThumbGate can ground it in up to 8 prior recorded entries plus the failed tool call, then keep a linked 60-second follow-up open so the lesson becomes reusable instead of getting lost in chat history.',
].join(' ');
const CURSOR_PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readGitHubAbout(repoRoot = path.resolve(__dirname, '..')) {
  const aboutPath = path.join(repoRoot, 'config', 'github-about.json');
  return JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
}

function buildTrackedCursorLink(baseUrl, tracking = {}) {
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

function buildCursorTrackingMetadata(key, overrides = {}) {
  const normalizedKey = normalizeText(key).toLowerCase();
  const upperKey = normalizedKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

  return {
    utmSource: CURSOR_SOURCE,
    utmMedium: overrides.utmMedium || MARKETPLACE_MEDIUM,
    utmCampaign: overrides.utmCampaign || `cursor_${normalizedKey}`,
    utmContent: overrides.utmContent || 'listing',
    campaignVariant: overrides.campaignVariant || normalizedKey,
    offerCode: overrides.offerCode || `CURSOR-${upperKey}`,
    ctaPlacement: overrides.ctaPlacement || 'cursor_listing',
    ctaId: overrides.ctaId || `cursor_${normalizedKey}`,
    planId: overrides.planId || '',
    surface: overrides.surface || normalizedKey,
  };
}

function buildScreenshotManifest() {
  return [
    {
      file: 'docs/marketing/gallery/05-hero.png',
      role: 'hero',
      reason: 'Lead screenshot for the install surface.',
    },
    {
      file: 'docs/marketing/gallery/03-terminal-demo.png',
      role: 'terminal_demo',
      reason: 'Shows the CLI and pre-action workflow in use.',
    },
    {
      file: 'docs/marketing/gallery/02-how-it-works.png',
      role: 'how_it_works',
      reason: 'Explains the feedback-to-enforcement loop for new buyers.',
    },
    {
      file: 'docs/marketing/gallery/01-dashboard.png',
      role: 'proof_surface',
      reason: 'Shows the proof and dashboard layer behind the paid path.',
    },
    {
      file: 'docs/marketing/gallery/04-comparison.png',
      role: 'comparison',
      reason: 'Helps directory readers understand the differentiation quickly.',
    },
  ];
}

function buildCursorSurface(config, links, about) {
  const tracking = buildCursorTrackingMetadata(config.trackingKey, config.tracking);
  const homepageBaseUrl = config.homepageBase === 'sprint' ? links.sprintLink : links.appOrigin;
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
    homepageUrl: buildTrackedCursorLink(homepageBaseUrl, tracking),
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    supportUrl: `${about.repositoryUrl}/blob/main/${config.supportPath}`,
    tags,
    proofLinks: [...CURSOR_PROOF_LINKS],
  };
}

function buildCursorMarketplaceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  const surfaceConfigs = [
    {
      key: 'marketplace',
      name: 'Cursor Marketplace',
      role: 'Install and metadata distribution surface',
      operatorStatus: 'Refresh after copy, README, screenshots, or proof positioning changes.',
      buyer: 'Cursor users who want the fastest install path for repeated-mistake prevention.',
      conversionGoal: 'plugin_install_to_follow_on',
      submissionUrl: CURSOR_PUBLISH_URL,
      shortDescription: CANONICAL_SHORT_DESCRIPTION,
      longDescription: CANONICAL_LONG_DESCRIPTION,
      supportPath: 'plugins/cursor-marketplace/README.md',
      trackingKey: 'plugin_homepage',
      tracking: {
        utmMedium: MARKETPLACE_MEDIUM,
        utmCampaign: 'cursor_plugin_listing',
        utmContent: 'homepage',
        surface: 'cursor_marketplace',
      },
      tags: ({ topics }) => topics.filter((topic) => [
        'thumbgate',
        'pre-action-checks',
        'cursor',
        'agent-reliability',
        'guardrails',
        'developer-tools',
      ].includes(topic)),
    },
    {
      key: 'directory',
      name: 'Cursor Directory',
      role: 'Discoverability surface only',
      operatorStatus: 'Refresh independently from npm publishes when positioning changes.',
      buyer: 'Researchers and buyers comparing Cursor plugins before install.',
      conversionGoal: 'directory_view_to_marketplace_visit',
      submissionUrl: CURSOR_DIRECTORY_URL,
      shortDescription: 'Pre-action checks that block AI agents from repeating known mistakes. Captures feedback, auto-generates prevention rules, and enforces them via PreToolUse hooks.',
      longDescription: [
        'Use the directory profile to explain the repeated-mistake problem, then route serious readers to the Marketplace or homepage with tracked links.',
        'Lead with the outcome before architecture: stop costly AI agent mistakes, then mention pre-action checks, prevention rules, and proof.',
      ],
      supportPath: 'docs/CURSOR_PLUGIN_OPERATIONS.md',
      trackingKey: 'directory_homepage',
      tracking: {
        utmMedium: DIRECTORY_MEDIUM,
        utmCampaign: 'cursor_directory_profile',
        utmContent: 'homepage',
        surface: 'cursor_directory',
      },
      tags: ['cursor', 'pre-action-checks', 'agent-reliability', 'guardrails'],
    },
    {
      key: 'team_marketplace',
      name: 'Cursor Team Marketplace',
      role: 'Private repo-backed install surface for teams and enterprise admins',
      operatorStatus: 'Use when a team wants repo-backed refresh and internal rollout control.',
      buyer: 'Teams standardizing one valuable Cursor workflow before broader rollout.',
      conversionGoal: 'qualified_team_conversation',
      submissionUrl: 'Dashboard -> Settings -> Plugins -> Team Marketplaces',
      shortDescription: 'Repo-backed ThumbGate install path for teams that need shared pre-action checks, workflow proof, and controlled plugin refresh.',
      longDescription: [
        'Pitch the Team Marketplace only after a buyer already named one repeated workflow failure, one owner, and one approval boundary.',
        'ThumbGate Teams starts with the Workflow Hardening Sprint, then expands to shared prevention gates, proof review, and repo-backed refresh.',
      ],
      supportPath: 'docs/CUSTOMER_DISCOVERY_SPRINT.md',
      homepageBase: 'sprint',
      trackingKey: 'team_marketplace_homepage',
      tracking: {
        utmMedium: TEAM_MARKETPLACE_MEDIUM,
        utmCampaign: 'cursor_team_marketplace',
        utmContent: 'homepage',
        surface: 'team_marketplace',
      },
      tags: ['cursor', 'workflow-hardening', 'team-marketplace', 'proof'],
    },
  ];

  return surfaceConfigs.map((config) => buildCursorSurface(config, links, about));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  const proTracking = buildCursorTrackingMetadata('pro_follow_on', {
    utmMedium: MARKETPLACE_MEDIUM,
    utmCampaign: 'cursor_plugin_follow_on',
    utmContent: 'pro',
    ctaPlacement: 'post_install',
    ctaId: 'cursor_pro_follow_on',
    planId: 'pro',
    surface: 'cursor_post_install',
  });
  const sprintTracking = buildCursorTrackingMetadata('teams_follow_on', {
    utmMedium: MARKETPLACE_MEDIUM,
    utmCampaign: 'cursor_team_follow_on',
    utmContent: 'workflow_sprint',
    ctaPlacement: 'post_install',
    ctaId: 'cursor_team_follow_on',
    surface: 'cursor_post_install',
  });

  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricingModel: links.proPriceLabel,
      buyer: 'Solo operators who want the self-serve dashboard and proof-ready exports after install.',
      cta: buildTrackedCursorLink(links.proCheckoutLink, proTracking),
    },
    {
      key: 'teams',
      label: 'Workflow Hardening Sprint',
      pricingModel: 'Workflow Hardening Sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams who already named one repeated workflow failure and need rollout proof.',
      cta: buildTrackedCursorLink(links.sprintLink, sprintTracking),
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'plugin_install_to_paid_intent',
    policy: 'Treat Cursor Marketplace installs as acquisition evidence only after a tracked follow-on event exists.',
    metrics: [
      'marketplace_listing_views',
      'homepage_clicks',
      'proof_clicks',
      'plugin_installs',
      'pro_checkout_starts',
      'qualified_team_conversations',
      'paid_pro_conversions',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Refresh the Marketplace listing, directory profile, and screenshot set with tracked homepage plus proof links.',
        decision: 'Do not rewrite the value prop until homepage clicks or installs show a clear mismatch.',
      },
      {
        window: 'days_31_60',
        goal: 'Promote whichever follow-on motion converts better: Pro self-serve or Workflow Hardening Sprint.',
        decision: 'If installs happen without paid intent, move proof and follow-on offers higher in post-install docs.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether Cursor should stay a plugin-only lane or become a team rollout channel.',
        decision: 'Only prioritize Team Marketplace motion when qualified conversations exist.',
      },
    ],
    successThresholds: {
      minimumUsefulSignal: 'one tracked Pro checkout start or one qualified team conversation',
      strongSignal: 'three tracked paid-intent events across Pro or team motion',
      doNotCountAsSuccess: [
        'directory views without marketplace visits',
        'installs without a tracked follow-on event',
        'unverified revenue or marketplace approval claims',
      ],
    },
  };
}

function buildCursorMarketplaceRevenuePack(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: new Date().toISOString(),
    channel: 'Cursor',
    objective: 'Turn Cursor plugin discovery into tracked installs, Pro checkout starts, and qualified team conversations.',
    canonicalIdentity: {
      displayName: 'ThumbGate',
      slug: 'thumbgate',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      githubDescription: about.githubDescription,
      shortDescription: CANONICAL_SHORT_DESCRIPTION,
      longDescription: CANONICAL_LONG_DESCRIPTION,
    },
    surfaces: buildCursorMarketplaceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    screenshots: buildScreenshotManifest(),
    measurementPlan: buildMeasurementPlan(),
  };
}

function renderCursorMarketplaceRevenuePackMarkdown(pack) {
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
  const screenshotLines = pack.screenshots.map((entry) => `- ${entry.file} (${entry.role}): ${entry.reason}`);

  return [
    '# Cursor Marketplace Revenue Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of installs, paid revenue, directory approval, or marketplace publication by itself.',
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
    '## Submission Surfaces',
    ...surfaceLines,
    '## Follow-On Offers',
    ...offerLines,
    '',
    '## Screenshot Set',
    ...screenshotLines,
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

function renderCursorMarketplaceRevenuePackCsv(pack) {
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

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(args.shift());
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = normalizeText(arg.slice('--report-dir='.length));
    }
  }

  return options;
}

function writeCursorMarketplaceRevenuePack(pack, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderCursorMarketplaceRevenuePackMarkdown(pack);
  const csv = renderCursorMarketplaceRevenuePackCsv(pack);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'cursor-marketplace-revenue-pack.md');

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'cursor-marketplace-revenue-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'cursor-marketplace-revenue-pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'cursor-marketplace-surfaces.csv'), csv, 'utf8');
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
  const pack = buildCursorMarketplaceRevenuePack();
  const written = writeCursorMarketplaceRevenuePack(pack, options);

  console.log('Cursor marketplace revenue pack ready.');
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
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  CANONICAL_SHORT_DESCRIPTION,
  CURSOR_DIRECTORY_URL,
  CURSOR_PUBLISH_URL,
  DIRECTORY_MEDIUM,
  MARKETPLACE_MEDIUM,
  TEAM_MARKETPLACE_MEDIUM,
  buildCursorMarketplaceRevenuePack,
  buildCursorMarketplaceSurfaces,
  buildCursorTrackingMetadata,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildScreenshotManifest,
  buildTrackedCursorLink,
  isCliInvocation,
  parseArgs,
  renderCursorMarketplaceRevenuePackCsv,
  renderCursorMarketplaceRevenuePackMarkdown,
  writeCursorMarketplaceRevenuePack,
};
