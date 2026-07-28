#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  MARKETING_AGENT_CAMPAIGN,
  campaignAttributionKeys,
  normalizeCampaignId,
  validateMarketingAgentCampaign,
} = require('../growth-campaigns');

function classifyPublicationStatus(status) {
  if (status >= 200 && status < 400) return 'LIVE';
  if ([401, 403, 405, 429].includes(status)) return 'PARTIAL';
  if ([404, 410].includes(status)) return 'NOT DONE';
  return 'PARTIAL';
}

async function probePublication(entry, fetchImpl = globalThis.fetch) {
  try {
    const headResponse = await fetchImpl(entry.permalink, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'user-agent': 'thumbgate-campaign-monitor/1.0' },
    });
    const response = headResponse.status >= 200 && headResponse.status < 400
      ? headResponse
      : await fetchImpl(entry.permalink, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'text/html',
          range: 'bytes=0-1023',
          'user-agent': 'Mozilla/5.0 (compatible; ThumbGateCampaignMonitor/1.0)',
        },
      });
    return {
      channel: entry.channel,
      status: classifyPublicationStatus(response.status),
      httpStatus: response.status,
      headStatus: headResponse.status,
      method: response === headResponse ? 'HEAD' : 'GET',
      permalink: entry.permalink,
    };
  } catch (error) {
    return {
      channel: entry.channel,
      status: 'PARTIAL',
      httpStatus: null,
      permalink: entry.permalink,
      error: error?.message || String(error),
    };
  }
}

async function probeTrackedBuyerPath(entry, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sourceUrl = new URL(entry.trackedBuyerUrl);
  const probeUrl = new URL(
    sourceUrl.pathname + sourceUrl.search,
    options.appOrigin || sourceUrl.origin
  );

  try {
    const response = await fetchImpl(probeUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'user-agent': 'thumbgate-campaign-monitor/1.0' },
    });
    const location = response.headers.get('location');
    const destination = location ? new URL(location, probeUrl) : null;
    const expectedCampaign = normalizeCampaignId(
      sourceUrl.searchParams.get('utm_campaign')
    );
    const actualCampaign = normalizeCampaignId(
      destination?.searchParams.get('utm_campaign')
    );
    const ok = [302, 303].includes(response.status)
      && destination?.pathname === '/checkout/pro'
      && destination.searchParams.get('utm_source') === entry.channel
      && actualCampaign === expectedCampaign;

    return {
      channel: entry.channel,
      ok,
      httpStatus: response.status,
      trackedBuyerUrl: entry.trackedBuyerUrl,
      location,
      destinationPath: destination?.pathname || null,
      source: destination?.searchParams.get('utm_source') || null,
      campaign: actualCampaign,
      createsProviderSession: false,
    };
  } catch (error) {
    return {
      channel: entry.channel,
      ok: false,
      httpStatus: null,
      trackedBuyerUrl: entry.trackedBuyerUrl,
      location: null,
      error: error?.message || String(error),
      createsProviderSession: false,
    };
  }
}

function sumCampaignCounter(counter = {}, campaign = MARKETING_AGENT_CAMPAIGN) {
  return campaignAttributionKeys(campaign)
    .reduce((total, key) => total + Number(counter[key] || 0), 0);
}

function summarizeCampaignOutcome(summary = {}, campaign = MARKETING_AGENT_CAMPAIGN) {
  const attribution = summary.attribution || {};
  const acquisitionByCampaign = (
    attribution.acquisitionByCampaign
    || summary.signups?.byCampaign
    || {}
  );
  const acquisition = sumCampaignCounter(acquisitionByCampaign, campaign);
  const paidOrders = sumCampaignCounter(
    attribution.paidByCampaign || {},
    campaign
  );
  const bookedRevenueCents = sumCampaignCounter(
    attribution.bookedRevenueByCampaignCents || {},
    campaign
  );
  const bySource = {};

  for (const entry of campaign.channels || []) {
    bySource[entry.channel] = {
      acquisition: Number(
        attribution.acquisitionBySource?.[entry.channel] || 0
      ),
      paidOrders: Number(attribution.paidBySource?.[entry.channel] || 0),
      bookedRevenueCents: Number(
        attribution.bookedRevenueBySourceCents?.[entry.channel] || 0
      ),
    };
  }

  return {
    campaignId: campaign.campaignId,
    acquisition,
    paidOrders,
    bookedRevenueCents,
    conversionRate: acquisition
      ? Number((paidOrders / acquisition).toFixed(4))
      : 0,
    bySource,
  };
}

