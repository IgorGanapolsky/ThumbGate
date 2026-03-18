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

  assert.match(landingPage, /Claude Workflow Hardening and AI Reliability/i);
  assert.match(landingPage, /Harden one Claude workflow\./i);
  assert.match(landingPage, /Keep one sharp agent\./);
  assert.match(landingPage, /Workflow Hardening Sprint/i);
  assert.match(landingPage, /One workflow, one owner, one proof review/i);
  assert.match(landingPage, /Seven high-intent use cases for Claude workflow hardening/i);
  assert.match(landingPage, /The sellable unit is not a generic AI employee/i);
  assert.match(landingPage, /Code modernization guardrails/i);
  assert.match(landingPage, /platform teams, consultancies, and AI-heavy engineering groups/i);
  assert.match(landingPage, /without introducing another orchestration layer or subagent handoff tax/i);
  assert.match(landingPage, /No orchestration tax/);
  assert.match(landingPage, /same agent session/i);
  assert.match(landingPage, /AI reliability system, not orchestration layer\./);
  assert.match(landingPage, /reliability rules/i);
  assert.match(landingPage, /Review Proof Pack/);
  assert.match(landingPage, /See Sprint Scope/);
  assert.match(landingPage, /Start Sprint Intake/);
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
