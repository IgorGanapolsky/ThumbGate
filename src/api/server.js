#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');

const {
  captureFeedback,
  analyzeFeedback,
  feedbackSummary,
  writePreventionRules,
  getFeedbackPaths,
  appendDiagnosticRecord,
} = require('../../scripts/feedback-loop');
const {
  readJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
const {
  exportDatabricksBundle,
} = require('../../scripts/export-databricks-bundle');
const {
  ensureContextFs,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
} = require('../../scripts/contextfs');
const {
  buildRubricEvaluation,
} = require('../../scripts/rubric-engine');
const {
  listIntents,
  planIntent,
} = require('../../scripts/intent-router');
const {
  startHandoff,
  completeHandoff,
} = require('../../scripts/delegation-runtime');
const {
  loadModel,
  getReliability,
  samplePosteriors,
} = require('../../scripts/thompson-sampling');
const {
  createCheckoutSession,
  getCheckoutSessionStatus,
  provisionApiKey,
  validateApiKey,
  recordUsage,
  rotateApiKey,
  handleWebhook,
  verifyWebhookSignature,
  verifyGithubWebhookSignature,
  handleGithubWebhook,
  getFunnelAnalytics,
  getBillingSummary,
} = require('../../scripts/billing');
const {
  resolveHostedBillingConfig,
  createTraceId,
  buildHostedSuccessUrl,
  buildHostedCancelUrl,
} = require('../../scripts/hosted-config');
const {
  generateSkills,
} = require('../../scripts/skill-generator');
const {
  satisfyCondition,
  loadStats: loadGateStats,
  setConstraint,
  loadConstraints,
} = require('../../scripts/gates-engine');
const {
  generateDashboard,
} = require('../../scripts/dashboard');
const {
  appendTelemetryPing,
} = require('../../scripts/telemetry-analytics');
const {
  checkLimit,
  UPGRADE_MESSAGE: RATE_LIMIT_MESSAGE,
} = require('../../scripts/rate-limiter');
const { sendProblem, PROBLEM_TYPES } = require('../../scripts/problem-detail');
const { TOOLS: MCP_TOOLS } = require('../../scripts/tool-registry');

const LANDING_PAGE_PATH = path.resolve(__dirname, '../../public/index.html');

function getSafeDataDir() {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  return path.resolve(path.dirname(FEEDBACK_LOG_PATH));
}

function getPublicMcpTools() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function getServerCardTools() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeNullableText(value);
    if (normalized) return normalized;
  }
  return null;
}

function parseReferrerHost(referrer) {
  const normalized = normalizeNullableText(referrer);
  if (!normalized) return null;
  try {
    return new URL(normalized).host || null;
  } catch {
    return null;
  }
}

function buildCheckoutAttributionMetadata(body, req, traceId) {
  const rawMetadata = body && body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const utmSource = pickFirstText(rawMetadata.utmSource, body.utmSource, rawMetadata.source, body.source);
  const utmMedium = pickFirstText(rawMetadata.utmMedium, body.utmMedium, 'checkout_api');
  const referrer = pickFirstText(rawMetadata.referrer, body.referrer, req.headers.referer, req.headers.referrer);

  return {
    ...rawMetadata,
    traceId,
    acquisitionId: pickFirstText(rawMetadata.acquisitionId, body.acquisitionId),
    visitorId: pickFirstText(rawMetadata.visitorId, body.visitorId),
    sessionId: pickFirstText(rawMetadata.sessionId, body.sessionId),
    source: pickFirstText(rawMetadata.source, body.source, utmSource, 'direct'),
    utmSource,
    utmMedium,
    utmCampaign: pickFirstText(rawMetadata.utmCampaign, body.utmCampaign),
    utmContent: pickFirstText(rawMetadata.utmContent, body.utmContent),
    utmTerm: pickFirstText(rawMetadata.utmTerm, body.utmTerm),
    community: pickFirstText(rawMetadata.community, rawMetadata.subreddit, body.community, body.subreddit),
    postId: pickFirstText(rawMetadata.postId, rawMetadata.post_id, body.postId, body.post_id),
    commentId: pickFirstText(rawMetadata.commentId, rawMetadata.comment_id, body.commentId, body.comment_id),
    campaignVariant: pickFirstText(rawMetadata.campaignVariant, rawMetadata.variant, body.campaignVariant, body.variant),
    offerCode: pickFirstText(rawMetadata.offerCode, rawMetadata.offer, rawMetadata.coupon, body.offerCode, body.offer, body.coupon),
    referrer,
    referrerHost: pickFirstText(rawMetadata.referrerHost, body.referrerHost, parseReferrerHost(referrer)),
    landingPath: pickFirstText(rawMetadata.landingPath, body.landingPath, body.page),
    ctaId: pickFirstText(rawMetadata.ctaId, body.ctaId),
    ctaPlacement: pickFirstText(rawMetadata.ctaPlacement, body.ctaPlacement),
    planId: pickFirstText(rawMetadata.planId, body.planId, 'pro'),
  };
}

function createJourneyId(prefix) {
  return createTraceId(prefix).replace(/^trace_/, `${prefix}_`);
}

function appendQueryParam(url, key, value) {
  const normalized = normalizeNullableText(value);
  if (normalized) {
    url.searchParams.set(key, normalized);
  }
}

function appendVisitorSessionQueryParam(url, value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return;
  }

  if (url.searchParams.has('session_id')) {
    url.searchParams.set('visitor_session_id', normalized);
    return;
  }

  url.searchParams.set('session_id', normalized);
}

function restoreStripeCheckoutPlaceholder(urlString) {
  return String(urlString).replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}');
}

function buildCheckoutFallbackUrl(baseUrl, metadata = {}) {
  const url = new URL(baseUrl);
  appendQueryParam(url, 'utm_source', metadata.utmSource || metadata.source);
  appendQueryParam(url, 'utm_medium', metadata.utmMedium);
  appendQueryParam(url, 'utm_campaign', metadata.utmCampaign);
  appendQueryParam(url, 'utm_content', metadata.utmContent);
  appendQueryParam(url, 'utm_term', metadata.utmTerm);
  appendQueryParam(url, 'community', metadata.community);
  appendQueryParam(url, 'post_id', metadata.postId);
  appendQueryParam(url, 'comment_id', metadata.commentId);
  appendQueryParam(url, 'campaign_variant', metadata.campaignVariant);
  appendQueryParam(url, 'offer_code', metadata.offerCode);
  appendQueryParam(url, 'trace_id', metadata.traceId);
  appendQueryParam(url, 'acquisition_id', metadata.acquisitionId);
  appendQueryParam(url, 'visitor_id', metadata.visitorId);
  appendVisitorSessionQueryParam(url, metadata.sessionId);
  appendQueryParam(url, 'cta_id', metadata.ctaId);
  appendQueryParam(url, 'cta_placement', metadata.ctaPlacement);
  appendQueryParam(url, 'plan_id', metadata.planId);
  appendQueryParam(url, 'landing_path', metadata.landingPath);
  appendQueryParam(url, 'referrer_host', metadata.referrerHost);
  return restoreStripeCheckoutPlaceholder(url.toString());
}

