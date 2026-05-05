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

const PUBLIC_BUYER_ORIGIN = 'https://thumbgate.ai';
const CHANNELS = ['lindy', 'gumroad', 'gohighlevel'];

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function publicRevenueLinks() {
  return buildRevenueLinks({
    appOrigin: PUBLIC_BUYER_ORIGIN,
    guideLink: `${PUBLIC_BUYER_ORIGIN}/guide`,
    proCheckoutLink: `${PUBLIC_BUYER_ORIGIN}/checkout/pro`,
    sprintLink: `${PUBLIC_BUYER_ORIGIN}/#workflow-sprint-intake`,
  });
}

function buildTrackedMarketplaceLink(baseUrl, {
  source,
  medium,
  campaign,
  content,
  variant,
  offerCode,
  ctaId,
  placement,
  planId,
} = {}) {
  const url = new URL(buildUTMLink(baseUrl, {
    source,
    medium,
    campaign,
    content,
  }));
  const extras = {
    campaign_variant: variant,
    offer_code: offerCode,
    cta_id: ctaId,
    cta_placement: placement,
    plan_id: planId,
  };
  for (const [key, value] of Object.entries(extras)) {
    if (normalizeText(value)) {
      url.searchParams.set(key, normalizeText(value));
    }
  }
  return url.toString();
}

function channelTracking(channel, motion) {
  const normalizedChannel = normalizeText(channel).toLowerCase();
  const normalizedMotion = normalizeText(motion).toLowerCase();
  return {
    source: normalizedChannel,
    medium: 'marketplace',
    campaign: `${normalizedChannel}_${normalizedMotion}_listing`,
    content: 'distribution_pack',
    variant: normalizedMotion,
    offerCode: `${normalizedChannel.toUpperCase()}-${normalizedMotion.toUpperCase()}`,
    ctaId: `${normalizedChannel}_${normalizedMotion}_cta`,
    placement: 'listing_copy',
  };
}

function buildMarketplaceDistributionPack(links = publicRevenueLinks()) {
  const proofLinks = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
  const selfServeCta = buildTrackedMarketplaceLink(links.guideLink, channelTracking('gumroad', 'pro'));
  const sprintCta = buildTrackedMarketplaceLink(links.sprintLink, channelTracking('gohighlevel', 'sprint'));
  const lindyCta = buildTrackedMarketplaceLink(links.sprintLink, channelTracking('lindy', 'workflow'));

  return {
    generatedAt: new Date().toISOString(),
    objective: 'Turn platform discovery into tracked Pro and Sprint conversations without claiming publication before it happens.',
    channels: [
      {
        key: 'lindy',
        name: 'Lindy.ai',
        motion: 'Workflow template and webhook integration',
        currentPath: 'Create a Lindy workflow with a webhook trigger that sends repeated-agent-failure events into ThumbGate and routes qualified owners to sprint intake.',
        buyer: 'No-code automation teams already building agents for sales, support, inbox, and CRM workflows.',
        primaryCta: lindyCta,
        offer: 'Workflow Hardening Sprint',
        priceAnchor: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
        sourceEvidence: [
          'https://docs.lindy.ai/fundamentals/lindy-101/create-agent',
          'https://docs.lindy.ai/skills/by-lindy/webhooks',
        ],
        operatorSteps: [
          'Create a Lindy workflow template: Webhook Received -> AI Agent classifies repeated failure -> HTTP step posts into ThumbGate -> Human approval before any customer-facing action.',
          'Use the template as a consultative asset before asking for checkout.',
          'Log each sent workflow owner in sales:pipeline before follow-up.',
        ],
        listingCopy: 'A Lindy workflow can move fast, but agents need memory-backed approval boundaries. ThumbGate turns repeated mistakes into pre-action gates and proof runs before the next automation acts.',
        proofLinks,
      },
      {
        key: 'gumroad',
        name: 'Gumroad',
        motion: 'Digital product checkout',
        currentPath: 'Sell a downloadable Workflow Hardening Kit and route serious buyers to Pro checkout or sprint intake from the product receipt and update emails.',
        buyer: 'Indie builders who want a low-friction digital product before committing to a subscription or sprint.',
        primaryCta: selfServeCta,
        offer: 'ThumbGate Pro self-serve kit',
        priceAnchor: '$19/mo or $149/yr Pro follow-on; Gumroad product can be a paid kit or free lead magnet.',
        sourceEvidence: [
          'https://gumroad.com/features',
          'https://gumroad.com/pricing',
        ],
        operatorSteps: [
          'Create a Gumroad product named ThumbGate Workflow Hardening Kit.',
          'Upload the setup guide, checklist, and proof links as the digital deliverable.',
          'Add receipt CTA links to /guide, /checkout/pro, and #workflow-sprint-intake with Gumroad UTMs.',
        ],
        listingCopy: 'A practical kit for developers who want one repeated AI-agent mistake to become an enforceable pre-action gate, with a proof checklist and upgrade path to ThumbGate Pro.',
        proofLinks,
      },
      {
        key: 'gohighlevel',
        name: 'GoHighLevel',
        motion: 'Marketplace app or agency snapshot',
        currentPath: 'Start as a private Marketplace app or snapshot for agency operators, then submit publicly after OAuth, listing, security, and support materials are stable.',
        buyer: 'Agencies managing client automations that need audit trails, approval gates, and safer agent-driven follow-up workflows.',
        primaryCta: sprintCta,
        offer: 'Workflow Hardening Sprint for agency automation',
        priceAnchor: 'Sprint-led service motion; Team at $49/seat/mo after qualification.',
        sourceEvidence: [
          'https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/',
          'https://help.gohighlevel.com/support/solutions/articles/155000000136-how-to-get-started-with-the-developer-s-marketplace',
        ],
        operatorSteps: [
          'Create a private Marketplace app first and test OAuth scopes with a sub-account workflow.',
          'Package the initial value as an agency-safe workflow hardening snapshot before broad public submission.',
          'Submit publicly only after support docs, install video, and tracking evidence are ready.',
        ],
        listingCopy: 'ThumbGate gives agency automations a Reliability Gateway: repeated failures become shared pre-action gates, every risky automation gets evidence, and client-facing workflows keep an audit trail.',
        proofLinks,
      },
    ],
    guardrails: [
      'Do not claim Lindy, Gumroad, or GoHighLevel publication without direct dashboard or marketplace evidence.',
      'Do not claim revenue from these channels without reconciled payment or sales pipeline evidence.',
      'Use public buyer URLs on thumbgate.ai for every prospect-facing CTA.',
    ],
  };
}

