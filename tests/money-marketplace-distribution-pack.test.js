const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
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
} = require('../scripts/money-marketplace-distribution-pack');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-money-marketplaces-'));
}

test('money marketplace pack covers Lindy, Gumroad, GoHighLevel, and AgentMart', () => {
  const pack = buildMarketplaceDistributionPack();

  assert.deepEqual(pack.channels.map((channel) => channel.key), CHANNELS);
  assert.equal(pack.channels.length, 4);
  assert.ok(pack.channels.every((channel) => channel.primaryCta.startsWith('https://thumbgate.ai/')));
  assert.ok(pack.channels.every((channel) => channel.proofLinks.some((link) => /VERIFICATION_EVIDENCE\.md/.test(link))));
});

test('distribution pack maps each platform to the right motion', () => {
  const pack = buildMarketplaceDistributionPack();
  const byKey = Object.fromEntries(pack.channels.map((channel) => [channel.key, channel]));

  assert.match(byKey.lindy.currentPath, /webhook trigger/i);
  assert.match(byKey.lindy.motion, /Workflow template/);
  assert.match(byKey.gumroad.motion, /Digital product checkout/);
  assert.match(byKey.gumroad.priceAnchor, /\$19\/mo/);
  assert.match(byKey.gohighlevel.currentPath, /private Marketplace app/i);
  assert.match(byKey.gohighlevel.offer, /Workflow Hardening Sprint/);
  assert.match(byKey.agentmart.motion, /Agent-buyable reliability pack/);
  assert.match(byKey.agentmart.priceAnchor, /\$2\.99 to \$4\.99/);
  assert.ok(byKey.agentmart.productIdeas.some((idea) => idea.name === 'ThumbGate Agent Reliability Pack'));
});

test('platform source evidence is current and source-backed', () => {
  const pack = buildMarketplaceDistributionPack();
  const allSources = pack.channels.flatMap((channel) => channel.sourceEvidence);

  assert.ok(allSources.some((source) => source.includes('docs.lindy.ai/fundamentals/lindy-101/create-agent')));
  assert.ok(allSources.some((source) => source.includes('docs.lindy.ai/skills/by-lindy/webhooks')));
  assert.ok(allSources.some((source) => source.includes('gumroad.com/features')));
  assert.ok(allSources.some((source) => source.includes('gumroad.com/pricing')));
  assert.ok(allSources.some((source) => source.includes('marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp')));
  assert.ok(allSources.some((source) => source.includes('agentmart.store/skill.md')));
  assert.ok(allSources.some((source) => source.includes('reddit.com/r/nocode')));
  assert.ok(allSources.some((source) => source.includes('offers.hubspot.com/thank-you/ai-side-hustle-accelerator')));
  assert.ok(allSources.some((source) => source.includes('skool.com/brendan')));
});

test('tracked marketplace links preserve attribution metadata', () => {
  const tracking = channelTracking('gumroad', 'pro');
  const tracked = new URL(buildTrackedMarketplaceLink('https://thumbgate.ai/guide', {
    ...tracking,
    planId: 'pro',
  }));

  assert.equal(tracked.searchParams.get('utm_source'), 'gumroad');
  assert.equal(tracked.searchParams.get('utm_medium'), 'marketplace');
  assert.equal(tracked.searchParams.get('utm_campaign'), 'gumroad_pro_listing');
  assert.equal(tracked.searchParams.get('offer_code'), 'GUMROAD-PRO');
  assert.equal(tracked.searchParams.get('plan_id'), 'pro');
});

test('AgentMart listing uses low-price instant-download products with safe setup steps', () => {
  const pack = buildMarketplaceDistributionPack();
  const agentmart = pack.channels.find((channel) => channel.key === 'agentmart');
  const tracked = new URL(agentmart.primaryCta);

  assert.equal(tracked.searchParams.get('utm_source'), 'agentmart');
  assert.equal(tracked.searchParams.get('utm_medium'), 'marketplace');
  assert.equal(tracked.searchParams.get('utm_campaign'), 'agentmart_agent_pack_listing');
  assert.equal(tracked.searchParams.get('plan_id'), 'pro');
  assert.ok(agentmart.productIdeas.every((idea) => idea.format === 'download'));
  assert.ok(agentmart.productIdeas.some((idea) => idea.price === '$0'));
  assert.ok(agentmart.operatorSteps.some((step) => /API key outside git/i.test(step)));
});

test('public revenue links route buyers through thumbgate.ai', () => {
  const links = publicRevenueLinks();

  assert.equal(links.appOrigin, 'https://thumbgate.ai');
  assert.equal(links.guideLink, 'https://thumbgate.ai/guide');
  assert.equal(links.proCheckoutLink, 'https://thumbgate.ai/checkout/pro');
  assert.equal(links.sprintLink, 'https://thumbgate.ai/#workflow-sprint-intake');
});

test('rendered markdown and CSV are operator-ready without fake traction claims', () => {
  const pack = {
    ...buildMarketplaceDistributionPack(),
    generatedAt: '2026-05-05T00:00:00.000Z',
  };
  const markdown = renderMarketplaceDistributionMarkdown(pack);
  const csv = renderMarketplaceDistributionCsv(pack);

  assert.match(markdown, /Money Marketplace Distribution Pack/);
  assert.match(markdown, /Lindy\.ai/);
  assert.match(markdown, /Gumroad/);
  assert.match(markdown, /GoHighLevel/);
  assert.match(markdown, /AgentMart/);
  assert.match(markdown, /Product ideas:/);
  assert.match(markdown, /not proof of sent outreach/);
  assert.doesNotMatch(markdown, /published on|approved by|guaranteed revenue/i);
  assert.match(csv, /^key,name,motion,buyer,offer,/);
  assert.match(csv, /gohighlevel/);
  assert.match(csv, /agentmart/);
});

test('writeMarketplaceDistributionPack writes report and docs outputs', () => {
  const reportDir = makeTempDir();
  const docsWrites = [];
  const originalWriteFileSync = fs.writeFileSync;
  const docsRoot = path.join(__dirname, '..', 'docs', 'marketing');

  fs.writeFileSync = (filePath, ...args) => {
    docsWrites.push(String(filePath));
    if (String(filePath).startsWith(`${docsRoot}${path.sep}`)) {
      return;
    }
    return originalWriteFileSync.call(fs, filePath, ...args);
  };

  try {
    const written = writeMarketplaceDistributionPack(buildMarketplaceDistributionPack(), {
      reportDir,
      writeDocs: true,
    });

    assert.equal(fs.existsSync(path.join(reportDir, 'money-marketplace-distribution-pack.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'money-marketplace-distribution-pack.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'money-marketplace-distribution-pack.csv')), true);
    assert.match(written.docsPath, /docs\/marketing\/money-marketplace-distribution-pack\.md$/);
    assert.ok(docsWrites.some((entry) => entry.endsWith('docs/marketing/money-marketplace-distribution-pack.md')));
    assert.ok(docsWrites.some((entry) => entry.endsWith('docs/marketing/money-marketplace-distribution-pack.json')));
    assert.ok(docsWrites.some((entry) => entry.endsWith('docs/marketing/money-marketplace-distribution-pack.csv')));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

test('CLI args and entrypoint detection stay importer-safe', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'money-marketplace-distribution-pack.js');
  const options = parseArgs(['--write-docs', '--report-dir=/tmp/example']);

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, '/tmp/example');
  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