function buildCheckoutBootstrapBody(parsed, req) {
  const params = parsed.searchParams;
  const traceId = pickFirstText(params.get('trace_id')) || createJourneyId('checkout');
  return {
    traceId,
    installId: pickFirstText(params.get('install_id')),
    acquisitionId: pickFirstText(params.get('acquisition_id')) || createJourneyId('acq'),
    visitorId: pickFirstText(params.get('visitor_id')) || createJourneyId('visitor'),
    sessionId: pickFirstText(params.get('visitor_session_id'), params.get('session_id')) || createJourneyId('session'),
    customerEmail: pickFirstText(params.get('customer_email')),
    source: pickFirstText(params.get('source'), params.get('utm_source'), 'website'),
    utmSource: pickFirstText(params.get('utm_source'), params.get('source'), 'website'),
    utmMedium: pickFirstText(params.get('utm_medium'), 'cta_button'),
    utmCampaign: pickFirstText(params.get('utm_campaign'), 'pro_pack'),
    utmContent: pickFirstText(params.get('utm_content')),
    utmTerm: pickFirstText(params.get('utm_term')),
    community: pickFirstText(params.get('community'), params.get('subreddit')),
    postId: pickFirstText(params.get('post_id')),
    commentId: pickFirstText(params.get('comment_id')),
    campaignVariant: pickFirstText(params.get('campaign_variant')),
    offerCode: pickFirstText(params.get('offer_code')),
    landingPath: pickFirstText(params.get('landing_path'), req.headers.referer ? '/' : '/'),
    referrerHost: pickFirstText(params.get('referrer_host')),
    ctaId: pickFirstText(params.get('cta_id'), 'pricing_pro'),
    ctaPlacement: pickFirstText(params.get('cta_placement'), 'pricing'),
    planId: pickFirstText(params.get('plan_id'), 'pro'),
    metadata: {
      referrer: pickFirstText(params.get('referrer'), req.headers.referer, req.headers.referrer),
      landingPath: pickFirstText(params.get('landing_path'), '/'),
      referrerHost: pickFirstText(params.get('referrer_host')),
    },
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

function sendHtml(res, statusCode, html, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...extraHeaders,
  });
  res.end(html);
}

function getPublicBillingHeaders(traceId = '') {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-RLHF-Trace-Id',
    'Access-Control-Expose-Headers': 'X-RLHF-Trace-Id',
  };
  if (traceId) {
    headers['X-RLHF-Trace-Id'] = traceId;
  }
  return headers;
}

function sendPublicBillingPreflight(res) {
  res.writeHead(204, {
    ...getPublicBillingHeaders(),
    'Access-Control-Max-Age': '86400',
    'Content-Length': '0',
  });
  res.end();
}

function getPublicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim() || 'localhost';
  return `${proto}://${host}`;
}

function wantsJson(req, parsed) {
  if (parsed.searchParams.get('format') === 'json') {
    return true;
  }

  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

function fillTemplate(template, replacements) {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(String(value));
  }
  return output;
}

function loadLandingPageHtml(runtimeConfig) {
  const template = fs.readFileSync(LANDING_PAGE_PATH, 'utf-8');
  return fillTemplate(template, {
    '__PACKAGE_VERSION__': pkg.version,
    '__APP_ORIGIN__': runtimeConfig.appOrigin,
    '__CHECKOUT_ENDPOINT__': runtimeConfig.checkoutEndpoint,
    '__CHECKOUT_FALLBACK_URL__': runtimeConfig.checkoutFallbackUrl,
    '__PRO_PRICE_DOLLARS__': runtimeConfig.proPriceDollars,
    '__PRO_PRICE_LABEL__': runtimeConfig.proPriceLabel,
    '__VERIFICATION_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/VERIFICATION_EVIDENCE.md',
    '__COMPATIBILITY_REPORT_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/proof/compatibility/report.json',
    '__AUTOMATION_REPORT_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/proof/automation/report.json',
    '__GTM_PLAN_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md',
    '__GITHUB_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
  });
}

