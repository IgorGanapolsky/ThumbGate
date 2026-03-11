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
} = require('../../scripts/feedback-loop');
const {
  readJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
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
} = require('../../scripts/billing');

const LANDING_PAGE_PATH = path.resolve(__dirname, '../../docs/landing-page.html');

function getSafeDataDir() {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  return path.resolve(path.dirname(FEEDBACK_LOG_PATH));
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
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

function loadLandingPageHtml(origin) {
  const template = fs.readFileSync(LANDING_PAGE_PATH, 'utf-8');
  return fillTemplate(template, {
    '__PACKAGE_VERSION__': pkg.version,
    '__APP_ORIGIN__': origin,
    '__CHECKOUT_ENDPOINT__': '/v1/billing/checkout',
    '__CHECKOUT_FALLBACK_URL__': 'https://buy.stripe.com/fZu4gz0I47Dg9G1cGv3sI03',
    '__FOUNDING_PRICE__': '$5/mo',
    '__VERIFICATION_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/VERIFICATION_EVIDENCE.md',
    '__COMPATIBILITY_REPORT_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/proof/compatibility/report.json',
    '__AUTOMATION_REPORT_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/proof/automation/report.json',
    '__GTM_PLAN_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md',
    '__GITHUB_URL__': 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
  });
}

function renderCheckoutSuccessPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Context Gateway Activated</title>
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
        <a class="button secondary" href="https://github.com/IgorGanapolsky/rlhf-feedback-loop/blob/main/docs/VERIFICATION_EVIDENCE.md" target="_blank" rel="noreferrer">Verification evidence</a>
      </div>
    </div>
  </main>

  <script>
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
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
        const res = await fetch('/v1/billing/session?sessionId=' + encodeURIComponent(sessionId));
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
        summaryEl.textContent = 'Your API key is ready. Copy the snippets below into your workflow project.';
        keyBlock.textContent = body.apiKey || 'Provisioned, but no key was returned.';
        envBlock.textContent = body.nextSteps && body.nextSteps.env ? body.nextSteps.env : 'Environment snippet unavailable.';
        curlBlock.textContent = body.nextSteps && body.nextSteps.curl ? body.nextSteps.curl : 'curl snippet unavailable.';
      } catch (err) {
        statusEl.textContent = 'Provisioning lookup failed.';
        summaryEl.textContent = 'You can retry this page. If it keeps failing, inspect the hosted API logs.';
        keyBlock.textContent = err && err.message ? err.message : 'Unknown error';
      }
    }

    run();
  </script>
