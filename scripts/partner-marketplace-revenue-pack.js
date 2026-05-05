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

const CHANNELS = [
  {
    key: 'lindy',
    name: 'Lindy.ai',
    source: 'lindy',
    medium: 'workflow_template',
    submissionUrl: 'https://www.lindy.ai/integrations',
    officialSources: [
      'https://www.lindy.ai/integrations',
      'https://docs.lindy.ai/skills/by-lindy/webhooks',
      'https://docs.lindy.ai/skills/by-lindy/http-request',
    ],
    productMotion: 'Webhook and HTTP Request workflow template',
    buyer: 'Operations teams building AI workflow automations that call custom APIs or receive webhooks.',
    listingStatus: 'prepare workflow template and integration request; do not claim native integration listing until approved',
    headline: 'Gate risky AI workflow actions before Lindy calls your APIs.',
    shortDescription: 'ThumbGate gives Lindy builders a webhook/API checkpoint for expensive AI-agent actions before they touch code, payments, deploys, or customer systems.',
    longDescription: [
      'Lindy is strongest for ThumbGate as a workflow-template channel: a Webhook trigger receives a proposed agent action, the HTTP Request step calls ThumbGate, and the workflow routes allow, block, or checkpoint outcomes.',
      'Sell this as a proof-backed operations template first. Ask for a native Lindy integration listing only after the webhook template produces tracked qualified leads or Pro conversions.',
    ].join(' '),
    primaryMotion: 'sprint',
    assetRoles: ['og_image', 'hero_screenshot', 'dashboard_screenshot'],
    submissionChecklist: [
      'Build a Lindy webhook workflow that receives a proposed AI-agent action payload.',
      'Add an HTTP Request step that calls the ThumbGate preflight endpoint or sprint intake URL with Lindy attribution.',
      'Test allow, block, and checkpoint branches with one risky command and one safe command.',
      'Submit the workflow as an integration/template request only after the test run records a tracked CTA click or qualified sprint conversation.',
    ],
  },
  {
    key: 'gumroad',
    name: 'Gumroad',
    source: 'gumroad',
    medium: 'digital_product',
    submissionUrl: 'https://gumroad.com/features',
    officialSources: [
      'https://gumroad.com/features',
      'https://gumroad.com/help',
    ],
    productMotion: 'Digital product, checklist, template bundle, or paid diagnostic download',
    buyer: 'Solo operators who buy templates, checklists, and compact implementation kits before committing to a SaaS subscription.',
    listingStatus: 'create a digital product listing; keep public homepage checkout on ThumbGate until a live Gumroad product URL exists',
    headline: 'AI Agent Mistake Prevention Kit for solo operators.',
    shortDescription: 'A compact ThumbGate setup kit: repeated-mistake checklist, pre-action gate templates, dashboard proof path, and Pro activation link.',
    longDescription: [
      'Gumroad is the low-friction storefront for the self-serve buyer who wants a downloadable workflow-hardening kit before buying Pro.',
      'Package the guide, checklist, screenshots, and activation path. Do not position Gumroad as the canonical SaaS checkout unless a live product exists and attribution is verified.',
    ].join(' '),
    primaryMotion: 'pro',
    assetRoles: ['icon', 'gumroad_cover', 'terminal_screenshot'],
    submissionChecklist: [
      'Create a Gumroad digital product for the AI Agent Mistake Prevention Kit.',
      'Use the square icon as the thumbnail, the comparison graphic as the cover, and the terminal demo as the proof screenshot.',
      'Package the setup checklist, first repeated-mistake worksheet, and Pro activation link as the downloadable product content.',
      'Publish only after the listing uses the tracked Gumroad Pro CTA and avoids claiming marketplace sales or approval.',
    ],
  },
  {
    key: 'gohighlevel',
    name: 'GoHighLevel',
    source: 'gohighlevel',
    medium: 'marketplace_app',
    submissionUrl: 'https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/',
    officialSources: [
      'https://www.gohighlevel.com/landing-marketplace',
      'https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/',
      'https://help.gohighlevel.com/support/solutions/articles/155000000136-how-to-get-started-with-the-developer-s-marketplace',
    ],
    productMotion: 'Marketplace app, private beta app, agency snapshot, or workflow-hardening service listing',
    buyer: 'Agencies using GoHighLevel workflows, automations, webhooks, forms, and client operations where repeated AI mistakes create delivery risk.',
    listingStatus: 'start private while testing OAuth/webhook flow, then submit public app only after stability and review evidence',
    headline: 'AI workflow guardrails for GoHighLevel agencies.',
    shortDescription: 'ThumbGate helps agencies gate risky AI automations, webhook actions, and client-operation workflows before they run.',
    longDescription: [
      'GoHighLevel is the strongest team-service channel: agencies already sell workflows, snapshots, and automations to clients.',
      'Use a private marketplace app or snapshot first, wire OAuth/webhooks only after scope is proven, and route public demand to the Workflow Hardening Sprint.',
    ].join(' '),
    primaryMotion: 'sprint',
    assetRoles: ['icon', 'og_image', 'workflow_screenshot'],
    submissionChecklist: [
      'Create or update a GoHighLevel private marketplace app or agency snapshot first.',
      'Scope OAuth/webhook behavior to workflow-hardening intake and proof review; do not request broad client data scopes before a buyer need is confirmed.',
      'Use the icon, OG graphic, and workflow explainer screenshot as the first visual set.',
      'Submit a public marketplace app only after private testing proves stable attribution and at least one qualified agency workflow conversation.',
    ],
  },
];