function renderMarketplaceDistributionMarkdown(pack) {
  const lines = [
    '# Money Marketplace Distribution Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    pack.objective,
    '',
    'This is an operator asset. It is not proof of sent outreach, marketplace publication, dashboard setup, or revenue.',
    '',
    '## Channels',
    '',
  ];

  for (const channel of pack.channels) {
    lines.push(
      `### ${channel.name}`,
      `- Motion: ${channel.motion}`,
      `- Buyer: ${channel.buyer}`,
      `- Offer: ${channel.offer}`,
      `- Price anchor: ${channel.priceAnchor}`,
      `- Primary CTA: ${channel.primaryCta}`,
      `- Current path: ${channel.currentPath}`,
      `- Source evidence: ${channel.sourceEvidence.join(' | ')}`,
      `- Proof links: ${channel.proofLinks.join(' | ')}`,
      '',
      'Listing copy:',
      `> ${channel.listingCopy}`,
      '',
      'Operator steps:',
      ...channel.operatorSteps.map((step) => `- ${step}`),
      '',
    );
  }

  lines.push(
    '## Guardrails',
    '',
    ...pack.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
  );

  return `${lines.join('\n')}\n`;
}

function renderMarketplaceDistributionCsv(pack) {
  const headers = [
    'key',
    'name',
    'motion',
    'buyer',
    'offer',
    'priceAnchor',
    'primaryCta',
    'currentPath',
    'sourceEvidence',
  ];
  const rows = pack.channels.map((channel) => [
    channel.key,
    channel.name,
    channel.motion,
    channel.buyer,
    channel.offer,
    channel.priceAnchor,
    channel.primaryCta,
    channel.currentPath,
    channel.sourceEvidence.join(' | '),
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
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

function writeMarketplaceDistributionPack(pack, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderMarketplaceDistributionMarkdown(pack);
  const csv = renderMarketplaceDistributionCsv(pack);
  const json = `${JSON.stringify(pack, null, 2)}\n`;
  const written = {
    docsPath: null,
    reportDir: null,
  };

  if (options.reportDir) {
    const reportDir = path.resolve(options.reportDir);
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'money-marketplace-distribution-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'money-marketplace-distribution-pack.json'), json, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'money-marketplace-distribution-pack.csv'), csv, 'utf8');
    written.reportDir = reportDir;
  }

  if (options.writeDocs) {
    const docsDir = path.join(repoRoot, 'docs', 'marketing');
    ensureDir(docsDir);
    fs.writeFileSync(path.join(docsDir, 'money-marketplace-distribution-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'money-marketplace-distribution-pack.json'), json, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'money-marketplace-distribution-pack.csv'), csv, 'utf8');
    written.docsPath = path.join(docsDir, 'money-marketplace-distribution-pack.md');
  }

  return written;
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pack = buildMarketplaceDistributionPack();
  const written = writeMarketplaceDistributionPack(pack, options);
  console.log('Money marketplace distribution pack ready.');
  if (written.docsPath) console.log(`Docs: ${written.docsPath}`);
  if (written.reportDir) console.log(`Report dir: ${written.reportDir}`);
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  CHANNELS,
  buildMarketplaceDistributionPack,
  buildTrackedMarketplaceLink,
  channelTracking,
  isCliInvocation,
  parseArgs,
  publicRevenueLinks,
  renderMarketplaceDistributionCsv,
  renderMarketplaceDistributionMarkdown,
  writeMarketplaceDistributionPack,
};
