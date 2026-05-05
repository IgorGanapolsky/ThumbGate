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

const DASHBOARD_URL = 'https://aiventyx.com/dashboard';
const AI_CODING_CATEGORY = 'AI Coding';
const STANDARD_MARKETPLACE_FEE = 'Accept the standard Aiventyx marketplace fee for the first listing phase.';
const AIVENTYX_SOURCE = 'aiventyx';
const AIVENTYX_MEDIUM = 'marketplace';
const AIVENTYX_CONTENT = 'dashboard';
const PUBLIC_BUYER_ORIGIN = 'https://thumbgate.ai';

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildTrackedMarketplaceLink(baseUrl, tracking = {}) {
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
  };
  for (const [key, value] of Object.entries(extras)) {
    if (normalizeText(value)) {
      url.searchParams.set(key, normalizeText(value));
    }
  }

  return url.toString();
}

function buildAiventyxTrackingMetadata(key) {
  const normalizedKey = normalizeText(key).toLowerCase();
  const upperKey = normalizedKey.toUpperCase();
  return {
    utmSource: AIVENTYX_SOURCE,
    utmMedium: AIVENTYX_MEDIUM,
    utmCampaign: `aiventyx_${normalizedKey}_listing`,
    utmContent: AIVENTYX_CONTENT,
    campaignVariant: normalizedKey,
    offerCode: `AIVENTYX-${upperKey}`,
    ctaPlacement: 'marketplace_listing',
    ctaId: `aiventyx_${normalizedKey}_listing`,
    landingPath: '/',
  };
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

function buildPublicAiventyxRevenueLinks() {
  return buildRevenueLinks({
    appOrigin: PUBLIC_BUYER_ORIGIN,
    guideLink: `${PUBLIC_BUYER_ORIGIN}/guide`,
    proCheckoutLink: `${PUBLIC_BUYER_ORIGIN}/checkout/pro`,
    sprintLink: `${PUBLIC_BUYER_ORIGIN}/#workflow-sprint-intake`,
  });
}

function buildAiventyxListings(links = buildPublicAiventyxRevenueLinks()) {
  const freeTracking = buildAiventyxTrackingMetadata('free');
  const proTracking = {
    ...buildAiventyxTrackingMetadata('pro'),
    planId: 'pro',
  };
  const teamsTracking = buildAiventyxTrackingMetadata('teams');

  return [
    {
      key: 'free',
      name: 'ThumbGate Free',
      dashboardStatus: 'keep existing free listing live',
      category: AI_CODING_CATEGORY,
      pricingModel: 'Free',
      APIEndpoint: links.appOrigin,
      primaryCTA: buildTrackedMarketplaceLink(`${links.appOrigin}/go/install`, freeTracking),
      headline: 'Turn AI-agent feedback into reusable pre-action gates.',
      description: [
        'ThumbGate captures thumbs up/down style corrections from AI coding sessions, turns them into searchable lessons, and regenerates pre-action gates so agents check known failure patterns before they act.',
        'Use the free package when you want local feedback capture, memory search, and CLI-first reliability checks for a single operator.'
      ].join(' '),
      buyer: 'Solo builders evaluating local AI coding reliability.',
      conversionGoal: 'install_or_free_usage',
      attribution: freeTracking,
      proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
    },
    {
      key: 'pro',
      name: 'ThumbGate Pro',
      dashboardStatus: 'submit as paid listing',
      category: AI_CODING_CATEGORY,
      pricingModel: '$19/mo or $149/yr',
      APIEndpoint: links.appOrigin,
      primaryCTA: buildTrackedMarketplaceLink(`${links.appOrigin}/go/pro`, proTracking),
      headline: 'Personal AI reliability memory with proof-ready exports.',
      description: [
        'ThumbGate Pro is for builders who want a personal reliability layer across AI coding sessions: synced lessons, feedback-to-gate enforcement, local dashboard views, DPO/KTO-ready exports, and evidence checks before completion claims.',
        'It keeps the free local loop intact while giving serious operators the paid path for durable memory and proof artifacts.'
      ].join(' '),
      buyer: 'Solo operators and small teams with repeated AI coding mistakes but no team rollout yet.',
      conversionGoal: 'paid_pro_conversion',
      attribution: proTracking,
      proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
    },
    {
      key: 'teams',
      name: 'ThumbGate Teams',
      dashboardStatus: 'submit as team/service listing',
      category: AI_CODING_CATEGORY,
      pricingModel: 'Workflow Hardening Sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      APIEndpoint: links.appOrigin,
      primaryCTA: buildTrackedMarketplaceLink(links.sprintLink, teamsTracking),
      headline: 'Harden one AI-agent workflow before scaling it team-wide.',
      description: [
        'ThumbGate Teams starts with a Workflow Hardening Sprint: one workflow, one owner, one repeated failure, one proof review.',
        'The sprint turns repeated AI-agent mistakes into shared prevention gates, audit-ready evidence, and a rollout path for teams that need approvals, compliance, and repeatability.'
      ].join(' '),
      buyer: 'Teams with one valuable AI-agent workflow that keeps repeating the same mistake or losing operational context.',
      conversionGoal: 'qualified_team_conversation',
      attribution: teamsTracking,
      proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
    },
  ];
}

function buildAiventyxNinetyDayPlan() {
  return {
    northStar: 'paid_conversion',
    standardFeePosition: STANDARD_MARKETPLACE_FEE,
    integrationPosition: 'Defer pre-action review integration until 60-90 days of listing distribution data exists.',
    metrics: [
      'listing_views',
      'cta_clicks',
      'free_installs',
      'pro_checkout_starts',
      'pro_paid_conversions',
      'team_sprint_intake_submissions',
      'qualified_team_conversations',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Get Pro and Teams listings live, baseline listing views, and record every CTA click with UTM attribution.',
        decision: 'Keep copy unchanged unless click-through is clearly below marketplace average.',
      },
      {
        window: 'days_31_60',
        goal: 'Optimize headline, screenshots, and CTA order around the listing that produces the highest paid-intent rate.',
        decision: 'If free installs happen without paid intent, move Pro proof and sprint qualification higher in the listing.',
      },
      {
        window: 'days_61_90',
        goal: 'Decide whether Aiventyx deserves deeper integration, bundles, or partner-specific onboarding.',
        decision: 'Only revisit pre-action review integration or rev-share bundles after paid conversions or qualified team conversations exist.',
      },
    ],
    successThresholds: {
      minimumUsefulSignal: 'one paid Pro conversion or one qualified team conversation',
      strongSignal: 'three paid conversions or three qualified team conversations',
      doNotCountAsSuccess: [
        'views without CTA clicks',
        'likes or comments without a tracked lead stage',
        'unverified revenue claims',
      ],
    },
  };
}