const VISUAL_ASSETS = [
  {
    key: 'icon',
    file: 'public/assets/brand/thumbgate-icon-512.png',
    dimensions: '512x512',
    role: 'App icon, marketplace icon, GPT avatar, square listing thumbnail',
    status: 'ready',
  },
  {
    key: 'marketplace_icon',
    file: 'plugins/cursor-marketplace/assets/logo-400x400.png',
    dimensions: '400x400',
    role: 'Marketplace-safe square plugin logo',
    status: 'ready',
  },
  {
    key: 'og_image',
    file: 'public/og.png',
    dimensions: '1200x630',
    role: 'Open Graph, social preview, Lindy/GHL listing hero',
    status: 'ready',
  },
  {
    key: 'github_social_preview',
    file: 'public/assets/brand/github-social-preview.png',
    dimensions: '1280x640',
    role: 'GitHub social preview and wide directory image',
    status: 'ready',
  },
  {
    key: 'wordmark',
    file: 'public/assets/brand/thumbgate-logo-1200x360.png',
    dimensions: '1200x360',
    role: 'Checkout logo and wide header graphic',
    status: 'ready',
  },
  {
    key: 'hero_screenshot',
    file: 'docs/marketing/gallery/05-hero.png',
    dimensions: '1344x800',
    role: 'Marketplace hero screenshot',
    status: 'ready',
  },
  {
    key: 'dashboard_screenshot',
    file: 'docs/marketing/gallery/01-dashboard.png',
    dimensions: '1344x800',
    role: 'Dashboard proof screenshot',
    status: 'ready',
  },
  {
    key: 'terminal_screenshot',
    file: 'docs/marketing/gallery/03-terminal-demo.png',
    dimensions: '1344x800',
    role: 'CLI and blocked-action demo screenshot',
    status: 'ready',
  },
  {
    key: 'workflow_screenshot',
    file: 'docs/marketing/gallery/02-how-it-works.png',
    dimensions: '1344x800',
    role: 'Workflow explainer screenshot',
    status: 'ready',
  },
  {
    key: 'gumroad_cover',
    file: 'docs/marketing/gallery/04-comparison.png',
    dimensions: '1344x800',
    role: 'Digital product cover and comparison image',
    status: 'ready',
  },
];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseArgs(argv = []) {
  const options = {
    reportDir: '',
    writeDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = normalizeText(arg.slice('--report-dir='.length));
    }
  }

  return options;
}

function buildTrackedPartnerLink(baseUrl, tracking = {}) {
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
    landing_path: tracking.landingPath,
    surface: tracking.surface,
  };

  for (const [key, value] of Object.entries(extras)) {
    if (normalizeText(value)) {
      url.searchParams.set(key, normalizeText(value));
    }
  }

  return url.toString();
}