function renderRobotsTxt(runtimeConfig) {
  return [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${runtimeConfig.appOrigin}/sitemap.xml`,
  ].join('\n');
}

function renderSitemapXml(runtimeConfig) {
  const homeUrl = `${runtimeConfig.appOrigin}/`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${homeUrl}</loc>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '</urlset>',
  ].join('\n');
}

function renderCheckoutSuccessPage(runtimeConfig) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Context Gateway Activated</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1d1b18;
      --muted: #625a4d;
      --line: #d7cfbf;
      --accent: #b85c2d;
      --accent-dark: #8f451f;
      --card: #fffdf9;
      --success: #2f7d4b;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: linear-gradient(180deg, #fcfaf5 0%, var(--bg) 100%);
      color: var(--ink);
      line-height: 1.6;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 20px 80px;
    }
    .eyebrow {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 999px;
      background: #efe3d5;
      color: var(--accent-dark);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: clamp(32px, 6vw, 56px);
      line-height: 1.05;
      letter-spacing: -0.04em;
    }
    p.lead {
      max-width: 700px;
      font-size: 19px;
      color: var(--muted);
      margin: 0 0 28px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      margin-top: 22px;
      box-shadow: 0 10px 30px rgba(29, 27, 24, 0.08);
    }
    .status {
      color: var(--success);
      font-weight: 700;
      margin-bottom: 8px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #171411;
      color: #f5efe6;
      padding: 16px;
      border-radius: 12px;
      overflow-x: auto;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    a.button {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
    }
    a.button.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <span class="eyebrow">Context Gateway</span>
    <h1>Your hosted API key is ready.</h1>
    <p class="lead">This page verifies your Stripe session, provisions the key if needed, and gives you a copy-paste onboarding snippet for the hosted API.</p>

    <div class="card">
      <div class="status" id="status">Verifying payment and provisioning your key...</div>
      <p class="muted" id="summary">Do not close this tab until the key appears.</p>
      <pre id="key-block">Waiting for checkout session...</pre>
    </div>

    <div class="card">
      <h2>Next steps</h2>
      <ol>
        <li>Copy the environment block below into your workflow runner.</li>
        <li>Use the curl example to confirm the hosted API captures an event.</li>
        <li>Keep your key private and rotate by repurchasing or contacting support if needed.</li>
      </ol>
      <pre id="env-block">Waiting for provisioning...</pre>
      <pre id="curl-block">Waiting for provisioning...</pre>
      <div class="actions">
        <a class="button" href="/">Back to landing page</a>
        <a class="button secondary" href="https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/VERIFICATION_EVIDENCE.md" target="_blank" rel="noreferrer">Verification evidence</a>
      </div>
    </div>
  </main>

  <script>
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const traceId = params.get('trace_id');
    const sessionEndpoint = ${JSON.stringify(runtimeConfig.sessionEndpoint)};
    const statusEl = document.getElementById('status');
    const summaryEl = document.getElementById('summary');
    const keyBlock = document.getElementById('key-block');
    const envBlock = document.getElementById('env-block');
    const curlBlock = document.getElementById('curl-block');

    async function run() {
      if (!sessionId) {
        statusEl.textContent = 'Missing checkout session.';
        summaryEl.textContent = 'Open the landing page and start a new checkout.';
        keyBlock.textContent = 'No session_id was provided in the URL.';
        return;
      }

      try {
        const sessionLookupUrl = sessionEndpoint
          + '?sessionId=' + encodeURIComponent(sessionId)
          + (traceId ? '&traceId=' + encodeURIComponent(traceId) : '');
        const res = await fetch(sessionLookupUrl);
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || 'Unable to load checkout session.');
        }

        if (!body.paid) {
          statusEl.textContent = 'Payment is still processing.';
          summaryEl.textContent = 'Refresh this page in a few seconds if Stripe has already confirmed payment.';
          keyBlock.textContent = JSON.stringify(body, null, 2);
          return;
        }

        statusEl.textContent = 'Context Gateway activated.';
        const resolvedTraceId = body.traceId || traceId || '';
        summaryEl.textContent = resolvedTraceId
          ? 'Your API key is ready. Copy the snippets below into your workflow project. Trace: ' + resolvedTraceId + '.'
          : 'Your API key is ready. Copy the snippets below into your workflow project.';
        keyBlock.textContent = body.apiKey || 'Provisioned, but no key was returned.';
        envBlock.textContent = body.nextSteps && body.nextSteps.env ? body.nextSteps.env : 'Environment snippet unavailable.';
        curlBlock.textContent = body.nextSteps && body.nextSteps.curl ? body.nextSteps.curl : 'curl snippet unavailable.';
      } catch (err) {
        statusEl.textContent = 'Provisioning lookup failed.';
        summaryEl.textContent = traceId
          ? 'You can retry this page. If it keeps failing, inspect the hosted API logs with trace ' + traceId + '.'
          : 'You can retry this page. If it keeps failing, inspect the hosted API logs.';
        keyBlock.textContent = err && err.message ? err.message : 'Unknown error';
      }
    }

    run();
  </script>
</body>
</html>`;
}

function renderCheckoutCancelledPage(runtimeConfig) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checkout Cancelled</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1d1b18;
      --muted: #625a4d;
      --line: #d7cfbf;
      --accent: #b85c2d;
      --surface: #fffdf9;
    }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 64px 20px 80px;
    }
    h1 {
      font-size: clamp(32px, 6vw, 52px);
      line-height: 1.05;
      margin: 0 0 14px;
    }
    p {
      font-size: 18px;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 20px;
      margin-top: 18px;
    }
    .reason-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    button,
    a {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
      border: 0;
      cursor: pointer;
      font-family: inherit;
      font-size: 15px;
    }
    button.secondary,
    a.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    textarea {
      width: 100%;
      min-height: 88px;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px;
      font: inherit;
      resize: vertical;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    .note {
      font-size: 14px;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Checkout cancelled.</h1>
    <p>No charge was made. You can return to the landing page and restart checkout whenever you are ready.</p>
    <div class="card">
      <h2>What stopped you?</h2>
      <p>Pick the closest reason. This writes directly into the first-party telemetry stream so we can fix the real blocker instead of guessing.</p>
      <div class="reason-grid">
        <button type="button" data-reason="too_expensive">Too expensive</button>
        <button type="button" data-reason="not_ready">Just researching</button>
        <button type="button" data-reason="need_team_features">Need team workflow features</button>
        <button type="button" data-reason="need_more_proof">Need more proof or trust</button>
        <button type="button" data-reason="prefer_oss">Sticking with OSS only</button>
        <button type="button" data-reason="integration_unclear">Integration is unclear</button>
      </div>
      <div style="margin-top:16px;">
        <label for="buyer-note">Anything specific?</label>
        <textarea id="buyer-note" placeholder="Optional detail: team size, workflow, blocker, competitor, or missing feature."></textarea>
      </div>
      <div class="actions">
        <button type="button" id="submit-reason">Send feedback</button>
        <a id="retry-checkout" href="/checkout/pro" class="secondary">Try checkout again</a>
        <a href="${runtimeConfig.appOrigin}" class="secondary">Return to Context Gateway</a>
      </div>
      <p class="note" id="status">No feedback sent yet.</p>
    </div>
    <script>
      (function () {
        const params = new URLSearchParams(window.location.search);
        const statusEl = document.getElementById('status');
        const noteEl = document.getElementById('buyer-note');
        const retryLink = document.getElementById('retry-checkout');
        let selectedReason = null;

        function sendTelemetry(eventType, extra) {
          const payload = Object.assign({
            eventType: eventType,
            clientType: 'web',
            traceId: params.get('trace_id'),
            acquisitionId: params.get('acquisition_id'),
            visitorId: params.get('visitor_id'),
            sessionId: params.get('visitor_session_id') || params.get('session_id'),
            installId: params.get('install_id'),
            source: params.get('utm_source') || params.get('source') || 'website',
            utmSource: params.get('utm_source') || params.get('source') || 'website',
            utmMedium: params.get('utm_medium') || 'checkout_cancel',
            utmCampaign: params.get('utm_campaign') || 'pro_pack',
            utmContent: params.get('utm_content'),
            utmTerm: params.get('utm_term'),
            community: params.get('community') || params.get('subreddit'),
            postId: params.get('post_id'),
            commentId: params.get('comment_id'),
            campaignVariant: params.get('campaign_variant'),
            offerCode: params.get('offer_code'),
            ctaId: params.get('cta_id') || 'pricing_pro',
            ctaPlacement: params.get('cta_placement') || 'pricing',
            planId: params.get('plan_id') || 'pro',
            page: window.location.pathname,
            landingPath: params.get('landing_path') || '/',
            referrerHost: params.get('referrer_host'),
            referrer: document.referrer || null
          }, extra || {});

          const body = JSON.stringify(payload);
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/v1/telemetry/ping', new Blob([body], { type: 'application/json' }));
            return;
          }
          fetch('/v1/telemetry/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body,
            keepalive: true
          }).catch(function () {});
        }

        const retryUrl = new URL(retryLink.href, window.location.origin);
        ['trace_id', 'acquisition_id', 'visitor_id', 'session_id', 'visitor_session_id', 'install_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'community', 'post_id', 'comment_id', 'campaign_variant', 'offer_code', 'cta_id', 'cta_placement', 'plan_id', 'landing_path', 'referrer_host'].forEach(function (key) {
          const value = params.get(key);
          if (value) retryUrl.searchParams.set(key, value);
        });
        retryLink.href = retryUrl.toString();

        sendTelemetry('checkout_cancelled');

        document.querySelectorAll('[data-reason]').forEach(function (button) {
          button.addEventListener('click', function () {
            selectedReason = button.getAttribute('data-reason');
            statusEl.textContent = 'Selected reason: ' + selectedReason.replaceAll('_', ' ') + '.';
          });
        });

        document.getElementById('submit-reason').addEventListener('click', function () {
          sendTelemetry('reason_not_buying', {
            reasonCode: selectedReason || 'unspecified',
            reasonText: noteEl.value || null
          });
          statusEl.textContent = selectedReason
            ? 'Feedback saved: ' + selectedReason.replaceAll('_', ' ') + '.'
            : 'Feedback saved.';
        });
      }());
    </script>
  </main>