</body>
</html>`;
}

function renderCheckoutCancelledPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checkout Cancelled</title>
  <style>
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: #f6f1e8;
      color: #1d1b18;
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
      color: #625a4d;
      margin: 0 0 20px;
    }
    a {
      display: inline-block;
      text-decoration: none;
      background: #b85c2d;
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>Checkout cancelled.</h1>
    <p>No charge was made. You can return to the landing page and restart checkout whenever you are ready.</p>
    <a href="/">Return to Context Gateway</a>
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

    // Public endpoints — no auth required
    if (req.method === 'GET' && pathname === '/') {
      if (wantsJson(req, parsed)) {
        sendJson(res, 200, {
          name: 'rlhf-feedback-loop',
          version: pkg.version,
          status: 'ok',
          docs: 'https://github.com/IgorGanapolsky/rlhf-feedback-loop',
          endpoints: ['/health', '/v1/feedback/capture', '/v1/feedback/stats', '/v1/dpo/export'],
        });
        return;
      }

      try {
        sendHtml(res, 200, loadLandingPageHtml(publicOrigin));
      } catch (err) {
        sendText(res, 500, err.message || 'Landing page unavailable');
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/success') {
      sendHtml(res, 200, renderCheckoutSuccessPage());
      return;
    }

    if (req.method === 'GET' && pathname === '/cancel') {
      sendHtml(res, 200, renderCheckoutCancelledPage());
      return;
    }

    if (req.method === 'GET' && pathname === '/.well-known/mcp/server-card.json') {
      sendJson(res, 200, {
        serverInfo: {
          name: 'rlhf-feedback-loop',
          version: pkg.version,
        },
        name: 'rlhf-feedback-loop',
        description: 'RLHF feedback loop for AI agents. Capture feedback, block mistakes, export DPO data.',
        version: pkg.version,
        tools: [
          { name: 'recall', description: 'Recall relevant past feedback for current task' },
          { name: 'capture_feedback', description: 'Capture an up/down signal plus one line of why' },
          { name: 'feedback_stats', description: 'Feedback analytics' },
          { name: 'feedback_summary', description: 'Human-readable feedback summary' },
          { name: 'prevention_rules', description: 'Generate prevention rules from failures' },
          { name: 'export_dpo_pairs', description: 'Export DPO training pairs' },
          { name: 'construct_context_pack', description: 'Build bounded context pack' },
          { name: 'evaluate_context_pack', description: 'Record context pack outcome' },
          { name: 'context_provenance', description: 'Audit trail of context decisions' },
          { name: 'list_intents', description: 'Available action plans' },
          { name: 'plan_intent', description: 'Generate execution plan' },
        ],
        repository: 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
        homepage: 'https://rlhf-feedback-loop-production.up.railway.app',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        version: pkg.version,
        uptime: process.uptime(),
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
        const result = await handleWebhook(rawBody, sig);
        sendJson(res, result.handled ? 200 : 400, result);
      } catch (err) {
        if (err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
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
          sendJson(res, 400, { error: 'Invalid webhook signature' });
          return;
        }

        let event;
        try {
          event = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON in webhook body' });
          return;
        }

        const result = handleGithubWebhook(event);
        sendJson(res, 200, result);
      } catch (err) {
        if (err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
      }
      return;
    }

    // Public checkout session creation for top-of-funnel acquisition.
    if (req.method === 'POST' && pathname === '/v1/billing/checkout') {
      try {
        const body = await parseJsonBody(req);
        const result = await createCheckoutSession({
          successUrl: body.successUrl || `${publicOrigin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: body.cancelUrl || `${publicOrigin}/cancel`,
          customerEmail: body.customerEmail,
          installId: body.installId,
          metadata: body.metadata,
        });
        sendJson(res, 200, result);
      } catch (err) {
        if (err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/billing/session') {
      try {
        const sessionId = parsed.searchParams.get('sessionId');
        if (!sessionId) {
          throw createHttpError(400, 'sessionId is required');
        }

        const result = await getCheckoutSessionStatus(sessionId);
        if (!result.found) {
          throw createHttpError(404, 'Checkout session not found');
        }

        sendJson(res, 200, {
          ...result,
          apiBaseUrl: publicOrigin,
          nextSteps: {
            env: `RLHF_API_KEY=${result.apiKey || ''}\nRLHF_API_BASE_URL=${publicOrigin}`,
            curl: `curl -X POST ${publicOrigin}/v1/feedback/capture \\\n  -H 'Authorization: Bearer ${result.apiKey || ''}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"signal":"down","context":"example","whatWentWrong":"example","whatToChange":"example"}'`,
          },
        });
      } catch (err) {
        if (err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
      }
      return;
    }

    if (!isAuthorized(req, expectedApiKey)) {
      sendJson(res, 401, { error: 'Unauthorized' });
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
        try {
          const catalog = listIntents({ mcpProfile, bundleId });
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
            approved: body.approved === true,
          });
          sendJson(res, 200, plan);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid intent plan request');
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/feedback/summary') {
        const recent = Number(parsed.searchParams.get('recent') || 20);
        const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20);
        sendJson(res, 200, { summary });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/capture') {
        const body = await parseJsonBody(req);
        const result = captureFeedback({
          signal: body.signal,
          context: body.context || '',
          whatWentWrong: body.whatWentWrong,
          whatToChange: body.whatToChange,
          whatWorked: body.whatWorked,
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
      // Billing routes
      // ----------------------------------------------------------------

      // GET /v1/billing/usage — usage for the authenticated key
      if (req.method === 'GET' && pathname === '/v1/billing/usage') {
        const token = extractBearerToken(req);
        const validation = validateApiKey(token);
        if (!validation.valid) {
          sendJson(res, 401, { error: 'Unauthorized' });
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
          sendJson(res, 403, { error: 'Forbidden: admin key required' });
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

      // POST /v1/billing/rotate-key — rotate the authenticated key, preserving subscription
      if (req.method === 'POST' && pathname === '/v1/billing/rotate-key') {
        const currentKey = extractBearerToken(req);
        if (!currentKey) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }
        const validation = validateApiKey(currentKey);
        if (!validation.valid) {
          sendJson(res, 400, { error: 'Key not found or already disabled' });
          return;
        }
        try {
          const result = rotateApiKey(currentKey);
          if (!result.rotated) {
            sendJson(res, 400, { error: result.reason || 'Key rotation failed' });
            return;
          }
          sendJson(res, 200, {
            newKey: result.newKey,
            message: 'Key rotated. Update your configuration.',
          });
        } catch (err) {
          sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
        return;
      }

      // GET /v1/analytics/funnel — aggregate acquisition/activation/paid funnel metrics
      if (req.method === 'GET' && pathname === '/v1/analytics/funnel') {
        const summary = getFunnelAnalytics();
        sendJson(res, 200, summary);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      if (err.statusCode) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
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
};

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`RLHF API listening on http://localhost:${port}`);
  });
}
