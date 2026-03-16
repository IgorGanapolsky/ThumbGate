const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveHostedBillingConfig } = require('../scripts/hosted-config');

const PROJECT_ROOT = path.join(__dirname, '..');
const CANONICAL_APP_ORIGIN = 'https://rlhf-feedback-loop-production.up.railway.app';
const CURRENT_REPOSITORY_URL = 'https://github.com/IgorGanapolsky/mcp-memory-gateway';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

test('package version matches MCP manifests', () => {
  const packageJson = readJson('package.json');
  const serverManifest = readJson('server.json');

  assert.equal(serverManifest.version, packageJson.version);
});

test('public docs render the current package version', () => {
  const packageJson = readJson('package.json');
  const landingPage = readText('docs/landing-page.html');
  const mcpSubmission = readText('docs/mcp-hub-submission.md');

  assert.match(landingPage, /MCP Memory Gateway/);
  assert.match(landingPage, /Pre-Action Gates/i);
  assert.match(landingPage, /\$29\/mo/);
  assert.match(mcpSubmission, new RegExp(`## Version\\s+${packageJson.version}`));
});

test('landing page keeps GTM and schema assets wired', () => {
  const landingPage = readText('docs/landing-page.html');
  const gtmPlan = readText('docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md');

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /<section id='faq'>/);
  assert.match(landingPage, /__GTM_PLAN_URL__/);
  assert.match(landingPage, /__COMPATIBILITY_REPORT_URL__/);
  assert.match(landingPage, /__AUTOMATION_REPORT_URL__/);
  assert.match(gtmPlan, /"Outcome-Based" Memory Packages/);
  assert.match(gtmPlan, /\*\*\"Success-Based Memory Credits\.\"\*\*/);
  assert.match(gtmPlan, /"Mistake-Free" Credits/i);
});

test('hosted origin and repository metadata stay canonical across live-facing artifacts', () => {
  const packageJson = readJson('package.json');
  const serverManifest = readJson('server.json');
  const publicLanding = readText('public/index.html');
  const serverSource = readText('src/api/server.js');
  const twitterThread = readText('docs/marketing/twitter-thread.md');

  assert.equal(packageJson.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(serverManifest.websiteUrl, CANONICAL_APP_ORIGIN);

  assert.match(publicLanding, new RegExp(CURRENT_REPOSITORY_URL.replaceAll('.', '\\.')));
  assert.match(publicLanding, /mcp-memory-gateway/i);
  assert.match(publicLanding, /__PRO_PRICE_LABEL__/);
  assert.match(publicLanding, /__PRO_PRICE_DOLLARS__/);
  assert.match(publicLanding, /Pre-Action Gates/i);
  assert.doesNotMatch(publicLanding, /mcp-gateway\.vercel\.app/);
  assert.doesNotMatch(publicLanding, /github\.com\/IgorGanapolsky\/rlhf-feedback-loop/);

  assert.match(serverSource, new RegExp(CURRENT_REPOSITORY_URL.replaceAll('.', '\\.')));
  assert.doesNotMatch(serverSource, /github\.com\/IgorGanapolsky\/rlhf-feedback-loop/);

  assert.match(twitterThread, /Hosted demo: rlhf-feedback-loop-production\.up\.railway\.app/);
  assert.match(twitterThread, /engineering validation, not customer proof/i);
  assert.doesNotMatch(twitterThread, /us-central1\.run\.app/);
});

test('runtime hosted billing config defaults to the live pro price label', () => {
  const previousLabel = process.env.RLHF_PRO_PRICE_LABEL;
  const previousDollars = process.env.RLHF_PRO_PRICE_DOLLARS;
  delete process.env.RLHF_PRO_PRICE_LABEL;
  delete process.env.RLHF_PRO_PRICE_DOLLARS;

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(runtimeConfig.proPriceLabel, '$29/mo');
    assert.equal(runtimeConfig.proPriceDollars, 29);
    assert.equal(runtimeConfig.checkoutFallbackUrl, CANONICAL_APP_ORIGIN);
  } finally {
    if (previousLabel === undefined) {
      delete process.env.RLHF_PRO_PRICE_LABEL;
    } else {
      process.env.RLHF_PRO_PRICE_LABEL = previousLabel;
    }
    if (previousDollars === undefined) {
      delete process.env.RLHF_PRO_PRICE_DOLLARS;
    } else {
      process.env.RLHF_PRO_PRICE_DOLLARS = previousDollars;
    }
  }
});

test('active GTM scripts and reports point to the canonical offer without founding-language drift', () => {
  const outreachTargets = readText('docs/OUTREACH_TARGETS.md');
  const xAutomationReport = readText('docs/X_AUTOMATION_REPORT.md');
  const githubOutreach = readText('scripts/github-outreach.js');
  const xAutomation = readText('scripts/x-autonomous-marketing.js');
  const autonomousSales = readText('scripts/autonomous-sales-agent.js');

  for (const artifact of [outreachTargets, xAutomationReport, githubOutreach, xAutomation, autonomousSales]) {
    assert.doesNotMatch(artifact, /buy\.stripe\.com/);
    assert.doesNotMatch(artifact, /founding users today/i);
    assert.match(artifact, /rlhf-feedback-loop-production\.up\.railway\.app/);
  }
});

test('commercial truth sources stay aligned across public and historical docs', () => {
  const commercialTruth = readText('docs/COMMERCIAL_TRUTH.md');
  const readme = readText('README.md');
  const proReadme = readText('pro/README.md');
  const pricingResearch = readText('docs/PRICING_RESEARCH_2026-03-09.md');
  const crisisReport = readText('docs/PRICING_RESEARCH_2026-03-10.md');
  const packagingPlan = readText('docs/PACKAGING_AND_SALES_PLAN.md');
  const revenueSprint = readText('docs/REVENUE_SPRINT_MAR2026.md');
  const anthropicStrategy = readText('docs/ANTHROPIC_MARKETPLACE_STRATEGY.md');
  const xStrategy = readText('docs/X_AUTOMATION_STRATEGY.md');
  const directoryGuide = readText('docs/marketing/mcp-directories.md');

  assert.match(commercialTruth, /Pro at \$29\/mo recurring/);
  assert.match(commercialTruth, /auto-gate promotion/);
  assert.match(commercialTruth, /Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof/);

  assert.match(readme, /Commercial Truth/);
  assert.match(proReadme, /Commercial Truth/);
  assert.doesNotMatch(readme, /500\+ agentic sessions|battle-tested/i);
  assert.doesNotMatch(proReadme, /500\+ agentic sessions|battle-tested/i);

  for (const historicalDoc of [pricingResearch, crisisReport, packagingPlan, revenueSprint, anthropicStrategy, xStrategy]) {
    assert.match(historicalDoc, /Historical .*note|Historical .*archived|Historical .*hypothesis/i);
    assert.match(historicalDoc, /COMMERCIAL_TRUTH\.md/);
  }

  assert.doesNotMatch(directoryGuide, /30k\+ stars|18k\+ servers listed/i);
});