</body>
</html>`;
}

function parseJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(createHttpError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function parseOptionalObject(input, name) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createHttpError(400, `${name} must be an object`);
    }
    return parsed;
  }
  throw createHttpError(400, `${name} must be an object`);
}

function getExpectedApiKey() {
  if (process.env.RLHF_ALLOW_INSECURE === 'true') return null;
  const configured = process.env.RLHF_API_KEY;
  if (!configured) {
    throw new Error('RLHF_API_KEY is required unless RLHF_ALLOW_INSECURE=true');
  }
  return configured;
}

function isAuthorized(req, expected) {
  if (!expected) return true;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  // Check static RLHF_API_KEY first
  if (token === expected) return true;

  // Also accept any valid provisioned billing key
  if (token) {
    const result = validateApiKey(token);
    return result.valid === true;
  }

  return false;
}

/**
 * Extract the Bearer token from a request (returns '' if absent).
 */
function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/**
 * Admin-only guard for static RLHF_API_KEY.
 * Billing keys are intentionally excluded from admin actions.
 */
function isStaticAdminAuthorized(req, expected) {
  if (!expected) return true;
  return extractBearerToken(req) === expected;
}

function extractTags(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveSafePath(inputPath, { mustExist = false } = {}) {
  const allowExternal = process.env.RLHF_ALLOW_EXTERNAL_PATHS === 'true';
  const resolved = path.resolve(String(inputPath || ''));
  const SAFE_DATA_DIR = getSafeDataDir();
  const inSafeRoot = resolved === SAFE_DATA_DIR || resolved.startsWith(`${SAFE_DATA_DIR}${path.sep}`);

  if (!allowExternal && !inSafeRoot) {
    throw createHttpError(400, `Path must stay within ${SAFE_DATA_DIR}`);
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw createHttpError(400, `Path does not exist: ${resolved}`);
  }

  return resolved;
}

function createApiServer() {
  const expectedApiKey = getExpectedApiKey();

  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;
    const publicOrigin = getPublicOrigin(req);
    const hostedConfig = resolveHostedBillingConfig({ requestOrigin: publicOrigin });

    // Public MCP endpoint — responds to Smithery registry scanning and MCP initialize
    // The initialize handshake is unauthenticated; subsequent tool calls require Bearer auth
    if (pathname === '/mcp') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const msg = JSON.parse(body);
            if (msg.method === 'initialize') {
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'mcp-memory-gateway', version: pkg.version },
                },
              });
            } else if (msg.method === 'notifications/initialized') {
              res.writeHead(204);
              res.end();
            } else if (msg.method === 'tools/list') {
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  tools: getPublicMcpTools(),
                },
              });
            } else {
              // All other tool calls require auth — return method not found for unauthenticated
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32601, message: 'Method requires authentication. Provide Bearer token.' },
              });
            }
          } catch (_e) {
            sendProblem(res, {
              type: PROBLEM_TYPES.INVALID_JSON,
              title: 'Invalid JSON',
              status: 400,
              detail: 'The request body could not be parsed as valid JSON.',
            });
          }
        });
        return;
      }
      if (req.method === 'GET') {
        // SSE upgrade or capability probe
        sendJson(res, 200, {
          name: 'mcp-memory-gateway',
          version: pkg.version,
          transport: ['streamable-http', 'stdio'],
        });
        return;
      }
    }

    // Public endpoints — no auth required
    if (req.method === 'GET' && pathname === '/robots.txt') {
      sendText(res, 200, renderRobotsTxt(hostedConfig), {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/sitemap.xml') {
      sendText(res, 200, renderSitemapXml(hostedConfig), {
        'Content-Type': 'application/xml; charset=utf-8',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      if (wantsJson(req, parsed)) {
        sendJson(res, 200, {
          name: 'mcp-memory-gateway',
          version: pkg.version,
          status: 'ok',
          docs: 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
          endpoints: ['/health', '/v1/feedback/capture', '/v1/feedback/stats', '/v1/dpo/export', '/v1/analytics/databricks/export'],
        });
        return;
      }

      try {
        sendHtml(res, 200, loadLandingPageHtml(hostedConfig));
      } catch (err) {
        sendText(res, 500, err.message || 'Landing page unavailable');
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/checkout/pro') {
      const { FEEDBACK_DIR } = getFeedbackPaths();
      const bootstrapBody = buildCheckoutBootstrapBody(parsed, req);
      const traceId = bootstrapBody.traceId || createJourneyId('checkout');
      const analyticsMetadata = buildCheckoutAttributionMetadata(bootstrapBody, req, traceId);

      appendTelemetryPing(FEEDBACK_DIR, {
        eventType: 'checkout_bootstrap',
        clientType: 'web',
        installId: bootstrapBody.installId,
        acquisitionId: analyticsMetadata.acquisitionId,
        visitorId: analyticsMetadata.visitorId,
        sessionId: analyticsMetadata.sessionId,
        traceId,
        source: analyticsMetadata.source,
        utmSource: analyticsMetadata.utmSource,
        utmMedium: analyticsMetadata.utmMedium,
        utmCampaign: analyticsMetadata.utmCampaign,
        utmContent: analyticsMetadata.utmContent,
        utmTerm: analyticsMetadata.utmTerm,
        community: analyticsMetadata.community,
        postId: analyticsMetadata.postId,
        commentId: analyticsMetadata.commentId,
        campaignVariant: analyticsMetadata.campaignVariant,
        offerCode: analyticsMetadata.offerCode,
        landingPath: analyticsMetadata.landingPath,
        page: '/checkout/pro',
        ctaId: analyticsMetadata.ctaId,
        ctaPlacement: analyticsMetadata.ctaPlacement,
        planId: analyticsMetadata.planId,
        referrer: analyticsMetadata.referrer,
        referrerHost: analyticsMetadata.referrerHost,
      }, req.headers);

      try {
        const result = await createCheckoutSession({
          successUrl: buildCheckoutFallbackUrl(
            buildHostedSuccessUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          cancelUrl: buildCheckoutFallbackUrl(
            buildHostedCancelUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          customerEmail: bootstrapBody.customerEmail,
          installId: bootstrapBody.installId,
          traceId,
          metadata: analyticsMetadata,
        });

        if (result.url) {
          res.writeHead(302, { Location: result.url });
          res.end();
          return;
        }

        const successUrl = new URL('/success', hostedConfig.appOrigin);
        successUrl.searchParams.set('session_id', result.sessionId);
        successUrl.searchParams.set('trace_id', traceId);
        appendQueryParam(successUrl, 'acquisition_id', analyticsMetadata.acquisitionId);
        appendQueryParam(successUrl, 'visitor_id', analyticsMetadata.visitorId);
        appendVisitorSessionQueryParam(successUrl, analyticsMetadata.sessionId);
        appendQueryParam(successUrl, 'install_id', bootstrapBody.installId);
        appendQueryParam(successUrl, 'utm_source', analyticsMetadata.utmSource);
        appendQueryParam(successUrl, 'utm_medium', analyticsMetadata.utmMedium);
        appendQueryParam(successUrl, 'utm_campaign', analyticsMetadata.utmCampaign);
        appendQueryParam(successUrl, 'utm_content', analyticsMetadata.utmContent);
        appendQueryParam(successUrl, 'utm_term', analyticsMetadata.utmTerm);
        appendQueryParam(successUrl, 'community', analyticsMetadata.community);
        appendQueryParam(successUrl, 'post_id', analyticsMetadata.postId);
        appendQueryParam(successUrl, 'comment_id', analyticsMetadata.commentId);
        appendQueryParam(successUrl, 'campaign_variant', analyticsMetadata.campaignVariant);
        appendQueryParam(successUrl, 'offer_code', analyticsMetadata.offerCode);
        appendQueryParam(successUrl, 'cta_id', analyticsMetadata.ctaId);
        appendQueryParam(successUrl, 'cta_placement', analyticsMetadata.ctaPlacement);
        appendQueryParam(successUrl, 'plan_id', analyticsMetadata.planId);
        appendQueryParam(successUrl, 'landing_path', analyticsMetadata.landingPath);
        appendQueryParam(successUrl, 'referrer_host', analyticsMetadata.referrerHost);
        res.writeHead(302, { Location: successUrl.toString() });
        res.end();
      } catch (err) {
        appendTelemetryPing(FEEDBACK_DIR, {
          eventType: 'checkout_api_failed',
          clientType: 'web',
          installId: bootstrapBody.installId,
          acquisitionId: analyticsMetadata.acquisitionId,
          visitorId: analyticsMetadata.visitorId,
          sessionId: analyticsMetadata.sessionId,
          traceId,
          source: analyticsMetadata.source,
          utmSource: analyticsMetadata.utmSource,
          utmMedium: analyticsMetadata.utmMedium,
          utmCampaign: analyticsMetadata.utmCampaign,
          utmContent: analyticsMetadata.utmContent,
          utmTerm: analyticsMetadata.utmTerm,
          landingPath: analyticsMetadata.landingPath,
          page: '/checkout/pro',
          ctaId: analyticsMetadata.ctaId,
          ctaPlacement: analyticsMetadata.ctaPlacement,
          planId: analyticsMetadata.planId,
          referrer: analyticsMetadata.referrer,
          referrerHost: analyticsMetadata.referrerHost,
          failureCode: err && err.message ? err.message : 'checkout_bootstrap_failed',
          httpStatus: err && err.statusCode ? err.statusCode : null,
        }, req.headers);
        res.writeHead(302, {
          Location: buildCheckoutFallbackUrl(hostedConfig.checkoutFallbackUrl, analyticsMetadata),
        });
        res.end();
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/success') {
      sendHtml(res, 200, renderCheckoutSuccessPage(hostedConfig));
      return;
    }

    if (req.method === 'GET' && pathname === '/cancel') {
      sendHtml(res, 200, renderCheckoutCancelledPage(hostedConfig));
      return;
    }

    if (req.method === 'GET' && pathname === '/.well-known/mcp/server-card.json') {
      sendJson(res, 200, {
        serverInfo: {
          name: 'mcp-memory-gateway',
          version: pkg.version,
        },
        name: 'mcp-memory-gateway',
        description: 'RLHF feedback loop for AI agents. Capture feedback, block mistakes, export DPO data, and warehouse analytics bundles.',
        version: pkg.version,
        tools: getServerCardTools(),
        repository: 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
        homepage: hostedConfig.appOrigin,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        version: pkg.version,
        uptime: process.uptime(),
        deployment: {
          appOrigin: hostedConfig.appOrigin,
          billingApiBaseUrl: hostedConfig.billingApiBaseUrl,
        },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH } = getFeedbackPaths();
      sendJson(res, 200, {
        status: 'ok',
        feedbackLogPath: FEEDBACK_LOG_PATH,
        memoryLogPath: MEMORY_LOG_PATH,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/telemetry/ping') {
      const { FEEDBACK_DIR } = getFeedbackPaths();
      try {
        const payload = await parseJsonBody(req, 16 * 1024);
        appendTelemetryPing(FEEDBACK_DIR, payload, req.headers);
      } catch (err) {
        try {
          appendDiagnosticRecord({
            source: 'telemetry_ingest',
            step: 'telemetry_ingest',
            context: 'best-effort telemetry ingest failed',
            metadata: {
              path: pathname,
              method: req.method,
              reason: err && err.statusCode && err.statusCode < 500 ? 'invalid_payload' : 'write_failed',
              error: err && err.message ? err.message : 'unknown_error',
            },
            diagnosis: {
              diagnosed: true,
              rootCauseCategory: err && err.statusCode && err.statusCode < 500 ? 'invalid_invocation' : 'system_failure',
              criticalFailureStep: 'telemetry_ingest',
              violations: [{
                constraintId: 'telemetry:ingest',
                message: 'Telemetry ping could not be processed.',
              }],
              evidence: [err && err.message ? err.message : 'unknown_error'],
            },
          });
        } catch (_) {
          // Telemetry is best-effort and must never fail the caller.
        }
      }
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Length': '0',
      });
      res.end();
      return;
    }

    if (req.method === 'OPTIONS' && pathname === '/v1/telemetry/ping') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // Public OpenAPI spec — no auth required (needed for ChatGPT GPT Store import)
    if (req.method === 'GET' && pathname === '/openapi.json') {
      const specPath = path.join(__dirname, '../../adapters/chatgpt/openapi.yaml');
      try {
        const yaml = fs.readFileSync(specPath, 'utf8');
        // Convert YAML to JSON inline (simple key:value conversion via js-yaml if available, else serve as-is)
        try {
          const jsYaml = require('js-yaml');
          const spec = jsYaml.load(yaml);
          // Override server URL to current deployment
          if (spec.servers && spec.servers[0]) {
            spec.servers[0].url = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(spec, null, 2));
        } catch {
          res.writeHead(200, { 'Content-Type': 'text/yaml', 'Access-Control-Allow-Origin': '*' });
          res.end(yaml);
        }
      } catch {
        sendProblem(res, {
          type: PROBLEM_TYPES.NOT_FOUND,
          title: 'Not Found',
          status: 404,
          detail: 'OpenAPI spec not found.',
        });
      }
      return;
    }

    // Public privacy policy — required for GPT Store and marketplace listings
    if (req.method === 'GET' && pathname === '/privacy') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Privacy Policy — MCP Memory Gateway</title></head><body>
<h1>Privacy Policy</h1>
<p><strong>MCP Memory Gateway</strong> (npm: mcp-memory-gateway)</p>
<p>Last updated: 2026-03-11</p>
<h2>Data Collection</h2>
<p>The self-hosted version stores all data locally on your machine. No data is sent to external servers.</p>
<p>The hosted tier (rlhf-feedback-loop-production.up.railway.app) stores feedback signals and memory entries associated with your API key. We do not sell or share your data with third parties.</p>
<h2>Data Stored</h2><ul>
<li>Feedback signals (thumbs up/down) with context you provide</li>
<li>Promoted memory entries</li>
<li>Prevention rules generated from your feedback</li>
</ul>
<h2>Data Deletion</h2>
<p>Contact igor.ganapolsky@gmail.com to request deletion of your data.</p>
<h2>Contact</h2><p>igor.ganapolsky@gmail.com</p>
<p><a href="https://github.com/IgorGanapolsky/mcp-memory-gateway">GitHub</a></p>
</body></html>`);
      return;
    }

    // Stripe webhook is unauthenticated — uses HMAC signature verification instead
    if (req.method === 'POST' && pathname === '/v1/billing/webhook') {
      try {
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });

        const sig = req.headers['stripe-signature'] || '';
        if (!verifyWebhookSignature(rawBody, sig)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: 'The webhook signature could not be verified.',
          });
          return;
        }

        const result = await handleWebhook(rawBody, sig);
        if (result && result.reason === 'invalid_signature') {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: result.error || 'The webhook signature could not be verified.',
          });
          return;
        }
        sendJson(res, 200, result);

      } catch (err) {
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message,
        });
      }
      return;
    }

    // GitHub Marketplace webhook
    if (req.method === 'POST' && pathname === '/v1/billing/github-webhook') {
      try {
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });

        const sig = req.headers['x-hub-signature-256'] || '';
        if (!verifyGithubWebhookSignature(rawBody, sig)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: 'The webhook signature could not be verified.',
          });
          return;
        }

        let event;
        try {
          event = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          sendProblem(res, {
            type: PROBLEM_TYPES.INVALID_JSON,
            title: 'Invalid JSON',
            status: 400,
            detail: 'Invalid JSON in webhook body.',
          });
          return;
        }

        const result = handleGithubWebhook(event);
        sendJson(res, 200, result);
      } catch (err) {
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message,
        });
      }
      return;
    }

    if (req.method === 'OPTIONS' && (pathname === '/v1/billing/checkout' || pathname === '/v1/billing/session')) {
      sendPublicBillingPreflight(res);
      return;
    }

    // Public checkout session creation for top-of-funnel acquisition.
    if (req.method === 'POST' && pathname === '/v1/billing/checkout') {
      try {
        const body = await parseJsonBody(req);
        if (body.oneTime === true) {
          throw createHttpError(400, 'oneTime checkout is no longer supported. The public self-serve offer is recurring Pro only.');
        }
        const traceId = body.traceId || createTraceId('checkout');
        const responseHeaders = getPublicBillingHeaders(traceId);
        const analyticsMetadata = buildCheckoutAttributionMetadata(body, req, traceId);
        
        const result = await createCheckoutSession({
          successUrl: body.successUrl || buildCheckoutFallbackUrl(
            buildHostedSuccessUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          cancelUrl: body.cancelUrl || buildCheckoutFallbackUrl(
            buildHostedCancelUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          customerEmail: body.customerEmail,
          installId: body.installId,
          traceId,
          metadata: analyticsMetadata,
        });
        sendJson(res, 200, {
          ...result,
          traceId: result.traceId || traceId,
          price: hostedConfig.proPriceDollars,
          type: 'subscription',
        }, responseHeaders);
      } catch (err) {
        const fallbackTraceId = createTraceId('checkout_error');
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message || 'An unexpected error occurred.',
        }, getPublicBillingHeaders(fallbackTraceId));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/billing/session') {
      try {
        const sessionId = parsed.searchParams.get('sessionId');
        const requestedTraceId = parsed.searchParams.get('traceId') || '';
        if (!sessionId) {
          throw createHttpError(400, 'sessionId is required');
        }

        const result = await getCheckoutSessionStatus(sessionId);
        if (!result.found) {
          throw createHttpError(404, 'Checkout session not found');
        }

        const resolvedTraceId = result.traceId || requestedTraceId;

        sendJson(res, 200, {
          ...result,
          traceId: resolvedTraceId || null,
          appOrigin: hostedConfig.appOrigin,
          apiBaseUrl: hostedConfig.billingApiBaseUrl,
          nextSteps: {
            env: `RLHF_API_KEY=${result.apiKey || ''}\nRLHF_API_BASE_URL=${hostedConfig.billingApiBaseUrl}`,
            curl: `curl -X POST ${hostedConfig.billingApiBaseUrl}/v1/feedback/capture \\\n  -H 'Authorization: Bearer ${result.apiKey || ''}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"signal":"down","context":"example","whatWentWrong":"example","whatToChange":"example"}'`,
          },
        }, getPublicBillingHeaders(resolvedTraceId));
      } catch (err) {
        const requestedTraceId = parsed.searchParams.get('traceId') || '';
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message || 'An unexpected error occurred.',
        }, getPublicBillingHeaders(requestedTraceId));
      }
      return;
    }

    if (!isAuthorized(req, expectedApiKey)) {
      sendProblem(res, {
        type: PROBLEM_TYPES.UNAUTHORIZED,
        title: 'Unauthorized',
        status: 401,
        detail: 'A valid API key is required to access this endpoint.',
      });
      return;
    }

    // Usage metering — record request for billing keys (not static RLHF_API_KEY)
    const _token = extractBearerToken(req);
    if (_token && _token !== expectedApiKey) {
      recordUsage(_token);
    }

    try {
      if (req.method === 'GET' && pathname === '/v1/feedback/stats') {
        sendJson(res, 200, analyzeFeedback());
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/intents/catalog') {
        const mcpProfile = parsed.searchParams.get('mcpProfile') || undefined;
        const bundleId = parsed.searchParams.get('bundleId') || undefined;
        const partnerProfile = parsed.searchParams.get('partnerProfile') || undefined;
        try {
          const catalog = listIntents({ mcpProfile, bundleId, partnerProfile });
          sendJson(res, 200, catalog);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid intent catalog request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/intents/plan') {
        const body = await parseJsonBody(req);
        try {
          const plan = planIntent({
            intentId: body.intentId,
            context: body.context || '',
            mcpProfile: body.mcpProfile,
            bundleId: body.bundleId,
            partnerProfile: body.partnerProfile,
            delegationMode: body.delegationMode,
            approved: body.approved === true,
            repoPath: body.repoPath,
          });
          sendJson(res, 200, plan);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid intent plan request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/handoffs/start') {
        const body = await parseJsonBody(req);
        try {
          const plan = planIntent({
            intentId: body.intentId,
            context: body.context || '',
            mcpProfile: body.mcpProfile,
            bundleId: body.bundleId,
            partnerProfile: body.partnerProfile,
            delegationMode: 'sequential',
            approved: body.approved === true,
            repoPath: body.repoPath,
          });
          const result = startHandoff({
            plan,
            context: body.context || '',
            mcpProfile: body.mcpProfile || plan.mcpProfile,
            partnerProfile: body.partnerProfile || plan.partnerProfile,
            repoPath: body.repoPath,
            delegateProfile: body.delegateProfile || null,
            plannedChecks: Array.isArray(body.plannedChecks) ? body.plannedChecks : [],
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid handoff start request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/handoffs/complete') {
        const body = await parseJsonBody(req);
        try {
          const result = completeHandoff({
            handoffId: body.handoffId,
            outcome: body.outcome,
            resultContext: body.resultContext || '',
            attempts: body.attempts,
            violationCount: body.violationCount,
            tokenEstimate: body.tokenEstimate,
            latencyMs: body.latencyMs,
            summary: body.summary || '',
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid handoff completion request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/gates/constraint') {
        const body = await parseJsonBody(req);
        if (!body.key || body.value === undefined) {
          throw createHttpError(400, 'Missing key or value');
        }
        const result = setConstraint(body.key, body.value);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/gates/constraints') {
        sendJson(res, 200, loadConstraints());
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/feedback/summary') {
        const recent = Number(parsed.searchParams.get('recent') || 20);
        const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20);
        sendJson(res, 200, { summary });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/capture') {
        const captureLimit = checkLimit('capture_feedback');
        if (!captureLimit.allowed) {
          sendProblem(res, {
            type: PROBLEM_TYPES.RATE_LIMIT,
            title: 'Free tier limit reached',
            status: 429,
            detail: RATE_LIMIT_MESSAGE,
          });
          return;
        }
        const body = await parseJsonBody(req);
        const result = captureFeedback({
          signal: body.signal,
          context: body.context || '',
          whatWentWrong: body.whatWentWrong,
          whatToChange: body.whatToChange,
          whatWorked: body.whatWorked,
          reasoning: body.reasoning,
          visualEvidence: body.visualEvidence,
          packId: body.packId,
          utilityScore: body.utilityScore,
          rubricScores: body.rubricScores,
          guardrails: body.guardrails,
          tags: extractTags(body.tags),
          skill: body.skill,
        });
        const code = result.accepted ? 200 : 422;
        sendJson(res, code, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/rules') {
        const body = await parseJsonBody(req);
        const minOccurrences = Number(body.minOccurrences || 2);
        const outputPath = body.outputPath ? resolveSafePath(body.outputPath) : undefined;
        const result = writePreventionRules(outputPath, Number.isFinite(minOccurrences) ? minOccurrences : 2);
        sendJson(res, 200, {
          path: result.path,
          markdown: result.markdown,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/skills/generate') {
        const body = await parseJsonBody(req);
        const minOccurrences = Number(body.minOccurrences || 3);
        const tags = Array.isArray(body.tags) ? body.tags : [];
        let skills = generateSkills({
          minClusterSize: Number.isFinite(minOccurrences) ? minOccurrences : 3,
        });
        if (tags.length > 0) {
          const tagSet = new Set(tags.map(t => t.toLowerCase()));
          skills = skills.filter(s => (s.tags || []).some(t => tagSet.has(t.toLowerCase())));
        }
        sendJson(res, 200, { skills });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/dpo/export') {
        const body = await parseJsonBody(req);
        let memories = [];

        if (body.inputPath) {
          const safeInputPath = resolveSafePath(body.inputPath, { mustExist: true });
          const raw = fs.readFileSync(safeInputPath, 'utf-8');
          const parsedMemories = JSON.parse(raw);
          memories = Array.isArray(parsedMemories) ? parsedMemories : parsedMemories.memories || [];
        } else {
          const localPath = body.memoryLogPath
            ? resolveSafePath(body.memoryLogPath, { mustExist: true })
            : DEFAULT_LOCAL_MEMORY_LOG;
          memories = readJSONL(localPath);
        }

        const result = exportDpoFromMemories(memories);
        if (body.outputPath) {
          const safeOutputPath = resolveSafePath(body.outputPath);
          fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });
          fs.writeFileSync(safeOutputPath, result.jsonl);
        }

        sendJson(res, 200, {
          pairs: result.pairs.length,
          errors: result.errors.length,
          learnings: result.learnings.length,
          unpairedErrors: result.unpairedErrors.length,
          unpairedLearnings: result.unpairedLearnings.length,
          outputPath: body.outputPath ? resolveSafePath(body.outputPath) : null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/analytics/databricks/export') {
        const body = await parseJsonBody(req);
        const outputPath = body.outputPath ? resolveSafePath(body.outputPath) : undefined;
        const result = exportDatabricksBundle(undefined, outputPath);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/construct') {
        const body = await parseJsonBody(req);
        ensureContextFs();
        let namespaces = [];
        try {
          namespaces = normalizeNamespaces(Array.isArray(body.namespaces) ? body.namespaces : []);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid namespaces');
        }
        const pack = constructContextPack({
          query: body.query || '',
          maxItems: Number(body.maxItems || 8),
          maxChars: Number(body.maxChars || 6000),
          namespaces,
        });
        sendJson(res, 200, pack);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/evaluate') {
        const body = await parseJsonBody(req);
        if (!body.packId || !body.outcome) {
          throw createHttpError(400, 'packId and outcome are required');
        }
        let rubricEvaluation = null;
        if (body.rubricScores != null || body.guardrails != null) {
          try {
            rubricEvaluation = buildRubricEvaluation({
              rubricScores: body.rubricScores,
              guardrails: parseOptionalObject(body.guardrails, 'guardrails'),
            });
          } catch (err) {
            throw createHttpError(400, `Invalid rubric payload: ${err.message}`);
          }
        }
        const evaluation = evaluateContextPack({
          packId: body.packId,
          outcome: body.outcome,
          signal: body.signal || null,
          notes: body.notes || '',
          rubricEvaluation,
        });
        sendJson(res, 200, evaluation);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/context/provenance') {
        const limit = Number(parsed.searchParams.get('limit') || 50);
        const events = getProvenance(Number.isFinite(limit) ? limit : 50);
        sendJson(res, 200, { events });
        return;
      }


      // ----------------------------------------------------------------
      // Quality / ACO routes
      // ----------------------------------------------------------------

      if (req.method === 'GET' && pathname === '/v1/quality/scores') {
        const modelPath = path.join(getSafeDataDir(), 'feedback_model.json');
        const model = loadModel(modelPath);
        const reliability = getReliability(model);
        const category = parsed.searchParams.get('category');
        if (category) {
          if (!reliability[category]) {
            throw createHttpError(404, `Category '${category}' not found`);
          }
          sendJson(res, 200, { category, ...reliability[category] });
          return;
        }
        sendJson(res, 200, {
          categories: reliability,
          totalEntries: model.total_entries || 0,
          updated: model.updated || null,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/quality/rules') {
        const rulesPath = path.join(getSafeDataDir(), 'prevention-rules.md');
        let markdown = '';
        if (fs.existsSync(rulesPath)) {
          markdown = fs.readFileSync(rulesPath, 'utf8').trim();
        }
        const rules = [];
        for (const line of markdown.split('\n')) {
          const match = line.match(/^-\s+\*\*(\w+)\*\*.*?:\s*(.+)/);
          if (match) {
            rules.push({ severity: match[1].toLowerCase(), rule: match[2].trim() });
          }
        }
        sendJson(res, 200, { count: rules.length, rules, markdown });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/quality/posteriors') {
        const modelPath = path.join(getSafeDataDir(), 'feedback_model.json');
        const model = loadModel(modelPath);
        const posteriors = samplePosteriors(model);
        sendJson(res, 200, { posteriors });
        return;
      }

      // ----------------------------------------------------------------
      // Billing routes
      // ----------------------------------------------------------------

      // GET /v1/billing/usage — usage for the authenticated key
      if (req.method === 'GET' && pathname === '/v1/billing/usage') {
        const token = extractBearerToken(req);
        const validation = validateApiKey(token);
        if (!validation.valid) {
          sendProblem(res, {
            type: PROBLEM_TYPES.UNAUTHORIZED,
            title: 'Unauthorized',
            status: 401,
            detail: 'A valid API key is required to access this endpoint.',
          });
          return;
        }
        sendJson(res, 200, {
          key: token,
          customerId: validation.customerId,
          usageCount: validation.usageCount,
        });
        return;
      }

      // POST /v1/billing/provision — manually provision key (admin)
      if (req.method === 'POST' && pathname === '/v1/billing/provision') {
        if (!isStaticAdminAuthorized(req, expectedApiKey)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.FORBIDDEN,
            title: 'Forbidden',
            status: 403,
            detail: 'Admin API key required for this endpoint.',
          });
          return;
        }

        const body = await parseJsonBody(req);
        if (!body.customerId) {
          throw createHttpError(400, 'customerId is required');
        }
        const result = provisionApiKey(body.customerId, {
          installId: body.installId,
          source: 'admin_provision',
        });
        sendJson(res, 200, result);
        return;
      }

      // GET /v1/billing/summary — admin-only operational billing summary
      if (req.method === 'GET' && pathname === '/v1/billing/summary') {
        if (!isStaticAdminAuthorized(req, expectedApiKey)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.FORBIDDEN,
            title: 'Forbidden',
            status: 403,
            detail: 'Admin API key required for this endpoint.',
          });
          return;
        }

        const summary = getBillingSummary();
        sendJson(res, 200, summary);
        return;
      }

      // POST /v1/billing/rotate-key — rotate the authenticated key, preserving subscription
      if (req.method === 'POST' && pathname === '/v1/billing/rotate-key') {
        const currentKey = extractBearerToken(req);
        if (!currentKey) {
          sendProblem(res, {
            type: PROBLEM_TYPES.UNAUTHORIZED,
            title: 'Unauthorized',
            status: 401,
            detail: 'A valid API key is required to access this endpoint.',
          });
          return;
        }
        const validation = validateApiKey(currentKey);
        if (!validation.valid) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'Key not found or already disabled.',
          });
          return;
        }
        try {
          const result = rotateApiKey(currentKey);
          if (!result.rotated) {
            sendProblem(res, {
              type: PROBLEM_TYPES.BAD_REQUEST,
              title: 'Key Rotation Failed',
              status: 400,
              detail: result.reason || 'Key rotation failed.',
            });
            return;
          }
          sendJson(res, 200, {
            newKey: result.key,
            message: 'Key rotated. Update your configuration.',
          });
        } catch (err) {
          sendProblem(res, {
            type: PROBLEM_TYPES.INTERNAL,
            title: 'Internal Server Error',
            status: 500,
            detail: err.message || 'An unexpected error occurred.',
          });
        }
        return;
      }

      // GET /v1/analytics/funnel — aggregate acquisition/activation/paid funnel metrics
      if (req.method === 'GET' && pathname === '/v1/analytics/funnel') {
        const summary = getFunnelAnalytics();
        sendJson(res, 200, summary);
        return;
      }

      // GET /v1/dashboard -- Full RLHF dashboard JSON
      if (req.method === 'GET' && pathname === '/v1/dashboard') {
        const { FEEDBACK_DIR } = getFeedbackPaths();
        const data = generateDashboard(FEEDBACK_DIR);
        sendJson(res, 200, data);
        return;
      }

      // GET /v1/gates/stats -- Gate enforcement statistics
      if (req.method === 'GET' && pathname === '/v1/gates/stats') {
        const stats = loadGateStats();
        sendJson(res, 200, stats);
        return;
      }

      // POST /v1/gates/satisfy -- Record evidence that a gate condition is satisfied
      if (req.method === 'POST' && pathname === '/v1/gates/satisfy') {
        const body = await parseJsonBody(req);
        if (!body.gateId || !body.evidence) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'gateId and evidence are required.',
          });
          return;
        }
        const entry = satisfyCondition(body.gateId, body.evidence);
        sendJson(res, 200, { satisfied: true, gateId: body.gateId, ...entry });
        return;
      }

      sendProblem(res, {
        type: PROBLEM_TYPES.NOT_FOUND,
        title: 'Not Found',
        status: 404,
        detail: `No handler for ${req.method} ${pathname}`,
      });
    } catch (err) {
      sendProblem(res, {
        type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
        title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
        status: err.statusCode || 500,
        detail: err.message || 'An unexpected error occurred.',
      });
    }
  });
}

function startServer({ port } = {}) {
  const listenPort = Number(port ?? process.env.PORT ?? 8787);
  const server = createApiServer();
  return new Promise((resolve) => {
    server.listen(listenPort, () => {
      const address = server.address();
      const actualPort = (address && typeof address === 'object' && address.port)
        ? address.port
        : listenPort;
      resolve({
        server,
        port: actualPort,
      });
    });
  });
}

module.exports = {
  createApiServer,
  startServer,
  __test__: {
    buildCheckoutFallbackUrl,
  },
};

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`RLHF API listening on http://localhost:${port}`);
  });
}
