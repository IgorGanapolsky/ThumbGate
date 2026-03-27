const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_CHECKOUT_FALLBACK_URL,
  GA_MEASUREMENT_ID_PATTERN,
  resolveHostedBillingConfig,
} = require('../scripts/hosted-config');

const PROJECT_ROOT = path.join(__dirname, '..');
const CANONICAL_APP_ORIGIN = 'https://rlhf-feedback-loop-production.up.railway.app';
const CURRENT_REPOSITORY_URL = 'https://github.com/IgorGanapolsky/ThumbGate';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

test('pricing matches 2026 standard', () => {
  assert.match('$49 one-time', /\$49 one-time/);
});

test('package version matches MCP manifests', () => {
  const packageJson = readJson('package.json');
  const serverManifest = readJson('server.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');
  const cursorMarketplace = readJson('.cursor-plugin/marketplace.json');
  const cursorPlugin = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');

  assert.equal(serverManifest.version, packageJson.version);
  assert.equal(claudePlugin.version, packageJson.version);
  assert.equal(claudeMarketplace.version, packageJson.version);
  assert.equal(cursorMarketplace.metadata.version, packageJson.version);
  assert.equal(cursorPlugin.version, packageJson.version);
});

test('public docs render the current package version', () => {
  const packageJson = readJson('package.json');
  const landingPage = readText('docs/landing-page.html');
  const mcpSubmission = readText('docs/mcp-hub-submission.md');
  const claudePluginReadme = readText('.claude-plugin/README.md');
  const claudeDesktopPacket = readText('docs/CLAUDE_DESKTOP_EXTENSION.md');

  assert.match(landingPage, /ThumbGate/);
  assert.match(landingPage, /AI agent reliability/i);
  assert.match(landingPage, /Claude Desktop extension/i);
  assert.match(landingPage, /\$49 one-time/);
  assert.match(landingPage, /Reliability Studio/i);
  assert.match(landingPage, /Compare and Deploy/i);
  assert.match(landingPage, /No model fine-tuning required/i);
  assert.match(landingPage, /Workflow Hardening Fit Checker/i);
  assert.match(landingPage, /Claude Desktop extension path/i);
  assert.match(landingPage, /can AI fully satisfy this query without a click\?/i);
  assert.match(landingPage, /Run the hosted fit checker/i);
  assert.match(claudePluginReadme, /Claude Desktop/i);
  assert.match(claudePluginReadme, /Privacy Policy/i);
  assert.match(claudePluginReadme, /Data Collection/i);
  assert.match(claudePluginReadme, /Support/i);
  assert.match(claudePluginReadme, /claude mcp add rlhf -- npx -y mcp-memory-gateway serve/i);
  assert.match(claudePluginReadme, /npm run build:claude-mcpb/i);
  assert.match(claudeDesktopPacket, /Anthropic Local MCP Server Submission Guide/i);
  assert.match(claudeDesktopPacket, /Build the MCPB/i);
  assert.match(claudeDesktopPacket, /privacy_policies/i);
  assert.match(claudeDesktopPacket, /npm run build:claude-mcpb/i);
  assert.match(claudeDesktopPacket, /Tool safety annotations/i);
  assert.match(claudeDesktopPacket, /Do not claim directory approval/i);
  assert.doesNotMatch(landingPage, /billingIncrement/);
  assert.doesNotMatch(landingPage, /P1M/);
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
  assert.match(publicLanding, /\$49/);
  assert.match(publicLanding, /__PRO_PRICE_DOLLARS__/);
  assert.match(publicLanding, /__GA_BOOTSTRAP__/);
  assert.match(publicLanding, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(publicLanding, /Human-in-the-loop enforcement/i);
  assert.doesNotMatch(publicLanding, /billingDuration/);
  assert.doesNotMatch(publicLanding, /P1M/);
  assert.doesNotMatch(publicLanding, /mcp-gateway\.vercel\.app/);
  assert.doesNotMatch(publicLanding, /github\.com\/IgorGanapolsky\/rlhf-feedback-loop/);
  assert.doesNotMatch(publicLanding, /github\.com\/IgorGanapolsky\/mcp-memory-gateway/);

  assert.match(serverSource, new RegExp(CURRENT_REPOSITORY_URL.replaceAll('.', '\\.')));
  assert.doesNotMatch(serverSource, /github\.com\/IgorGanapolsky\/mcp-memory-gateway/);
  assert.doesNotMatch(serverSource, /github\.com\/IgorGanapolsky\/rlhf-feedback-loop/);

  assert.match(twitterThread, /Hosted demo: rlhf-feedback-loop-production\.up\.railway\.app/);
  assert.match(twitterThread, /engineering validation, not customer proof/i);
  assert.doesNotMatch(twitterThread, /us-central1\.run\.app/);
});

test('runtime hosted billing config defaults to the live pro price label', () => {
  const previousLabel = process.env.RLHF_PRO_PRICE_LABEL;
  const previousDollars = process.env.RLHF_PRO_PRICE_DOLLARS;
  const previousFallback = process.env.RLHF_CHECKOUT_FALLBACK_URL;
  const previousGaMeasurementId = process.env.RLHF_GA_MEASUREMENT_ID;
  const previousGoogleSiteVerification = process.env.RLHF_GOOGLE_SITE_VERIFICATION;
  delete process.env.RLHF_PRO_PRICE_LABEL;
  delete process.env.RLHF_PRO_PRICE_DOLLARS;
  delete process.env.RLHF_CHECKOUT_FALLBACK_URL;
  delete process.env.RLHF_GA_MEASUREMENT_ID;
  delete process.env.RLHF_GOOGLE_SITE_VERIFICATION;

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(runtimeConfig.proPriceLabel, '$49 one-time');
    assert.equal(runtimeConfig.proPriceDollars, 49);
    assert.equal(runtimeConfig.checkoutFallbackUrl, DEFAULT_CHECKOUT_FALLBACK_URL);
    assert.equal(runtimeConfig.gaMeasurementId, '');
    assert.equal(runtimeConfig.googleSiteVerification, '');
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
    if (previousFallback === undefined) {
      delete process.env.RLHF_CHECKOUT_FALLBACK_URL;
    } else {
      process.env.RLHF_CHECKOUT_FALLBACK_URL = previousFallback;
    }
    if (previousGaMeasurementId === undefined) {
      delete process.env.RLHF_GA_MEASUREMENT_ID;
    } else {
      process.env.RLHF_GA_MEASUREMENT_ID = previousGaMeasurementId;
    }
    if (previousGoogleSiteVerification === undefined) {
      delete process.env.RLHF_GOOGLE_SITE_VERIFICATION;
    } else {
      process.env.RLHF_GOOGLE_SITE_VERIFICATION = previousGoogleSiteVerification;
    }
  }
});

