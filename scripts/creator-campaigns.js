'use strict';

const { resolveHostedBillingConfig } = require('./hosted-config');

const DEFAULT_TEAM_SEAT_COUNT = 3;
const DEFAULT_TOP_CREATORS = 5;
const CREATOR_CHANNELS = [
  'youtube',
  'x',
  'linkedin',
  'instagram',
  'threads',
  'tiktok',
];
const CREATOR_CONTENT_SHAPES = [
  'review',
  'workflow_teardown',
  'before_after_demo',
];

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeCreatorHandle(value) {
  return normalizeText(value)
    .replace(/^@+/, '')
    .toLowerCase();
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCreatorOfferCode(handle, motion = 'pro') {
  const creatorCode = slugify(handle).toUpperCase() || 'CREATOR';
  const motionCode = slugify(motion).toUpperCase() || 'PRO';
  return `${creatorCode}-${motionCode}`;
}

function applyAttributionParams(url, attribution = {}) {
  const params = {
    utm_source: attribution.source,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_content: attribution.utmContent,
    creator: attribution.creator,
    community: attribution.community,
    post_id: attribution.postId,
    comment_id: attribution.commentId,
    campaign_variant: attribution.campaignVariant,
    offer_code: attribution.offerCode,
  };

  for (const [key, value] of Object.entries(params)) {
    const normalized = normalizeText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }
  return url;
}

function buildCreatorCampaignLinks(options = {}, runtimeConfig = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
})) {
  const creator = normalizeCreatorHandle(options.creator || options.handle);
  if (!creator) {
    throw new Error('buildCreatorCampaignLinks requires creator');
  }

  const source = slugify(options.source || options.platform || 'youtube');
  if (!source) {
    throw new Error('buildCreatorCampaignLinks requires source');
  }

  const campaign = slugify(options.campaign || `creator-${creator}-launch`);
  const contentShape = slugify(options.contentShape || options.variant || 'review');
  const community = normalizeText(options.community);
  const postId = normalizeText(options.postId);
  const commentId = normalizeText(options.commentId);
  const offerCode = normalizeText(options.offerCode) || buildCreatorOfferCode(creator, options.motion || 'pro');
  const teamSeatCount = Math.max(Number.parseInt(String(options.seatCount || DEFAULT_TEAM_SEAT_COUNT), 10) || DEFAULT_TEAM_SEAT_COUNT, DEFAULT_TEAM_SEAT_COUNT);

  const attribution = {
    creator,
    source,
    utmMedium: normalizeText(options.utmMedium) || 'creator_partnership',
    utmCampaign: campaign,
    utmContent: contentShape,
    community,
    postId,
    commentId,
    campaignVariant: contentShape,
    offerCode,
  };

  const landingUrl = applyAttributionParams(new URL('/', runtimeConfig.appOrigin), attribution).toString();

  const proCheckoutUrl = applyAttributionParams(new URL('/checkout/pro', runtimeConfig.appOrigin), attribution);
  proCheckoutUrl.searchParams.set('cta_id', 'pricing_pro');
  proCheckoutUrl.searchParams.set('cta_placement', 'creator_partnership');
  proCheckoutUrl.searchParams.set('plan_id', 'pro');

  const teamCheckoutUrl = applyAttributionParams(new URL('/checkout/pro', runtimeConfig.appOrigin), attribution);
  teamCheckoutUrl.searchParams.set('cta_id', 'pricing_team');
  teamCheckoutUrl.searchParams.set('cta_placement', 'creator_partnership');
  teamCheckoutUrl.searchParams.set('plan_id', 'team');
  teamCheckoutUrl.searchParams.set('billing_cycle', 'monthly');
  teamCheckoutUrl.searchParams.set('seat_count', String(teamSeatCount));

  const sprintUrl = applyAttributionParams(new URL('/', runtimeConfig.appOrigin), attribution);
  sprintUrl.hash = 'workflow-sprint-intake';

  return {
    creator,
    attribution,
    links: {
      landingUrl,
      proCheckoutUrl: proCheckoutUrl.toString(),
      teamCheckoutUrl: teamCheckoutUrl.toString(),
      sprintUrl: sprintUrl.toString(),
    },
  };
}

