#!/usr/bin/env node
'use strict';

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
  parseReportArgs,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'chatgpt-product-feed-readiness-pack.md');
const SOURCE = Object.freeze({
  searchEngineLandUrl: 'https://searchengineland.com/openai-adds-product-feed-ads-to-chatgpt-477208',
  digidayUrl: 'https://digiday.com/marketing/openai-makes-it-easier-to-run-shopping-ads-in-chatgpt/',
  openAiAdsUrl: 'https://openai.com/index/testing-ads-in-chatgpt/',
  openAiAdvertisersUrl: 'https://openai.com/advertisers',
  observedAt: '2026-05-13',
});
const TRACKING_DEFAULTS = Object.freeze({
  utmSource: 'chatgpt',
  utmMedium: 'product_feed_ads',
  utmCampaign: 'chatgpt_product_feed_readiness',
  utmContent: 'feed',
  surface: 'chatgpt_product_feed',
});
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const CANONICAL_HEADLINE = 'Turn ThumbGate offers into a ChatGPT-ready product feed before paid AI inventory gets crowded.';
const CANONICAL_SHORT_DESCRIPTION = 'A structured feed for ThumbGate Pro, Team, Sprint, install, GPT, and guide offers with tracked URLs, proof links, conversion events, and claim guardrails.';

function trackedLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function buildOfferCatalog(links = buildRevenueLinks()) {
  const appOrigin = links.appOrigin;
  return [
    {
      id: 'thumbgate_free_cli',
      title: 'ThumbGate Free CLI',
      offerType: 'software',
      price: '0.00',
      currency: 'USD',
      billingPeriod: 'one_time',
      audience: 'Developers who want to install pre-action gates before buying Pro.',
      description: 'Install ThumbGate locally and turn thumbs-down feedback into prevention rules for Claude Code, Cursor, Codex, Gemini CLI, and MCP workflows.',
      landingPage: trackedLink(links.guideLink, {
        utmCampaign: 'chatgpt_feed_free_cli',
        utmContent: 'free_cli',
        campaignVariant: 'self_serve_install',
        offerCode: 'CHATGPT-FEED_FREE_CLI',
        ctaId: 'chatgpt_feed_free_cli',
        ctaPlacement: 'product_feed',
      }),
      imageUrl: `${appOrigin}/assets/brand/thumbgate-icon-512.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'install_command_copy',
      intentCluster: 'install agent guardrails',
      eligibilityFilter: 'Eligible when the prompt asks how to install or try AI coding-agent guardrails.',
    },
    {
      id: 'thumbgate_pro_monthly',
      title: 'ThumbGate Pro Monthly',
      offerType: 'subscription',
      price: '19.00',
      currency: 'USD',
      billingPeriod: 'month',
      audience: 'Solo operators who need personal dashboards, unlimited custom gates, and exportable proof.',
      description: 'Upgrade from local checks to a paid operator lane with dashboard, analytics, and proof-ready lesson exports.',
      landingPage: trackedLink(links.proCheckoutLink, {
        utmCampaign: 'chatgpt_feed_pro_monthly',
        utmContent: 'pro_monthly',
        campaignVariant: 'pro_subscription',
        offerCode: 'CHATGPT-FEED_PRO_MONTHLY',
        ctaId: 'chatgpt_feed_pro_monthly',
        ctaPlacement: 'product_feed',
        planId: 'pro',
      }),
      imageUrl: `${appOrigin}/assets/brand/thumbgate-icon-pro-512.png`,
      proofUrl: COMMERCIAL_TRUTH_LINK,
      conversionEvent: 'checkout_start_pro_monthly',
      intentCluster: 'paid agent governance tool',
      eligibilityFilter: 'Eligible only after the user asks for paid plans, dashboards, or ongoing solo use.',
    },
    {
      id: 'thumbgate_pro_annual',
      title: 'ThumbGate Pro Annual',
      offerType: 'subscription',
      price: '149.00',
      currency: 'USD',
      billingPeriod: 'year',
      audience: 'Operators who want lower annual cost after proving one recurring agent failure can be blocked.',
      description: 'Annual Pro plan for continued AI-agent reliability checks, custom gates, dashboards, and proof exports.',
      landingPage: trackedLink(`${links.proCheckoutLink}?billing=annual`, {
        utmCampaign: 'chatgpt_feed_pro_annual',
        utmContent: 'pro_annual',
        campaignVariant: 'annual_subscription',
        offerCode: 'CHATGPT-FEED_PRO_ANNUAL',
        ctaId: 'chatgpt_feed_pro_annual',
        ctaPlacement: 'product_feed',
        planId: 'pro_annual',
      }),
      imageUrl: `${appOrigin}/assets/brand/thumbgate-icon-pro-512.png`,
      proofUrl: COMMERCIAL_TRUTH_LINK,
      conversionEvent: 'checkout_start_pro_annual',
      intentCluster: 'annual AI agent guardrails subscription',
      eligibilityFilter: 'Eligible when the user asks for annual pricing, discounting, or long-term solo use.',
    },
    {
      id: 'thumbgate_team_seats',
      title: 'ThumbGate Team Seats',
      offerType: 'subscription',
      price: '49.00',
      currency: 'USD',
      billingPeriod: 'seat_month',
      audience: 'Teams that need shared agent workflow guardrails and a minimum 3-seat rollout.',
      description: 'Team lane for shared workflow hardening, seats, and proof-backed governance around repeated AI-agent failures.',
      landingPage: trackedLink(`${appOrigin}/go/teams`, {
        utmCampaign: 'chatgpt_feed_team_seats',
        utmContent: 'team_seats',
        campaignVariant: 'team_subscription',
        offerCode: 'CHATGPT-FEED_TEAM',
        ctaId: 'chatgpt_feed_team',
        ctaPlacement: 'product_feed',
        planId: 'team',
      }),
      imageUrl: `${appOrigin}/assets/brand/thumbgate-icon-team-512.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'checkout_start_team',
      intentCluster: 'team AI agent governance',
      eligibilityFilter: 'Eligible when the prompt names teams, seats, approval workflows, or shared guardrails.',
    },
    {
      id: 'thumbgate_workflow_hardening_sprint',
      title: 'Workflow Hardening Sprint',
      offerType: 'service',
      price: 'qualified_intake',
      currency: 'USD',
      billingPeriod: 'one_time',
      audience: 'Platform, DevEx, and security teams with one repeated AI-agent workflow failure.',
      description: 'Founder-led workflow diagnostic: capture the repeated failure, retrieve the lesson, enforce the gate, and prove the next run is safer.',
      landingPage: trackedLink(links.sprintLink, {
        utmCampaign: 'chatgpt_feed_workflow_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'qualified_service',
        offerCode: 'CHATGPT-FEED_SPRINT',
        ctaId: 'chatgpt_feed_sprint',
        ctaPlacement: 'product_feed',
      }),
      imageUrl: `${appOrigin}/og.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'workflow_sprint_intake',
      intentCluster: 'repeated agent failure service',
      eligibilityFilter: 'Eligible only when the user names repeated failures, production workflows, approvals, or rollout risk.',
    },
    {
      id: 'thumbgate_codex_plugin',
      title: 'ThumbGate Codex Plugin',
      offerType: 'plugin',
      price: '0.00',
      currency: 'USD',
      billingPeriod: 'one_time',
      audience: 'Codex users who want pre-action checks before shell, git, PR, or file edits.',
      description: 'Install the Codex profile and run ThumbGate pre-action checks before risky coding-agent actions.',
      landingPage: trackedLink(`${appOrigin}/codex-plugin`, {
        utmCampaign: 'chatgpt_feed_codex_plugin',
        utmContent: 'codex_plugin',
        campaignVariant: 'codex_install',
        offerCode: 'CHATGPT-FEED_CODEX',
        ctaId: 'chatgpt_feed_codex',
        ctaPlacement: 'product_feed',
      }),
      imageUrl: `${appOrigin}/assets/brand/thumbgate-icon-512.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'codex_plugin_install_click',
      intentCluster: 'Codex guardrails plugin',
      eligibilityFilter: 'Eligible when the user asks about Codex, coding-agent plugins, or pre-action checks.',
    },
    {
      id: 'thumbgate_chatgpt_gpt',
      title: 'ThumbGate ChatGPT GPT',
      offerType: 'gpt',
      price: '0.00',
      currency: 'USD',
      billingPeriod: 'one_time',
      audience: 'ChatGPT users who want to preflight one risky action before installing anything locally.',
      description: 'Use the ThumbGate GPT as a discovery front door, then route risky execution into local proof-backed gates.',
      landingPage: trackedLink(`${appOrigin}/go/gpt`, {
        utmCampaign: 'chatgpt_feed_gpt',
        utmContent: 'published_gpt',
        campaignVariant: 'gpt_front_door',
        offerCode: 'CHATGPT-FEED_GPT',
        ctaId: 'chatgpt_feed_gpt',
        ctaPlacement: 'product_feed',
      }),
      imageUrl: `${appOrigin}/thumbgate-icon.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'open_published_gpt',
      intentCluster: 'ChatGPT action preflight',
      eligibilityFilter: 'Eligible when the user asks for a ChatGPT-native way to check an action or capture feedback.',
    },
    {
      id: 'thumbgate_chatgpt_ads_trust_guide',
      title: 'ChatGPT Ads Trust Guide',
      offerType: 'guide',
      price: '0.00',
      currency: 'USD',
      billingPeriod: 'one_time',
      audience: 'Teams reacting to AI-search ads who need clear boundaries between discovery and execution.',
      description: 'A guide for keeping ChatGPT discovery, sponsored recommendations, and local agent execution separated by proof-backed gates.',
      landingPage: trackedLink(`${appOrigin}/guides/chatgpt-ads-trust`, {
        utmCampaign: 'chatgpt_feed_ads_trust',
        utmContent: 'ads_trust_guide',
        campaignVariant: 'trust_guide',
        offerCode: 'CHATGPT-FEED_TRUST_GUIDE',
        ctaId: 'chatgpt_feed_trust_guide',
        ctaPlacement: 'product_feed',
      }),
      imageUrl: `${appOrigin}/assets/brand/github-social-preview.png`,
      proofUrl: VERIFICATION_EVIDENCE_LINK,
      conversionEvent: 'chatgpt_ads_trust_guide_view',
      intentCluster: 'AI ads trust boundary',
      eligibilityFilter: 'Eligible when the prompt discusses ChatGPT ads, sponsored AI answers, AI-search trust, or recommendation bias.',
    },
  ].map((offer) => ({
    ...offer,
    availability: 'online',
    brand: 'ThumbGate',
    claimGuardrail: 'Do not claim ChatGPT ad access, OpenAI endorsement, customers, or verified customer revenue without explicit evidence.',
  }));
}

function buildConversionEvents() {
  return [
    {
      event: 'chatgpt_product_feed_click',
      source: 'ChatGPT product-feed ad or organic product card',
      successDefinition: 'Tracked landing click with offer_id and cta_id preserved.',
    },
    {
      event: 'install_command_copy',
      source: 'Free CLI and guide rows',
      successDefinition: 'User copied or clicked the install command after a product-feed visit.',
    },
    {
      event: 'checkout_start_pro_monthly',
      source: 'Pro monthly row',
      successDefinition: 'A non-bot checkout start with visitor/session attribution.',
    },
    {
      event: 'workflow_sprint_intake',
      source: 'Workflow Hardening Sprint row',
      successDefinition: 'Contactable lead names one repeated AI-agent workflow failure.',
    },
    {
      event: 'verified_customer_revenue',
      source: 'Billing reconciliation',
      successDefinition: 'Non-operator buyer provenance exists; operator/test payments do not count.',
    },
  ];
}

function buildEligibilityFilters() {
  return [
    'Exclude regulated health, mental-health, politics, or sensitive personal targeting.',
    'Exclude broad AI-tool curiosity prompts with no agent-governance pain.',
    'Use free install or guide rows before checkout rows when the user asks how to learn or try.',
    'Use Sprint row only when the prompt names a repeated workflow failure, approvals, production risk, or team rollout.',
    'Use Pro rows only when the prompt asks for pricing, dashboard, exports, or ongoing paid use.',
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'chatgpt_feed_to_verified_paid_intent',
    policy: 'Count success only when a tracked product-feed click produces install intent, Pro checkout start, qualified sprint intake, or verified non-operator customer revenue.',
    metrics: [
      'chatgpt_product_feed_clicks',
      'offer_id_clickthrough_rate',
      'install_command_copy_rate',
      'pro_checkout_start_rate',
      'workflow_sprint_intake_rate',
      'verified_customer_revenue',
    ],
    doNotCountAsSuccess: [
      'impressions without clicks',
      'ChatGPT organic mentions without tracked sessions',
      'operator/test Stripe payments',
      'checkout starts without customer provenance',
      'ad access signup without approved account access',
    ],
    guardrails: [
      'Do not imply ads influence ChatGPT answers.',
      'Do not claim OpenAI approval, launch access, product-feed acceptance, or ad performance before evidence exists.',
      'Do not route cold educational prompts directly to checkout when the guide is a better first touch.',
    ],
  };
}

function buildOperatorQueue(offers = []) {
  return [
    {
      key: 'submit_advertiser_interest',
      audience: 'OpenAI advertiser access',
      evidence: SOURCE.openAiAdvertisersUrl,
      nextAsk: 'Register interest with ThumbGate legal/support URLs and product-feed sample ready.',
      blocker: 'Do not claim access until OpenAI approves the advertiser account.',
    },
    {
      key: 'upload_offer_sample',
      audience: 'Product-feed pilot sample',
      evidence: SOURCE.digidayUrl,
      nextAsk: `Use ${offers.length} structured ThumbGate offer rows as the pilot sample; expand only if accepted.`,
      blocker: 'ThumbGate has service/software offers, not thousands of SKUs; keep feed concise and eligibility-filtered.',
    },
    {
      key: 'wire_conversion_events',
      audience: 'Paid AI measurement',
      evidence: 'docs/marketing/chatgpt-product-feed-conversions.csv',
      nextAsk: 'Map product-feed offer_id to first-party telemetry, checkout start, sprint intake, and verified customer revenue.',
      blocker: 'No spend scale-up until conversion events separate operator/test payments from real customer provenance.',
    },
  ];
}

function buildChatgptProductFeedReadinessPack(links = buildRevenueLinks()) {
  const offers = buildOfferCatalog(links);
  return {
    generatedAt: new Date().toISOString(),
    status: 'feed-ready-ad-access-unverified',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    source: SOURCE,
    productFeedSpec: {
      currentRows: offers.length,
      expansionRule: 'Expand only with real offer/page variants; do not invent SKUs.',
      requiredFields: [
        'id',
        'title',
        'description',
        'price',
        'currency',
        'landingPage',
        'imageUrl',
        'intentCluster',
        'conversionEvent',
        'proofUrl',
      ],
    },
    offers,
    conversionEvents: buildConversionEvents(),
    eligibilityFilters: buildEligibilityFilters(),
    operatorQueue: buildOperatorQueue(offers),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: PROOF_LINKS,
  };
}

function renderRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderFeedCsv(offers = []) {
  return renderRows([
    ['id', 'title', 'offerType', 'price', 'currency', 'billingPeriod', 'availability', 'brand', 'description', 'audience', 'intentCluster', 'landingPage', 'imageUrl', 'proofUrl', 'conversionEvent', 'eligibilityFilter', 'claimGuardrail'],
    ...offers.map((offer) => [
      offer.id,
      offer.title,
      offer.offerType,
      offer.price,
      offer.currency,
      offer.billingPeriod,
      offer.availability,
      offer.brand,
      offer.description,
      offer.audience,
      offer.intentCluster,
      offer.landingPage,
      offer.imageUrl,
      offer.proofUrl,
      offer.conversionEvent,
      offer.eligibilityFilter,
      offer.claimGuardrail,
    ]),
  ]);
}

function renderConversionCsv(events = []) {
  return renderRows([
    ['event', 'source', 'successDefinition'],
    ...events.map((event) => [event.event, event.source, event.successDefinition]),
  ]);
}

function renderOperatorQueueCsv(queue = []) {
  return renderRows([
    ['key', 'audience', 'evidence', 'nextAsk', 'blocker'],
    ...queue.map((entry) => [entry.key, entry.audience, entry.evidence, entry.nextAsk, entry.blocker]),
  ]);
}

function renderMarkdown(pack = {}) {
  const lines = [
    '# ChatGPT Product Feed Readiness Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    `Status: ${pack.status}`,
    '',
    pack.headline,
    '',
    pack.shortDescription,
    '',
    '## Source',
    `- Search Engine Land: ${pack.source.searchEngineLandUrl}`,
    `- Digiday: ${pack.source.digidayUrl}`,
    `- OpenAI ads principles/update: ${pack.source.openAiAdsUrl}`,
    `- Advertiser interest: ${pack.source.openAiAdvertisersUrl}`,
    '',
    '## Product Feed Spec',
    `- Current rows: ${pack.productFeedSpec.currentRows}`,
    `- Expansion rule: ${pack.productFeedSpec.expansionRule}`,
    'Required fields:',
    ...pack.productFeedSpec.requiredFields.map((field) => `- ${field}`),
    '',
    '## Offer Rows',
    ...pack.offers.map((offer) => [
      `### ${offer.title}`,
      `- ID: ${offer.id}`,
      `- Type: ${offer.offerType}`,
      `- Price: ${offer.price} ${offer.currency} / ${offer.billingPeriod}`,
      `- Intent: ${offer.intentCluster}`,
      `- Landing: ${offer.landingPage}`,
      `- Conversion: ${offer.conversionEvent}`,
      `- Proof: ${offer.proofUrl}`,
      `- Eligibility: ${offer.eligibilityFilter}`,
      '',
    ].join('\n')),
    '## Eligibility Filters',
    ...pack.eligibilityFilters.map((filter) => `- ${filter}`),
    '',
    '## Measurement',
    `- North star: ${pack.measurementPlan.northStar}`,
    `- Policy: ${pack.measurementPlan.policy}`,
    'Metrics:',
    ...pack.measurementPlan.metrics.map((metric) => `- ${metric}`),
    'Do not count as success:',
    ...pack.measurementPlan.doNotCountAsSuccess.map((item) => `- ${item}`),
    'Guardrails:',
    ...pack.measurementPlan.guardrails.map((item) => `- ${item}`),
    '',
    '## Operator Queue',
    ...pack.operatorQueue.map((entry) => [
      `### ${entry.audience}`,
      `- Evidence: ${entry.evidence}`,
      `- Next ask: ${entry.nextAsk}`,
      `- Blocker: ${entry.blocker}`,
      '',
    ].join('\n')),
    '## Proof Links',
    ...pack.proofLinks.map((link) => `- ${link}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function writeChatgptProductFeedReadinessPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    docsPath: DOCS_PATH,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    markdown: renderMarkdown(pack),
    jsonName: 'chatgpt-product-feed-readiness-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      { name: 'chatgpt-product-feed.csv', value: renderFeedCsv(pack.offers) },
      { name: 'chatgpt-product-feed-conversions.csv', value: renderConversionCsv(pack.conversionEvents) },
      { name: 'chatgpt-product-feed-operator-queue.csv', value: renderOperatorQueueCsv(pack.operatorQueue) },
    ],
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  return parseReportArgs(argv);
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildChatgptProductFeedReadinessPack();
  const written = writeChatgptProductFeedReadinessPack(pack, options);
  if (!options.writeDocs && !options.reportDir) {
    process.stdout.write(renderMarkdown(pack));
  } else {
    process.stdout.write(`Wrote ChatGPT product feed readiness pack${written.docsPath ? ` to ${written.docsPath}` : ''}\n`);
  }
  return written;
}

if (isCliCall(process.argv, __filename)) {
  run();
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  SOURCE,
  buildChatgptProductFeedReadinessPack,
  buildConversionEvents,
  buildEligibilityFilters,
  buildOfferCatalog,
  buildOperatorQueue,
  renderConversionCsv,
  renderFeedCsv,
  renderMarkdown,
  renderOperatorQueueCsv,
  run,
  trackedLink,
  writeChatgptProductFeedReadinessPack,
};