async function buildMarketingAgentCampaignReport(options = {}) {
  const campaign = options.campaign || MARKETING_AGENT_CAMPAIGN;
  const manifest = validateMarketingAgentCampaign(campaign);
  const buyerPaths = await Promise.all(
    campaign.channels.map((entry) => probeTrackedBuyerPath(entry, options))
  );
  const publications = options.skipPermalinks
    ? []
    : await Promise.all(
      campaign.channels.map((entry) => (
        probePublication(entry, options.fetchImpl || globalThis.fetch)
      ))
    );
  const getOperationalSummary = options.getOperationalSummary
    || require('../operational-summary').getOperationalBillingSummary;
  let outcome = {
    source: 'unverified',
    verifiedHostedLedger: false,
    paymentProviderVerified: false,
    error: null,
    metrics: summarizeCampaignOutcome({}, campaign),
  };

  try {
    const result = await getOperationalSummary({
      window: options.window || '30d',
    });
    outcome = {
      source: result.source,
      verifiedHostedLedger: result.source === 'hosted',
      paymentProviderVerified: false,
      fallbackReason: result.fallbackReason || null,
      metrics: summarizeCampaignOutcome(result.summary || {}, campaign),
    };
  } catch (error) {
    outcome.error = error?.message || String(error);
  }

  const routeProofPassed = manifest.ok
    && buyerPaths.every((entry) => entry.ok);
  const publicationProofPassed = publications.every(
    (entry) => entry.status !== 'NOT DONE'
  );
  const publicationProofFullyLive = publications.every(
    (entry) => entry.status === 'LIVE'
  );
  return {
    generatedAt: new Date().toISOString(),
    campaignId: campaign.campaignId,
    manifest,
    routeProof: {
      passed: routeProofPassed,
      buyerPaths,
      createsProviderSession: false,
    },
    publicationProof: {
      checked: !options.skipPermalinks,
      passed: publicationProofPassed,
      fullyLive: publicationProofFullyLive,
      channels: publications,
    },
    outcomeProof: outcome,
    status: !routeProofPassed || !publicationProofPassed
      ? 'NOT DONE'
      : (
        outcome.verifiedHostedLedger
        && (options.skipPermalinks || publicationProofFullyLive)
          ? 'VERIFIED'
          : 'PARTIAL'
      ),
    claimBoundary: (
      'Route and publication proof do not prove a lead, checkout completion, '
      + 'buyer, or captured payment. Provider verification is separate.'
    ),
  };
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    skipPermalinks: false,
    strictHosted: false,
    outPath: null,
    appOrigin: null,
    window: '30d',
  };

  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--skip-permalinks') options.skipPermalinks = true;
    else if (arg === '--strict-hosted') options.strictHosted = true;
    else if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim() || null;
    } else if (arg.startsWith('--app-origin=')) {
      options.appOrigin = arg.slice('--app-origin='.length).trim() || null;
    } else if (arg.startsWith('--window=')) {
      options.window = arg.slice('--window='.length).trim() || '30d';
    }
  }
  return options;
}

async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildMarketingAgentCampaignReport(options);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outPath) {
    const resolved = path.resolve(options.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output, 'utf8');
  }
  process.stdout.write(options.json
    ? output
    : (
      `Marketing-agent campaign: ${report.status}\n`
      + `Buyer routes: ${report.routeProof.passed ? 'PASS' : 'FAIL'}\n`
      + `Hosted outcome ledger: ${
        report.outcomeProof.verifiedHostedLedger ? 'VERIFIED' : 'UNVERIFIED'
      }\n`
    ));
  if (
    report.status === 'NOT DONE'
    || (options.strictHosted && !report.outcomeProof.verifiedHostedLedger)
  ) {
    process.exitCode = 1;
  }
  return report;
}

module.exports = {
  buildMarketingAgentCampaignReport,
  classifyPublicationStatus,
  parseArgs,
  probePublication,
  probeTrackedBuyerPath,
  runCli,
  sumCampaignCounter,
  summarizeCampaignOutcome,
};

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}
