const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_CHECKOUT_FALLBACK_URL,
  GA_MEASUREMENT_ID_PATTERN,
  resolveHostedBillingConfig,
} = require('../scripts/hosted-config');
const {
  CLAUDE_PLUGIN_NEXT_ASSET_NAME,
  CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME,
  CODEX_PLUGIN_NEXT_ASSET_NAME,
  PRODUCTHUNT_URL,
  getClaudePluginChannelAssetName,
  getClaudePluginLatestDownloadUrl,
  getClaudePluginReviewChannelAssetName,
  getClaudePluginReviewLatestDownloadUrl,
  getCodexPluginChannelAssetName,
  getCodexPluginLatestDownloadUrl,
} = require('../scripts/distribution-surfaces');

const PROJECT_ROOT = path.join(__dirname, '..');
const CANONICAL_APP_ORIGIN = 'https://thumbgate-production.up.railway.app';
const CURRENT_REPOSITORY_URL = 'https://github.com/IgorGanapolsky/ThumbGate';
const PRO_REPOSITORY_URL = 'https://github.com/IgorGanapolsky/thumbgate-pro';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

test('pricing matches 2026 standard', () => {
  assert.match('$19/mo or $149/yr', /\$19\/mo or \$149\/yr/);
});

test('package version matches MCP manifests', () => {
  const packageJson = readJson('package.json');
  const serverManifest = readJson('server.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');
  const cursorMarketplace = readJson('.cursor-plugin/marketplace.json');
  const cursorPlugin = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const claudeCodexBridge = readJson('plugins/claude-codex-bridge/.claude-plugin/plugin.json');
  const codexPlugin = readJson('plugins/codex-profile/.codex-plugin/plugin.json');

  assert.equal(serverManifest.version, packageJson.version);
  assert.equal(claudePlugin.version, packageJson.version);
  assert.equal(claudeMarketplace.version, packageJson.version);
  assert.equal(claudeMarketplace.plugins[0].version, packageJson.version);
  assert.equal(cursorMarketplace.metadata.version, packageJson.version);
  assert.equal(cursorPlugin.version, packageJson.version);
  assert.equal(claudeCodexBridge.version, packageJson.version);
  assert.equal(codexPlugin.version, packageJson.version);
});