function buildAiventyxFollowUp(plan = buildAiventyxNinetyDayPlan()) {
  return [
    'Thanks again. I submitted the Aiventyx path internally as a distribution-first lane.',
    `For the first 90 days, the north star is ${plan.northStar.replaceAll('_', ' ')}: Pro paid conversions first, with qualified team conversations as the second signal.`,
    'I am good with the standard marketplace fee for this phase.',
    'If you can expose listing views, CTA clicks, and conversion source fields in the dashboard, I will use those to decide whether we should revisit bundles or the deeper pre-action review integration after day 60-90.'
  ].join('\n\n');
}

function buildAiventyxMarketplacePlan(links = buildPublicAiventyxRevenueLinks()) {
  const listings = buildAiventyxListings(links);
  const ninetyDayPlan = buildAiventyxNinetyDayPlan();

  return {
    generatedAt: new Date().toISOString(),
    channel: 'Aiventyx',
    dashboardUrl: DASHBOARD_URL,
    objective: 'Turn existing marketplace visibility into tracked Pro conversions and qualified team conversations.',
    listings,
    ninetyDayPlan,
    followUpDraft: buildAiventyxFollowUp(ninetyDayPlan),
  };
}

function renderListingMarkdown(listing) {
  return [
    `### ${listing.name}`,
    `- Dashboard status: ${listing.dashboardStatus}`,
    `- Category: ${listing.category}`,
    `- Pricing model: ${listing.pricingModel}`,
    `- API endpoint: ${listing.APIEndpoint}`,
    `- Primary CTA: ${listing.primaryCTA}`,
    `- Conversion goal: ${listing.conversionGoal}`,
    `- Buyer: ${listing.buyer}`,
    `- Headline: ${listing.headline}`,
    `- Attribution: utm_source=${listing.attribution.utmSource}, utm_medium=${listing.attribution.utmMedium}, utm_campaign=${listing.attribution.utmCampaign}, offer_code=${listing.attribution.offerCode}`,
    '',
    listing.description,
    '',
    `Proof: ${listing.proofLinks.join(' | ')}`,
    '',
  ];
}