function getCounterValue(counter = {}, key) {
  return Number(counter && counter[key]) || 0;
}

function summarizeCreatorPerformance(telemetry = null, billingSummary = null, options = {}) {
  const topN = Math.max(Number.parseInt(String(options.topN || DEFAULT_TOP_CREATORS), 10) || DEFAULT_TOP_CREATORS, 1);
  const creators = new Set();
  const addKeys = (counter) => {
    for (const key of Object.keys(counter || {})) {
      const normalized = normalizeText(key);
      if (normalized && normalized !== 'unknown') creators.add(normalized);
    }
  };

  addKeys(telemetry && telemetry.visitors && telemetry.visitors.byCreator);
  addKeys(telemetry && telemetry.ctas && telemetry.ctas.byCreator);
  addKeys(telemetry && telemetry.ctas && telemetry.ctas.checkoutStartsByCreator);
  addKeys(billingSummary && billingSummary.attribution && billingSummary.attribution.acquisitionByCreator);
  addKeys(billingSummary && billingSummary.attribution && billingSummary.attribution.paidByCreator);
  addKeys(billingSummary && billingSummary.attribution && billingSummary.attribution.bookedRevenueByCreatorCents);
  addKeys(billingSummary && billingSummary.pipeline && billingSummary.pipeline.workflowSprintLeads && billingSummary.pipeline.workflowSprintLeads.byCreator);
  addKeys(billingSummary && billingSummary.pipeline && billingSummary.pipeline.qualifiedWorkflowSprintLeads && billingSummary.pipeline.qualifiedWorkflowSprintLeads.byCreator);

  return Array.from(creators)
    .map((creator) => {
      const visitors = getCounterValue(telemetry && telemetry.visitors && telemetry.visitors.byCreator, creator);
      const ctaClicks = getCounterValue(telemetry && telemetry.ctas && telemetry.ctas.byCreator, creator);
      const checkoutStarts = getCounterValue(telemetry && telemetry.ctas && telemetry.ctas.checkoutStartsByCreator, creator);
      const acquisitions = getCounterValue(billingSummary && billingSummary.attribution && billingSummary.attribution.acquisitionByCreator, creator);
      const paidOrders = getCounterValue(billingSummary && billingSummary.attribution && billingSummary.attribution.paidByCreator, creator);
      const bookedRevenueCents = getCounterValue(billingSummary && billingSummary.attribution && billingSummary.attribution.bookedRevenueByCreatorCents, creator);
      const sprintLeads = getCounterValue(
        billingSummary && billingSummary.pipeline && billingSummary.pipeline.workflowSprintLeads && billingSummary.pipeline.workflowSprintLeads.byCreator,
        creator
      );
      const qualifiedSprintLeads = getCounterValue(
        billingSummary && billingSummary.pipeline && billingSummary.pipeline.qualifiedWorkflowSprintLeads && billingSummary.pipeline.qualifiedWorkflowSprintLeads.byCreator,
        creator
      );
      return {
        creator,
        visitors,
        ctaClicks,
        checkoutStarts,
        acquisitions,
        paidOrders,
        bookedRevenueCents,
        sprintLeads,
        qualifiedSprintLeads,
      };
    })
    .sort((left, right) => (
      right.bookedRevenueCents - left.bookedRevenueCents ||
      right.paidOrders - left.paidOrders ||
      right.qualifiedSprintLeads - left.qualifiedSprintLeads ||
      right.checkoutStarts - left.checkoutStarts ||
      right.visitors - left.visitors ||
      left.creator.localeCompare(right.creator)
    ))
    .slice(0, topN);
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function runCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log || console.log;
  const error = io.error || console.error;
  const exit = io.exit || process.exit;
  try {
    const options = parseArgs(argv);
    const result = buildCreatorCampaignLinks(options);
    log(JSON.stringify(result, null, 2));
  } catch (err) {
    error(err.message);
    exit(1);
  }
}

module.exports = {
  CREATOR_CHANNELS,
  CREATOR_CONTENT_SHAPES,
  buildCreatorCampaignLinks,
  buildCreatorOfferCode,
  normalizeCreatorHandle,
  summarizeCreatorPerformance,
};

if (require.main === module) {
  runCli();
}