test('public docs render the current package version', () => {
  const packageJson = readJson('package.json');
  const readme = readText('README.md');
  const landingPage = readText('docs/landing-page.html');
  const mcpSubmission = readText('docs/mcp-hub-submission.md');
  const claudePluginReadme = readText('.claude-plugin/README.md');
  const chatgptInstall = readText('adapters/chatgpt/INSTALL.md');
  const chatgptInstructions = readText('docs/chatgpt-gpt-instructions.md');
  const gptStoreSubmission = readText('docs/gpt-store-submission.md');
  const claudeCodexBridgeReadme = readText('plugins/claude-codex-bridge/README.md');
  const claudeCodexBridgeInstall = readText('plugins/claude-codex-bridge/INSTALL.md');
  const codexPluginReadme = readText('plugins/codex-profile/README.md');
  const codexPluginInstall = readText('plugins/codex-profile/INSTALL.md');
  const distributionDoc = readText('docs/PLUGIN_DISTRIBUTION.md');
  const claudeDesktopPacket = readText('docs/CLAUDE_DESKTOP_EXTENSION.md');
  const productHuntKit = readText('docs/marketing/product-hunt-launch.md');

  assert.match(readme, /Open ThumbGate GPT/);
  assert.match(readme, /https:\/\/chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.match(readme, /ThumbGate GPT: start here/i);
  assert.match(readme, /No, users do not have to keep chatting inside the ThumbGate GPT to use ThumbGate/i);
  assert.match(readme, /hard enforcement layer still runs where the work happens/i);
  assert.match(landingPage, /ThumbGate/);
  assert.match(landingPage, /AI agent reliability/i);
  assert.match(landingPage, /Claude Desktop extension/i);
  assert.match(landingPage, /\$19\/mo/);
  assert.match(landingPage, /\$149\/yr/);
  assert.match(landingPage, /Reliability Studio/i);
  assert.match(landingPage, /Compare and Deploy/i);
  assert.match(landingPage, /No model fine-tuning required/i);
  assert.match(landingPage, /Workflow Hardening Fit Checker/i);
  assert.match(landingPage, /Claude Desktop extension path/i);
  assert.match(landingPage, /ChatGPT GPT Actions path/i);
  assert.match(landingPage, /https:\/\/chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.match(landingPage, /adapters\/chatgpt\/openapi\.yaml/i);
  assert.match(landingPage, /can AI fully satisfy this query without a click\?/i);
  assert.match(landingPage, /Run the hosted fit checker/i);
  assert.match(claudePluginReadme, /Claude Desktop/i);
  assert.match(claudePluginReadme, /Privacy Policy/i);
  assert.match(claudePluginReadme, /Data Collection/i);
  assert.match(claudePluginReadme, /Support/i);
  assert.match(claudePluginReadme, /claude mcp add thumbgate -- npx --yes --package thumbgate thumbgate serve/i);
  assert.match(claudePluginReadme, /\/plugin marketplace add IgorGanapolsky\/ThumbGate/i);
  assert.match(claudePluginReadme, /\/plugin install thumbgate@thumbgate-marketplace/i);
  assert.match(claudePluginReadme, /npm run build:claude-mcpb/i);
  assert.match(claudePluginReadme, /npm run build:claude-review-zip/i);
  assert.match(chatgptInstall, /Explore GPTs/i);
  assert.match(chatgptInstall, /https:\/\/chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.doesNotMatch(chatgptInstall, /URL has not been captured/i);
  assert.match(chatgptInstall, /Search for `ThumbGate`/);
  assert.match(chatgptInstall, /30-second user flow/);
  assert.match(chatgptInstall, /GPT profile card/);
  assert.match(chatgptInstall, /Pre-action gate flow/);
  assert.match(chatgptInstall, /Reliability Gateway/i);
  assert.match(chatgptInstall, /Turn thumbs-down into prevention gates/);
  assert.match(chatgptInstall, /evaluateDecision/);
  assert.match(chatgptInstall, /decisionControl\.executionMode: "blocked"/);
  assert.match(chatgptInstall, /Plain thumbs-up\/down feedback is the memory loop\. The decision endpoint is the gate loop\./);
  assert.match(chatgptInstall, /Check this agent action before it runs: git push --force --tags/i);
  assert.match(chatgptInstall, /Paste an AI action to check, or tell me what went right\/wrong/i);
  assert.match(chatgptInstall, /native feedback buttons may send feedback to OpenAI/i);
  assert.match(chatgptInstall, /Regular GPT users should not need an API key, JSON payload, OpenAPI knowledge, or developer setup/i);
  assert.match(chatgptInstall, /Users do \*\*not\*\* have to keep chatting inside the ThumbGate GPT for enforcement/i);
  assert.match(chatgptInstall, /every landing page, README, social post, and plugin listing should point to the live GPT/i);
  assert.match(chatgptInstall, /This is an owner setup field/i);
  assert.match(chatgptInstall, /https:\/\/thumbgate-production\.up\.railway\.app\/openapi\.yaml/);
  assert.match(chatgptInstall, /https:\/\/thumbgate-production\.up\.railway\.app\/privacy/);
  assert.match(chatgptInstructions, /Reliability Gateway for AI agents/i);
  assert.match(chatgptInstructions, /https:\/\/chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.match(chatgptInstructions, /Turn thumbs-down into prevention gates/);
  assert.match(chatgptInstructions, /Paste an AI action to check, or tell me what went right\/wrong/i);
  assert.match(chatgptInstructions, /Action check mode/);
  assert.match(chatgptInstructions, /Feedback capture mode/);
  assert.match(chatgptInstructions, /decisionControl\.executionMode/);
  assert.match(chatgptInstructions, /one signal becomes one remembered rule/i);
  assert.match(chatgptInstructions, /public front door for ThumbGate/i);
  assert.match(chatgptInstructions, /Hard enforcement runs locally after `npx thumbgate init` where your agent actually executes/i);
  assert.match(chatgptInstructions, /Regular users should never need an API key, JSON payload, OpenAPI knowledge, or developer setup/i);
  assert.doesNotMatch(chatgptInstructions, /Setup Concierge/i);
  assert.doesNotMatch(chatgptInstructions, /AI safety gate/i);
  assert.match(gptStoreSubmission, /published-user-confirmed/);
  assert.match(gptStoreSubmission, /https:\/\/chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.doesNotMatch(gptStoreSubmission, /URL has not been captured/i);
  assert.match(gptStoreSubmission, /Explore GPTs -> search ThumbGate/i);
  assert.match(gptStoreSubmission, /Turn thumbs-down into prevention gates/);
  assert.match(gptStoreSubmission, /Reliability Gateway/i);
  assert.match(gptStoreSubmission, /one signal becomes one remembered rule/i);
  assert.match(gptStoreSubmission, /Pre-Action Gates/);
  assert.match(gptStoreSubmission, /POST \/v1\/decisions\/evaluate/);
  assert.match(gptStoreSubmission, /Action check mode/);
  assert.match(gptStoreSubmission, /Feedback capture mode/);
  assert.match(gptStoreSubmission, /Do not claim hard enforcement from plain feedback alone/);
  assert.match(gptStoreSubmission, /native rating buttons automatically save ThumbGate lessons/i);
  assert.match(gptStoreSubmission, /User experience rules/);
  assert.match(gptStoreSubmission, /Never make regular users write JSON/);
  assert.match(gptStoreSubmission, /Regular users should never be asked for API keys/);
  assert.match(gptStoreSubmission, /Only show feedback IDs when the user asks for technical details/i);
  assert.match(gptStoreSubmission, /https:\/\/thumbgate-production\.up\.railway\.app\/privacy/);
  assert.match(gptStoreSubmission, /Category set to Programming \/ Productivity/);
  assert.match(gptStoreSubmission, /Turn this mistake into a ThumbGate rule/i);
  assert.match(claudePluginReadme, new RegExp(getClaudePluginLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(claudePluginReadme, new RegExp(getClaudePluginReviewLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(claudeCodexBridgeReadme, /claude --plugin-dir/i);
  assert.match(claudeCodexBridgeReadme, /claude plugin validate/i);
  assert.match(claudeCodexBridgeInstall, /\/codex-bridge:review/);
  assert.match(claudeCodexBridgeInstall, /\/codex-bridge:adversarial-review/);
  assert.match(codexPluginReadme, /standalone Codex plugin bundle/i);
  assert.match(codexPluginReadme, /build:codex-plugin/i);
  assert.match(codexPluginReadme, new RegExp(getCodexPluginLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(codexPluginInstall, /thumbgate-codex-plugin\.zip/i);
  assert.match(codexPluginInstall, /build:codex-plugin/i);
  assert.match(distributionDoc, /publish-codex-plugin\.yml/);
  assert.match(distributionDoc, /thumbgate-codex-plugin\.zip/);
  assert.match(distributionDoc, new RegExp(getCodexPluginLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(distributionDoc, /build:claude-review-zip/);
  assert.match(distributionDoc, new RegExp(getClaudePluginReviewLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(claudeDesktopPacket, /Anthropic Local MCP Server Submission Guide/i);
  assert.match(claudeDesktopPacket, /Build the MCPB/i);
  assert.match(claudeDesktopPacket, /privacy_policies/i);
  assert.match(claudeDesktopPacket, /\/plugin marketplace add IgorGanapolsky\/ThumbGate/i);
  assert.match(claudeDesktopPacket, /\/plugin install thumbgate@thumbgate-marketplace/i);
  assert.match(claudeDesktopPacket, /npm run build:claude-mcpb/i);
  assert.match(claudeDesktopPacket, new RegExp(getClaudePluginLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(claudeDesktopPacket, new RegExp(getClaudePluginReviewLatestDownloadUrl(PROJECT_ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(claudeDesktopPacket, /Tool safety annotations/i);
  assert.match(claudeDesktopPacket, /Do not claim directory approval/i);
  assert.ok(productHuntKit.includes(PRODUCTHUNT_URL));
  assert.match(productHuntKit, /Claude plugin bundle/i);
  assert.doesNotMatch(landingPage, /billingIncrement/);
  assert.doesNotMatch(landingPage, /P1M/);
  assert.match(mcpSubmission, new RegExp(`## Version\\s+${packageJson.version}`));
});

test('distribution surfaces reserve a separate prerelease Claude asset alias', () => {
  assert.equal(getClaudePluginChannelAssetName('1.0.0'), 'thumbgate-claude-desktop.mcpb');
  assert.equal(getClaudePluginChannelAssetName('1.1.0-beta.1'), CLAUDE_PLUGIN_NEXT_ASSET_NAME);
  assert.equal(getClaudePluginReviewChannelAssetName('1.0.0'), 'thumbgate-claude-plugin-review.zip');
  assert.equal(getClaudePluginReviewChannelAssetName('1.1.0-beta.1'), CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME);
  assert.equal(getCodexPluginChannelAssetName('1.0.0'), 'thumbgate-codex-plugin.zip');
  assert.equal(getCodexPluginChannelAssetName('1.1.0-beta.1'), CODEX_PLUGIN_NEXT_ASSET_NAME);
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
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');
  const claudeReadme = readText('.claude-plugin/README.md');
  const cursorPlugin = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const claudeCodexBridge = readJson('plugins/claude-codex-bridge/.claude-plugin/plugin.json');
  const codexPlugin = readJson('plugins/codex-profile/.codex-plugin/plugin.json');
  const publicLanding = readText('public/index.html');
  const serverSource = readText('src/api/server.js');
  const twitterThread = readText('docs/marketing/twitter-thread.md');

  assert.equal(packageJson.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(serverManifest.websiteUrl, CANONICAL_APP_ORIGIN);

  assert.match(publicLanding, new RegExp(CURRENT_REPOSITORY_URL.replaceAll('.', '\\.')));
  assert.match(publicLanding, /thumbgate/i);
  assert.match(publicLanding, /\$19/);
  assert.match(publicLanding, /\$149/);
  assert.match(publicLanding, /__PRO_PRICE_DOLLARS__/);
  assert.match(publicLanding, /__GA_BOOTSTRAP__/);
  assert.match(publicLanding, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(publicLanding, /workflow governance|agent governance/i);
  assert.match(publicLanding, /Verification evidence/i);
  assert.match(publicLanding, /Release confidence/i);
  assert.match(publicLanding, /standalone plugin bundle/i);
  assert.doesNotMatch(publicLanding, /billingDuration/);
  assert.doesNotMatch(publicLanding, /P1M/);
  assert.doesNotMatch(publicLanding, /mcp-gateway\.vercel\.app/);
  assert.doesNotMatch(publicLanding, /github\.com\/IgorGanapolsky\/thumbgate/);
  assert.doesNotMatch(publicLanding, /github\.com\/IgorGanapolsky\/thumbgate/);

  assert.match(serverSource, new RegExp(CURRENT_REPOSITORY_URL.replaceAll('.', '\\.')));
  assert.doesNotMatch(serverSource, /github\.com\/IgorGanapolsky\/thumbgate/);
  assert.doesNotMatch(serverSource, /github\.com\/IgorGanapolsky\/thumbgate/);
  assert.equal(claudePlugin.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(claudePlugin.repository, CURRENT_REPOSITORY_URL);
  assert.equal(claudeMarketplace.plugins[0].metadata.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(cursorPlugin.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(cursorPlugin.repository, CURRENT_REPOSITORY_URL);
  assert.equal(claudeCodexBridge.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(claudeCodexBridge.repository, CURRENT_REPOSITORY_URL);
  assert.equal(codexPlugin.homepage, CANONICAL_APP_ORIGIN);
  assert.equal(codexPlugin.repository, CURRENT_REPOSITORY_URL);
  assert.doesNotMatch(claudeReadme, /github\.com\/IgorGanapolsky\/thumbgate/);

  assert.match(twitterThread, /Hosted demo: thumbgate-production\.up\.railway\.app/);
  assert.match(twitterThread, /engineering validation, not customer proof/i);
  assert.doesNotMatch(twitterThread, /us-central1\.run\.app/);
});

test('runtime hosted billing config defaults to the live pro price label', () => {
  const previousLabel = process.env.THUMBGATE_PRO_PRICE_LABEL;
  const previousDollars = process.env.THUMBGATE_PRO_PRICE_DOLLARS;
  const previousFallback = process.env.THUMBGATE_CHECKOUT_FALLBACK_URL;
  const previousGaMeasurementId = process.env.THUMBGATE_GA_MEASUREMENT_ID;
  const previousGoogleSiteVerification = process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
  delete process.env.THUMBGATE_PRO_PRICE_LABEL;
  delete process.env.THUMBGATE_PRO_PRICE_DOLLARS;
  delete process.env.THUMBGATE_CHECKOUT_FALLBACK_URL;
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
  delete process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(runtimeConfig.proPriceLabel, '$19/mo or $149/yr (individual)');
    assert.equal(runtimeConfig.proPriceDollars, 19);
    assert.equal(runtimeConfig.checkoutFallbackUrl, DEFAULT_CHECKOUT_FALLBACK_URL);
    assert.equal(runtimeConfig.gaMeasurementId, '');
    assert.equal(runtimeConfig.googleSiteVerification, '');
  } finally {
    if (previousLabel === undefined) {
      delete process.env.THUMBGATE_PRO_PRICE_LABEL;
    } else {
      process.env.THUMBGATE_PRO_PRICE_LABEL = previousLabel;
    }
    if (previousDollars === undefined) {
      delete process.env.THUMBGATE_PRO_PRICE_DOLLARS;
    } else {
      process.env.THUMBGATE_PRO_PRICE_DOLLARS = previousDollars;
    }
    if (previousFallback === undefined) {
      delete process.env.THUMBGATE_CHECKOUT_FALLBACK_URL;
    } else {
      process.env.THUMBGATE_CHECKOUT_FALLBACK_URL = previousFallback;
    }
    if (previousGaMeasurementId === undefined) {
      delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
    } else {
      process.env.THUMBGATE_GA_MEASUREMENT_ID = previousGaMeasurementId;
    }
    if (previousGoogleSiteVerification === undefined) {
      delete process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
    } else {
      process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = previousGoogleSiteVerification;
    }
  }
});

test('runtime hosted billing config preserves absolute fallback checkout urls', () => {
  const previousFallback = process.env.THUMBGATE_CHECKOUT_FALLBACK_URL;
  process.env.THUMBGATE_CHECKOUT_FALLBACK_URL = 'https://buy.stripe.com/5kQ4gzbmI9Lo6tPayn3sI06?utm_source=website&utm_medium=cta_button';

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(
      runtimeConfig.checkoutFallbackUrl,
      'https://buy.stripe.com/5kQ4gzbmI9Lo6tPayn3sI06?utm_source=website&utm_medium=cta_button'
    );
  } finally {
    if (previousFallback === undefined) {
      delete process.env.THUMBGATE_CHECKOUT_FALLBACK_URL;
    } else {
      process.env.THUMBGATE_CHECKOUT_FALLBACK_URL = previousFallback;
    }
  }
});

test('runtime hosted billing config accepts valid analytics tracking identifiers', () => {
  const previousGaMeasurementId = process.env.THUMBGATE_GA_MEASUREMENT_ID;
  const previousGoogleSiteVerification = process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
  process.env.THUMBGATE_GA_MEASUREMENT_ID = 'G-TEST1234';
  process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = 'test-verification-token';

  try {
    const runtimeConfig = resolveHostedBillingConfig();
    assert.equal(runtimeConfig.gaMeasurementId, 'G-TEST1234');
    assert.equal(runtimeConfig.googleSiteVerification, 'test-verification-token');
    assert.match(runtimeConfig.gaMeasurementId, GA_MEASUREMENT_ID_PATTERN);
  } finally {
    if (previousGaMeasurementId === undefined) {
      delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
    } else {
      process.env.THUMBGATE_GA_MEASUREMENT_ID = previousGaMeasurementId;
    }
    if (previousGoogleSiteVerification === undefined) {
      delete process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
    } else {
      process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = previousGoogleSiteVerification;
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
    assert.match(artifact, /thumbgate-production\.up\.railway\.app/);
    assert.doesNotMatch(artifact, /Always-On/i);
    assert.doesNotMatch(artifact, /Mistake-Free/i);
  }
});

test('commercial truth sources stay aligned across public and historical docs', () => {
  const commercialTruth = readText('docs/COMMERCIAL_TRUTH.md');
  const readme = readText('README.md');
  // Removed duplicate pricing doc (03-09 was identical to 03-10)
  const crisisReport = readText('docs/PRICING_RESEARCH_2026-03-10.md');
  const packagingPlan = readText('docs/PACKAGING_AND_SALES_PLAN.md');
  const revenueSprint = readText('docs/REVENUE_SPRINT_MAR2026.md');
  const anthropicStrategy = readText('docs/ANTHROPIC_MARKETPLACE_STRATEGY.md');
  const workflowSprint = readText('docs/WORKFLOW_HARDENING_SPRINT.md');
  const xStrategy = readText('docs/X_AUTOMATION_STRATEGY.md');
  const directoryGuide = readText('docs/marketing/mcp-directories.md');

  assert.match(commercialTruth, /Pro at \$19\/mo or \$149\/yr/);
  assert.match(commercialTruth, /Team pricing anchor is \*\*\$99\/seat\/mo/i);
  assert.match(commercialTruth, /auto-gate promotion/);
  assert.match(commercialTruth, /Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof/);

  assert.match(readme, /Commercial Truth/);
  assert.doesNotMatch(readme, /500\+ agentic sessions|battle-tested/i);

  for (const historicalDoc of [crisisReport, packagingPlan, revenueSprint, xStrategy]) {
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

test('public repo documents the separate Pro overlay repository', () => {
  const readme = readText('README.md');
  const distributionDoc = readText('docs/PLUGIN_DISTRIBUTION.md');
  assert.match(readme, new RegExp(PRO_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(distributionDoc, /public repo owns shared runtime/i);
  assert.match(distributionDoc, /paid overlay code in the separate `thumbgate-pro` repo\/package/i);
});