function renderAiventyxMarketplaceCsv(plan) {
  const header = [
    'key',
    'name',
    'dashboardStatus',
    'category',
    'pricingModel',
    'primaryCTA',
    'conversionGoal',
    'buyer',
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
    'proof_links',
  ];

  const rows = plan.listings.map((listing) => ([
    listing.key,
    listing.name,
    listing.dashboardStatus,
    listing.category,
    listing.pricingModel,
    listing.primaryCTA,
    listing.conversionGoal,
    listing.buyer,
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
    listing.proofLinks.join(' | '),
  ]));

  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderAiventyxMarketplaceMarkdown(plan) {
  const lines = [
    '# Aiventyx Marketplace Revenue Pack',
    '',
    `Updated: ${plan.generatedAt}`,
    `Dashboard: ${plan.dashboardUrl}`,
    '',
    'This is a sales operator artifact. It is not proof of revenue, sent messages, or marketplace approval.',
    '',
    '## Objective',
    '',
    plan.objective,
    '',
    '## Listings To Submit',
    '',
    ...plan.listings.flatMap(renderListingMarkdown),
    '## 90-Day Measurement Plan',
    '',
    `- North star: ${plan.ninetyDayPlan.northStar}`,
    `- Fee position: ${plan.ninetyDayPlan.standardFeePosition}`,
    `- Integration position: ${plan.ninetyDayPlan.integrationPosition}`,
    `- Minimum useful signal: ${plan.ninetyDayPlan.successThresholds.minimumUsefulSignal}`,
    `- Strong signal: ${plan.ninetyDayPlan.successThresholds.strongSignal}`,
    '',
    'Tracked metrics:',
    ...plan.ninetyDayPlan.metrics.map((metric) => `- ${metric}`),
    '',
    'Attribution contract:',
    '- Use only the tracked first-party CTAs below so Aiventyx clicks land with explicit source, medium, campaign, and offer metadata.',
    '- Free routes through `/go/install`, Pro routes through `/go/pro`, and Teams routes to the sprint intake with Aiventyx UTMs attached.',
    '',
    'Milestones:',
    ...plan.ninetyDayPlan.milestones.flatMap((milestone) => [
      `- ${milestone.window}: ${milestone.goal}`,
      `  Decision rule: ${milestone.decision}`,
    ]),
    '',
    'Do not count as success:',
    ...plan.ninetyDayPlan.successThresholds.doNotCountAsSuccess.map((item) => `- ${item}`),
    '',
    '## Follow-Up Draft',
    '',
    plan.followUpDraft,
    '',
  ];

  return `${lines.join('\n').trim()}\n`;
}

function writeAiventyxMarketplaceOutputs(plan, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderAiventyxMarketplaceMarkdown(plan);
  const csv = renderAiventyxMarketplaceCsv(plan);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'aiventyx-marketplace-revenue-pack.md');
  const docsDir = path.dirname(docsPath);

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'aiventyx-marketplace-plan.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'aiventyx-marketplace-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'aiventyx-marketplace-listings.csv'), csv, 'utf8');
  }

  if (options.writeDocs) {
    ensureDir(docsDir);
    fs.writeFileSync(docsPath, markdown, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'aiventyx-marketplace-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'aiventyx-marketplace-listings.csv'), csv, 'utf8');
  }

  return {
    markdown,
    docsPath: options.writeDocs ? docsPath : null,
    reportDir: reportDir || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const plan = buildAiventyxMarketplacePlan();
  const written = writeAiventyxMarketplaceOutputs(plan, options);

  console.log('Aiventyx marketplace plan ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    listings: plan.listings.length,
    northStar: plan.ninetyDayPlan.northStar,
    dashboardUrl: plan.dashboardUrl,
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
  AI_CODING_CATEGORY,
  AIVENTYX_CONTENT,
  DASHBOARD_URL,
  STANDARD_MARKETPLACE_FEE,
  buildAiventyxFollowUp,
  buildAiventyxListings,
  buildAiventyxMarketplacePlan,
  buildAiventyxNinetyDayPlan,
  buildAiventyxTrackingMetadata,
  buildPublicAiventyxRevenueLinks,
  buildTrackedMarketplaceLink,
  isCliInvocation,
  parseArgs,
  renderAiventyxMarketplaceCsv,
  renderAiventyxMarketplaceMarkdown,
  writeAiventyxMarketplaceOutputs,
};