function buildPartnerTrackingMetadata(channel, motion) {
  const key = normalizeText(channel.key);
  const normalizedMotion = normalizeText(motion);
  const offerCode = `${key}-${normalizedMotion}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

  return {
    utmSource: channel.source,
    utmMedium: channel.medium,
    utmCampaign: `${key}_${normalizedMotion}_listing`,
    utmContent: 'partner_marketplace_pack',
    campaignVariant: `${key}_${normalizedMotion}`,
    offerCode,
    ctaId: `${key}_${normalizedMotion}_listing`,
    ctaPlacement: 'partner_marketplace_listing',
    planId: normalizedMotion === 'pro' ? 'pro' : '',
    landingPath: normalizedMotion === 'pro' ? '/go/pro' : '/',
    surface: `${key}_${channel.medium}`,
  };
}

function resolvePrimaryCta(channel, links = buildRevenueLinks()) {
  const tracking = buildPartnerTrackingMetadata(channel, channel.primaryMotion);
  const baseUrl = channel.primaryMotion === 'pro'
    ? `${links.appOrigin}/go/pro`
    : links.sprintLink;

  return buildTrackedPartnerLink(baseUrl, tracking);
}

function buildPartnerListing(channel, links = buildRevenueLinks()) {
  const tracking = buildPartnerTrackingMetadata(channel, channel.primaryMotion);
  const assetManifest = channel.assetRoles.map((role) => (
    VISUAL_ASSETS.find((asset) => asset.key === role)
  )).filter(Boolean);

  return {
    key: channel.key,
    name: channel.name,
    productMotion: channel.productMotion,
    buyer: channel.buyer,
    listingStatus: channel.listingStatus,
    submissionUrl: channel.submissionUrl,
    officialSources: channel.officialSources,
    headline: channel.headline,
    shortDescription: channel.shortDescription,
    longDescription: channel.longDescription,
    primaryMotion: channel.primaryMotion,
    primaryCTA: resolvePrimaryCta(channel, links),
    conversionGoal: channel.primaryMotion === 'pro'
      ? 'paid_pro_conversion'
      : 'qualified_team_conversation',
    attribution: tracking,
    assetManifest,
    submissionChecklist: channel.submissionChecklist,
    proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
  };
}

function buildPartnerListings(links = buildRevenueLinks()) {
  return CHANNELS.map((channel) => buildPartnerListing(channel, links));
}

function buildChannelMeasurementPlan() {
  return {
    northStar: 'paid_conversion_or_qualified_team_conversation',
    policy: 'Treat partner listings as acquisition only until a tracked Pro checkout start, paid Pro conversion, or qualified Workflow Hardening Sprint conversation exists.',
    metrics: [
      'partner_listing_views',
      'partner_cta_clicks',
      'guide_clicks',
      'pro_checkout_starts',
      'paid_pro_conversions',
      'workflow_sprint_intake_submissions',
      'qualified_team_conversations',
    ],
    successThresholds: {
      minimumUsefulSignal: 'one tracked Pro checkout start or one qualified Workflow Hardening Sprint conversation from a partner source',
      strongSignal: 'three tracked paid-intent events across Lindy.ai, Gumroad, or GoHighLevel',
      doNotCountAsSuccess: [
        'listing creation without tracked clicks',
        'views without CTA clicks',
        'unverified revenue, install, or marketplace approval claims',
      ],
    },
    channelSequence: [
      'Gumroad first for fastest self-serve digital product validation.',
      'Lindy.ai second as a webhook/API template for workflow builders.',
      'GoHighLevel third for agency/team distribution after private app or snapshot testing.',
    ],
  };
}

function buildPartnerMarketplaceRevenuePack(links = buildRevenueLinks()) {
  return {
    generatedAt: new Date().toISOString(),
    channels: ['Lindy.ai', 'Gumroad', 'GoHighLevel'],
    objective: 'Turn new partner marketplaces into tracked Pro conversions and qualified Workflow Hardening Sprint conversations without inventing platform approval.',
    listings: buildPartnerListings(links),
    visualAssets: VISUAL_ASSETS,
    measurementPlan: buildChannelMeasurementPlan(),
    sourceRule: 'Use official platform docs for channel fit, but use ThumbGate-owned tracked CTAs for attribution until the external listing URL is live and verified.',
  };
}

function renderListingMarkdown(listing) {
  return [
    `### ${listing.name}`,
    '',
    `- Product motion: ${listing.productMotion}`,
    `- Buyer: ${listing.buyer}`,
    `- Listing status: ${listing.listingStatus}`,
    `- Submission/setup URL: ${listing.submissionUrl}`,
    `- Primary motion: ${listing.primaryMotion}`,
    `- Primary CTA: ${listing.primaryCTA}`,
    `- Conversion goal: ${listing.conversionGoal}`,
    `- Headline: ${listing.headline}`,
    `- Short description: ${listing.shortDescription}`,
    `- Attribution: utm_source=${listing.attribution.utmSource}, utm_medium=${listing.attribution.utmMedium}, utm_campaign=${listing.attribution.utmCampaign}, offer_code=${listing.attribution.offerCode}`,
    '',
    listing.longDescription,
    '',
    'Official source references:',
    ...listing.officialSources.map((source) => `- ${source}`),
    '',
    'Recommended visual assets:',
    ...listing.assetManifest.map((asset) => `- ${asset.file} (${asset.dimensions}) - ${asset.role}`),
    '',
    'Submission checklist:',
    ...listing.submissionChecklist.map((item) => `- [ ] ${item}`),
    '',
    `Proof links: ${listing.proofLinks.join(' | ')}`,
    '',
  ];
}

