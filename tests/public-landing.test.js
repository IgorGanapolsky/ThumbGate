const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@type": "Organization"/);
  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /"@type": "ContactPoint"/);
  assert.match(landingPage, /"@type": "BuyAction"/);
  assert.match(landingPage, /"@type": "CommunicateAction"/);
  assert.match(landingPage, /Who should upgrade to Pro\?/);
  assert.match(landingPage, /Can I pair it with editor continuity tools or resume assistants\?/);
  assert.match(landingPage, /Can consultancies and platform teams use this for Claude workflow hardening or code modernization\?/);
  assert.match(landingPage, /What is the Workflow Hardening Sprint\?/);
  assert.match(landingPage, /Can I install mcp-memory-gateway as a Claude Desktop extension\?/);
  assert.match(landingPage, /Do I need subagents or an orchestration layer to get value\?/);
  assert.match(landingPage, /optional context inputs/i);
  assert.match(landingPage, /same agent session/i);
  assert.match(landingPage, /no orchestration|no subagent handoff/i);
});

test('public landing page uses the injected checkout fallback token', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /__CHECKOUT_FALLBACK_URL__\?utm_source=website&utm_medium=cta_button&utm_campaign=pro_pack/);
  assert.match(landingPage, /const fallbackBase = '__CHECKOUT_FALLBACK_URL__';/);
  assert.doesNotMatch(landingPage, /const fallbackBase = 'https:\/\/iganapolsky\.gumroad\.com\/l\/tjovof';/);
});

