#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDir } = require('./fs-utils');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');

const DASHBOARD_URL = 'https://aiventyx.com/dashboard';
const AI_CODING_CATEGORY = 'AI Coding';
const STANDARD_MARKETPLACE_FEE = 'Accept the standard Aiventyx marketplace fee for the first listing phase.';

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
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

function buildAiventyxListings(links = buildRevenueLinks()) {
  return [
    {
      key: 'free',
      name: 'ThumbGate Free',
      dashboardStatus: 'keep existing free listing live',
      category: AI_CODING_CATEGORY,
      pricingModel: 'Free',
      APIEndpoint: links.appOrigin,
      primaryCTA: 'https://www.npmjs.com/package/thumbgate',
      headline: 'Turn AI-agent feedback into reusable pre-action gates.',
      description: [
        'ThumbGate captures thumbs up/down style corrections from AI coding sessions, turns them into searchable lessons, and regenerates pre-action gates so agents check known failure patterns before they act.',
        'Use the free package when you want local feedback capture, memory search, and CLI-first reliability checks for a single operator.'
      ].join(' '),
      buyer: 'Solo builders evaluating local AI coding reliability.',
      conversionGoal: 'install_or_free_usage',
      proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
    },
    {
      key: 'pro',
      name: 'ThumbGate Pro',
      dashboardStatus: 'submit as paid listing',
      category: AI_CODING_CATEGORY,
      pricingModel: '$19/mo or $149/yr',
      APIEndpoint: links.appOrigin,
      primaryCTA: links.proCheckoutLink,
      headline: 'Personal AI reliability memory with proof-ready exports.',
      description: [
        'ThumbGate Pro is for builders who want a personal reliability layer across AI coding sessions: synced lessons, feedback-to-gate enforcement, local dashboard views, DPO/KTO-ready exports, and evidence checks before completion claims.',
        'It keeps the free local loop intact while giving serious operators the paid path for durable memory and proof artifacts.'
      ].join(' '),
      buyer: 'Solo operators and small teams with repeated AI coding mistakes but no team rollout yet.',
      conversionGoal: 'paid_pro_conversion',
      proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
    },
    {
      key: 'teams',
      name: 'ThumbGate Teams',
      dashboardStatus: 'submit as team/service listing',
      category: AI_CODING_CATEGORY,
      pricingModel: 'Workflow Hardening Sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      APIEndpoint: links.appOrigin,
      primaryCTA: links.sprintLink,
      headline: 'Harden one AI-agent workflow before scaling it team-wide.',
      description: [
        'ThumbGate Teams starts with a Workflow Hardening Sprint: one workflow, one owner, one repeated failure, one proof review.',
        'The sprint turns repeated AI-agent mistakes into shared prevention gates, audit-ready evidence, and a rollout path for teams that need approvals, compliance, and repeatability.'
      ].join(' '),
      buyer: 'Teams with one valuable AI-agent workflow that keeps repeating the same mistake or losing operational context.',
      conversionGoal: 'qualified_team_conversation',
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

function buildAiventyxMarketplacePlan(links = buildRevenueLinks()) {
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
    '',
    listing.description,
    '',
    `Proof: ${listing.proofLinks.join(' | ')}`,
    '',
  ];
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
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'aiventyx-marketplace-revenue-pack.md');

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'aiventyx-marketplace-plan.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'aiventyx-marketplace-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
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
  DASHBOARD_URL,
  STANDARD_MARKETPLACE_FEE,
  buildAiventyxFollowUp,
  buildAiventyxListings,
  buildAiventyxMarketplacePlan,
  buildAiventyxNinetyDayPlan,
  isCliInvocation,
  parseArgs,
  renderAiventyxMarketplaceMarkdown,
  writeAiventyxMarketplaceOutputs,
};