function renderVisualAssetsMarkdown(assets) {
  return [
    '| Asset | Dimensions | Role | Status |',
    '|---|---:|---|---|',
    ...assets.map((asset) => `| ${asset.file} | ${asset.dimensions} | ${asset.role} | ${asset.status} |`),
  ];
}

function renderPartnerMarketplaceMarkdown(pack) {
  const lines = [
    '# Partner Marketplace Revenue Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of revenue, submitted listings, sent messages, installs, or marketplace approval.',
    '',
    '## Objective',
    '',
    pack.objective,
    '',
    '## Source Rule',
    '',
    pack.sourceRule,
    '',
    '## Channels To Sell',
    '',
    ...pack.listings.flatMap(renderListingMarkdown),
    '## Visual Asset Audit',
    '',
    ...renderVisualAssetsMarkdown(pack.visualAssets),
    '',
    '## Measurement Plan',
    '',
    `- North star: ${pack.measurementPlan.northStar}`,
    `- Policy: ${pack.measurementPlan.policy}`,
    `- Minimum useful signal: ${pack.measurementPlan.successThresholds.minimumUsefulSignal}`,
    `- Strong signal: ${pack.measurementPlan.successThresholds.strongSignal}`,
    '',
    'Tracked metrics:',
    ...pack.measurementPlan.metrics.map((metric) => `- ${metric}`),
    '',
    'Channel sequence:',
    ...pack.measurementPlan.channelSequence.map((item) => `- ${item}`),
    '',
    'Do not count as success:',
    ...pack.measurementPlan.successThresholds.doNotCountAsSuccess.map((item) => `- ${item}`),
    '',
  ];

  return `${lines.join('\n').trim()}\n`;
}

function renderPartnerMarketplaceCsv(pack) {
  const header = [
    'key',
    'name',
    'productMotion',
    'listingStatus',
    'submissionUrl',
    'primaryMotion',
    'primaryCTA',
    'conversionGoal',
    'headline',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'campaign_variant',
    'offer_code',
    'cta_id',
    'cta_placement',
    'plan_id',
    'landing_path',
    'surface',
    'asset_files',
    'submission_checklist',
    'official_sources',
    'proof_links',
  ];

  const rows = pack.listings.map((listing) => ([
    listing.key,
    listing.name,
    listing.productMotion,
    listing.listingStatus,
    listing.submissionUrl,
    listing.primaryMotion,
    listing.primaryCTA,
    listing.conversionGoal,
    listing.headline,
    listing.attribution.utmSource,
    listing.attribution.utmMedium,
    listing.attribution.utmCampaign,
    listing.attribution.utmContent,
    listing.attribution.campaignVariant,
    listing.attribution.offerCode,
    listing.attribution.ctaId,
    listing.attribution.ctaPlacement,
    listing.attribution.planId,
    listing.attribution.landingPath,
    listing.attribution.surface,
    listing.assetManifest.map((asset) => asset.file).join(' | '),
    listing.submissionChecklist.join(' | '),
    listing.officialSources.join(' | '),
    listing.proofLinks.join(' | '),
  ]));

  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function writePartnerMarketplaceOutputs(pack, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderPartnerMarketplaceMarkdown(pack);
  const csv = renderPartnerMarketplaceCsv(pack);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'partner-marketplace-revenue-pack.md');
  const docsDir = path.dirname(docsPath);

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'partner-marketplace-revenue-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'partner-marketplace-revenue-pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'partner-marketplace-listings.csv'), csv, 'utf8');
  }

  if (options.writeDocs) {
    ensureDir(docsDir);
    fs.writeFileSync(docsPath, markdown, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'partner-marketplace-revenue-pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'partner-marketplace-listings.csv'), csv, 'utf8');
  }

  return {
    markdown,
    docsPath: options.writeDocs ? docsPath : null,
    reportDir: reportDir || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildPartnerMarketplaceRevenuePack();
  const written = writePartnerMarketplaceOutputs(pack, options);

  console.log('Partner marketplace revenue pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    channels: pack.channels.length,
    listings: pack.listings.length,
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
  CHANNELS,
  VISUAL_ASSETS,
  buildChannelMeasurementPlan,
  buildPartnerListing,
  buildPartnerListings,
  buildPartnerMarketplaceRevenuePack,
  buildPartnerTrackingMetadata,
  buildTrackedPartnerLink,
  isCliInvocation,
  parseArgs,
  renderPartnerMarketplaceCsv,
  renderPartnerMarketplaceMarkdown,
  writePartnerMarketplaceOutputs,
};