test('public landing page enriches fallback checkout links with first-party attribution fields', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /url\.searchParams\.set\('trace_id', checkoutTraceId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('acquisition_id', getAcquisitionId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('visitor_id', getVisitorId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('session_id', getSessionId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('community', attribution\.community\)/);
  assert.match(landingPage, /url\.searchParams\.set\('post_id', attribution\.postId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('comment_id', attribution\.commentId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('campaign_variant', attribution\.campaignVariant\)/);
  assert.match(landingPage, /url\.searchParams\.set\('offer_code', attribution\.offerCode\)/);
  assert.match(landingPage, /url\.searchParams\.set\('landing_path', attribution\.landingPath\)/);
  assert.match(landingPage, /url\.searchParams\.set\('referrer_host', attribution\.referrerHost\)/);
  assert.match(landingPage, /sendTelemetry\('checkout_fallback_redirect'/);
});

test('public landing page uses secure browser randomness for generated identifiers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /function secureRandomHex\(byteLength\)/);
  assert.match(landingPage, /cryptoApi\.getRandomValues\(bytes\)/);
  assert.match(landingPage, /prefix \+ secureRandomHex\(16\)/);
  assert.doesNotMatch(landingPage, /Math\.random\(/);
});

test('public landing page keeps optional GA4 and Search Console hooks available for runtime injection', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.match(landingPage, /const gaMeasurementId = '__GA_MEASUREMENT_ID__';/);
  assert.match(landingPage, /const serverVisitorId = '__SERVER_VISITOR_ID__';/);
  assert.match(landingPage, /const serverSessionId = '__SERVER_SESSION_ID__';/);
  assert.match(landingPage, /const serverAcquisitionId = '__SERVER_ACQUISITION_ID__';/);
  assert.match(landingPage, /const serverTelemetryCaptured = '__SERVER_TELEMETRY_CAPTURED__' === 'true';/);
  assert.match(landingPage, /function trackGaEvent/);
  assert.match(landingPage, /trackGaEvent\('begin_checkout'/);
  assert.match(landingPage, /trackGaEvent\('reason_not_buying'/);
});

test('public landing page includes buyer-loss capture wired to telemetry and Plausible', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="buyer-feedback"/);
  assert.match(landingPage, /data-loss-reason="too_expensive"/);
  assert.match(landingPage, /data-loss-reason="missing_trust"/);
  assert.match(landingPage, /id="buyer-feedback-submit"/);
  assert.match(landingPage, /sendTelemetry\('reason_not_buying'/);
  assert.match(landingPage, /window\.plausible\('Buyer Feedback Submitted'/);
});

test('public landing page auto-detects search traffic and records SEO landing telemetry', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /function inferSearchSurface/);
  assert.match(landingPage, /function inferSearchQuery/);
  assert.match(landingPage, /landingAttribution\.source === 'organic_search' \|\| landingAttribution\.source === 'ai_search'/);
  assert.match(landingPage, /if \(!serverTelemetryCaptured\) \{\s*sendTelemetry\('landing_page_view'/);
  assert.match(landingPage, /if \(!serverTelemetryCaptured\) \{\s*sendTelemetry\('seo_landing_view'/);
  assert.match(landingPage, /sendTelemetry\('seo_landing_view'/);
  assert.match(landingPage, /trackGaEvent\('seo_landing_view'/);
});

test('public landing page includes a Reddit campaign banner and subreddit-aware attribution logic', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="campaign-banner"/);
  assert.match(landingPage, /parseRedditCommunity/);
  assert.match(landingPage, /utmSource !== 'reddit'/);
  assert.match(landingPage, /Use code/);
});

test('public landing page positions the gateway as continuity-friendly reliability without orchestration tax', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /MCP Memory Gateway \| Pre-Action Gates for AI coding agents/i);
  assert.match(landingPage, /Pre-Action Gates for AI coding agents\./i);
  assert.match(landingPage, /Pre-action gates that physically block AI coding agents from repeating known mistakes\./i);
  assert.match(landingPage, /Keep one sharp agent\./);
  assert.match(landingPage, /Workflow Hardening Sprint/i);
  assert.match(landingPage, /One workflow, one owner, one proof review/i);
  assert.match(landingPage, /Claude Desktop extension/i);
  assert.match(landingPage, /Seven high-intent use cases for Claude workflow hardening/i);
  assert.match(landingPage, /The sellable unit is not a generic AI employee/i);
  assert.match(landingPage, /Code modernization guardrails/i);
  assert.match(landingPage, /platform teams, consultancies, and AI-heavy engineering groups/i);
  assert.match(landingPage, /without introducing another orchestration layer or subagent handoff tax/i);
  assert.match(landingPage, /No orchestration tax/);
  assert.match(landingPage, /same agent session/i);
  assert.match(landingPage, /AI reliability system, not orchestration layer\./);
  assert.match(landingPage, /reliability rules/i);
  assert.match(landingPage, /3 failures .* warn gate, 5 failures .* blocking gate/i);
  assert.match(landingPage, /Review Proof Pack/);
  assert.match(landingPage, /See Sprint Scope/);
  assert.match(landingPage, /Start Sprint Intake/);
  assert.match(landingPage, /data-cta-id="pricing_sprint"/);
  assert.match(landingPage, /named-pilot path/i);
  assert.match(landingPage, /Review Sprint Brief/);
  assert.match(landingPage, /id="workflow-sprint-form"/);
  assert.match(landingPage, /id="workflow-sprint-form" action="\/v1\/intake\/workflow-sprint" method="post"/);
  assert.match(landingPage, /name="ctaId" type="hidden" value="workflow_sprint_intake"/);
  assert.match(landingPage, /\/v1\/intake\/workflow-sprint/);
  assert.match(landingPage, /data-cta-id="workflow_sprint_brief"/);
  assert.match(landingPage, /data-cta-id="workflow_sprint_proof"/);
  assert.match(landingPage, /workflow_sprint_lead_failed/);
  assert.match(landingPage, /href="#workflow-sprint-intake"/);
  assert.match(landingPage, /VERIFICATION_EVIDENCE\.md/);
  assert.match(landingPage, /WORKFLOW_HARDENING_SPRINT\.md/);
  assert.doesNotMatch(landingPage, /Email Instead/i);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
  assert.doesNotMatch(landingPage, /same control plane/i);
});

test('public landing page includes Reliability Studio compare-and-deploy positioning without training drift', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Reliability Studio/i);
  assert.match(landingPage, /Import\. Compare\. Deploy\./);
  assert.match(landingPage, /No model fine-tuning required/i);
  assert.match(landingPage, /PR review threads, CI logs, runbooks, JSONL, and CSV/i);
  assert.match(landingPage, /Start Compare &amp; Deploy/);
  assert.match(landingPage, /Review Loops/i);
  assert.match(landingPage, /Workflow proof pack/i);
  assert.match(landingPage, /Product walkthrough only/i);
  assert.match(landingPage, /What is Reliability Studio Compare and Deploy\?/);
  assert.doesNotMatch(landingPage, /500\+ LLMs/i);
  assert.doesNotMatch(landingPage, /GGUF/i);
});

test('public landing page includes an honest workflow fit checker for action-driven queries', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Workflow Hardening Fit Checker/i);
  assert.match(landingPage, /can AI fully satisfy this query without a click\?/i);
  assert.match(landingPage, /workflow belongs in the Sprint, Pro, or the free OSS path/i);
  assert.match(landingPage, /Qualification aid only\./i);
  assert.match(landingPage, /id="fit-checker-run"/);
  assert.match(landingPage, /fit_check_completed/);
  assert.match(landingPage, /Best path: Workflow Hardening Sprint/i);
  assert.match(landingPage, /AI Can Fully Satisfy This Query Without A Click\?/i);
  assert.match(landingPage, /Review Sprint Scope/i);
  assert.match(landingPage, /data-cta-id="hero_fit"/);
  assert.match(landingPage, /function syncFitCtaLink\(link, href\)/);
  assert.match(landingPage, /const isExternalLink = \/\^https\?:\\\/\\\/\//);
  assert.match(landingPage, /link\.target = '_blank';/);
  assert.match(landingPage, /link\.removeAttribute\('target'\);/);
  assert.match(landingPage, /syncFitCtaLink\(fitPrimaryCta, result\.primary\.href\);/);
  assert.match(landingPage, /syncFitCtaLink\(fitSecondaryCta, result\.secondary\.href\);/);
  assert.doesNotMatch(landingPage, /live ROI/i);
  assert.doesNotMatch(landingPage, /customer outcomes/i);
});

test('public landing page promotes the Claude Desktop extension path without false approval claims', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="claude-desktop"/);
  assert.match(landingPage, /Publish the same workflow-hardening story as a Claude Desktop extension/i);
  assert.match(landingPage, /Claude Desktop is now a real discovery surface/i);
  assert.match(landingPage, /claude mcp add rlhf -- npx -y mcp-memory-gateway serve/i);
  assert.match(landingPage, /buildable `.mcpb`|buildable \.mcpb/i);
  assert.match(landingPage, /npm run build:claude-mcpb/i);
  assert.match(landingPage, /Review Claude Extension Guide/i);
  assert.match(landingPage, /Review Submission Packet/i);
  assert.match(landingPage, /Directory inclusion depends on Anthropic review/i);
  assert.doesNotMatch(landingPage, /approved Claude listing/i);
});