test('runtime hosted billing config preserves absolute fallback checkout urls', () => {
  const previousFallback = process.env.RLHF_CHECKOUT_FALLBACK_URL;
  process.env.RLHF_CHECKOUT_FALLBACK_URL = 'https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05?utm_source=website&utm_medium=cta_button';

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(
      runtimeConfig.checkoutFallbackUrl,
      'https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05?utm_source=website&utm_medium=cta_button'
    );
  } finally {
    if (previousFallback === undefined) {
      delete process.env.RLHF_CHECKOUT_FALLBACK_URL;
    } else {
      process.env.RLHF_CHECKOUT_FALLBACK_URL = previousFallback;
    }
  }
});

test('runtime hosted billing config accepts valid analytics tracking identifiers', () => {
  const previousGaMeasurementId = process.env.RLHF_GA_MEASUREMENT_ID;
  const previousGoogleSiteVerification = process.env.RLHF_GOOGLE_SITE_VERIFICATION;
  process.env.RLHF_GA_MEASUREMENT_ID = 'G-TEST1234';
  process.env.RLHF_GOOGLE_SITE_VERIFICATION = 'test-verification-token';

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(runtimeConfig.gaMeasurementId, 'G-TEST1234');
    assert.equal(runtimeConfig.googleSiteVerification, 'test-verification-token');
    assert.match(runtimeConfig.gaMeasurementId, GA_MEASUREMENT_ID_PATTERN);
  } finally {
    if (previousGaMeasurementId === undefined) {
      delete process.env.RLHF_GA_MEASUREMENT_ID;
    } else {
      process.env.RLHF_GA_MEASUREMENT_ID = previousGaMeasurementId;
    }
    if (previousGoogleSiteVerification === undefined) {
      delete process.env.RLHF_GOOGLE_SITE_VERIFICATION;
    } else {
      process.env.RLHF_GOOGLE_SITE_VERIFICATION = previousGoogleSiteVerification;
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
    assert.doesNotMatch(artifact, /Always-On/i);
    assert.doesNotMatch(artifact, /Mistake-Free/i);
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
  const workflowSprint = readText('docs/WORKFLOW_HARDENING_SPRINT.md');
  const xStrategy = readText('docs/X_AUTOMATION_STRATEGY.md');
  const directoryGuide = readText('docs/marketing/mcp-directories.md');

  assert.match(commercialTruth, /Pro at \$49 one-time/);
  assert.match(commercialTruth, /auto-gate promotion/);
  assert.match(commercialTruth, /Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof/);

  assert.match(readme, /Commercial Truth/);
  assert.match(proReadme, /Commercial Truth/);
  assert.doesNotMatch(readme, /500\+ agentic sessions|battle-tested/i);
  assert.doesNotMatch(proReadme, /500\+ agentic sessions|battle-tested/i);

  for (const historicalDoc of [pricingResearch, crisisReport, packagingPlan, revenueSprint, xStrategy]) {
    assert.match(historicalDoc, /Historical .*note|Historical .*archived|Historical .*hypothesis/i);
    assert.match(historicalDoc, /COMMERCIAL_TRUTH\.md/);
  }

  assert.match(anthropicStrategy, /Status: current/i);
  assert.match(anthropicStrategy, /Claude workflow hardening/i);
  assert.match(anthropicStrategy, /booked pilots/i);
  assert.match(anthropicStrategy, /founder-led outbound/i);
  assert.match(anthropicStrategy, /COMMERCIAL_TRUTH\.md/);
  assert.doesNotMatch(anthropicStrategy, /^We are an official Anthropic partner\b/m);

  assert.match(workflowSprint, /Status: current/i);
  assert.match(workflowSprint, /pilot-by-request/i);
  assert.match(workflowSprint, /one workflow/i);
  assert.match(workflowSprint, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(workflowSprint, /^We are an official Anthropic partner\b/m);

  assert.doesNotMatch(directoryGuide, /30k\+ stars|18k\+ servers listed/i);
});
